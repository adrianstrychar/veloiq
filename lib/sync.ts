// Shared Strava sync + fitness metrics recalculation (sekcja 15)
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchStravaActivities,
  fetchStravaAthleteStats,
  refreshStravaToken,
  type StravaActivity,
} from '@/lib/strava';
import { calculateTSSfromHR, calculateTSSfromPower, calculateFitnessHistory } from '@/lib/fitness';
import { computeBestEfforts } from '@/lib/strava/details';
import { estimateFtp, decideFtpDisplayUpdate, type EffortRide } from '@/lib/ftp-engine';

const SYNC_COOLDOWN_MINUTES = 60;
const DEFAULT_LOOKBACK_DAYS = 90;

// Okno silnika FTP: krzywa mocy z ostatnich 28 dni. Limit dociągnięć na jeden sync —
// bezpiecznik rate limitu (typowo 1-2 nowe jazdy; pierwszy sync po wdrożeniu = backfill ~9).
const FTP_WINDOW_DAYS = 28;
const BEST_EFFORTS_MAX_PER_SYNC = 30;

interface AthleteRow {
  id: string;
  strava_id: number | null;
  ftp_watts: number | null;
  hrmax: number | null;
  strava_access_token: string;
  strava_refresh_token: string;
  strava_token_expires_at: string | null;
}

// Licznik sezonu = czysty YTD ze Stravy (GET /athletes/{id}/stats → ytd_ride_totals).
// Jedno źródło prawdy, zero dryfu przy edycjach/usunięciach aktywności w Stravie; user
// porównuje z liczbą, którą zna z appki Stravy. Definicja Stravy ZWERYFIKOWANA liczbowo
// (2026-07-06, konto 16541591): ytd_ride_totals = suma aktywności o type Ride + VirtualRide
// + EBikeRide (132 jazdy / 7336 km, co do kilometra), wyklucza inne sporty (AlpineSki).
// To ten sam zakres co nasz filtr syncu poniżej — bez rozjazdu definicji.
// BEST EFFORT: błąd stats NIE wysadza syncu aktywności (licznik może być o jeden sync
// starszy, aktywności są ważniejsze) — stąd try/catch w środku i void w sygnaturze.
export async function refreshSeasonDistance(
  supabase: SupabaseClient,
  athleteId: string,
  stravaId: number,
  accessToken: string
): Promise<void> {
  try {
    const stats = await fetchStravaAthleteStats(accessToken, stravaId);
    const meters = stats.ytd_ride_totals?.distance;
    if (meters == null) return;
    await supabase
      .from('athletes')
      .update({
        ytd_ride_km: Math.round((meters / 1000) * 10) / 10,
        ytd_refreshed_at: new Date().toISOString(),
      })
      .eq('id', athleteId);
  } catch (e) {
    console.error(
      `ytd stats refresh failed (sync kontynuowany), athlete ${athleteId}:`,
      e instanceof Error ? e.message : e
    );
  }
}

function computeTSS(
  activity: StravaActivity,
  ftpWatts: number | null,
  hrmax: number | null
): number {
  // E-bike: moc zawiera wspomaganie silnika → ignoruj ją, licz zawsze z HR.
  const isEbike = activity.type === 'EBikeRide';
  if (!isEbike && ftpWatts && activity.weighted_average_watts) {
    return calculateTSSfromPower(activity.moving_time, activity.weighted_average_watts, ftpWatts);
  }
  // Brak hrmax w profilu — przybliż go z max_heartrate tej aktywności (sekcja 11)
  const effectiveHrmax = hrmax ?? activity.max_heartrate;
  if (effectiveHrmax && activity.average_heartrate) {
    return calculateTSSfromHR(activity.moving_time, activity.average_heartrate, effectiveHrmax);
  }
  return 0; // F1: brak mocy i HR → TSS 0 (na e-bike teoretyczne — zawsze z pasem HR)
}

// Dociąga krzywą mocy (best_efforts) dla jazd z okna FTP, które jej nie mają — jeden
// mechanizm pokrywa backfill po wdrożeniu i nowe jazdy z bieżącego syncu (jazda świeżo
// upsertowana nie ma best_efforts → łapie się w to samo zapytanie). FILTRY:
//  - EBikeRide pomijany CAŁKOWICIE (bez calla o streams) — moc z silnika nie istnieje
//    w systemie, zatrułaby krzywą i estymatę FTP (spójnie z hrTSS/insight dla e-bike),
//  - device_watts === false (moc SZACOWANA przez Stravę, nie z miernika) — pomijamy,
//    zapisując {} żeby nie próbować w kółko; realnej krzywej z szacunku nie ma.
// Błąd streams pojedynczej jazdy nie wysadza reszty (try/catch per jazda, log) — wzorzec
// jak refreshSeasonDistance. CELOWO nie ustawiamy details_synced_at: lapy nie zostały
// pobrane, lazy sync-details po kliknięciu ma dalej zadziałać w całości.
export async function syncBestEfforts(
  supabase: SupabaseClient,
  athleteId: string,
  accessToken: string
): Promise<number> {
  const since = new Date(Date.now() - FTP_WINDOW_DAYS * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data: missing } = await supabase
    .from('strava_activities')
    .select('strava_activity_id, device_watts:raw_data->device_watts')
    .eq('athlete_id', athleteId)
    .gte('activity_date', since)
    .is('best_efforts', null)
    .neq('type', 'EBikeRide')
    .not('avg_watts', 'is', null)
    .limit(BEST_EFFORTS_MAX_PER_SYNC);

  let fetched = 0;
  for (const ride of missing ?? []) {
    const id = ride.strava_activity_id as number;
    try {
      if (ride.device_watts === false) {
        // Moc szacowana — krzywej nie liczymy; pusty obiekt kończy temat (nie retry'ujemy).
        await supabase.from('strava_activities').update({ best_efforts: {} }).eq('strava_activity_id', id).eq('athlete_id', athleteId);
        continue;
      }
      const res = await fetch(
        `https://www.strava.com/api/v3/activities/${id}/streams?keys=watts,time&key_by_type=true&resolution=high`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) throw new Error(`streams ${res.status}`);
      const streams = await res.json();
      const watts: number[] | undefined = streams?.watts?.data;
      const time: number[] | undefined = streams?.time?.data;
      const be = watts && watts.length > 0 ? computeBestEfforts(watts, time) : {};
      const { error } = await supabase
        .from('strava_activities')
        .update({ best_efforts: be })
        .eq('strava_activity_id', id)
        .eq('athlete_id', athleteId);
      if (error) throw new Error(`update: ${error.message}`);
      fetched++;
    } catch (e) {
      console.error(`best_efforts fetch failed (jazda ${id}, kontynuuję):`, e instanceof Error ? e.message : e);
    }
  }
  return fetched;
}

// Przelicza cichą estymatę FTP z 28-dniowej krzywej mocy i zapisuje ftp_estimate.
// WYŚWIETLANE ftp_watts rusza TYLKO gdy silnik jest już zaakceptowany przez usera
// (ftp_updated_at != null — ustawiane pierwszą akceptacją w UI) i reguła hybrydy
// (≥14 dni LUB próg +5/−8 W) każe aktualizować. Ręcznego FTP sprzed silnika nie
// nadpisujemy nigdy po cichu — pierwsza estymata żyje w UI jako "~X szac.".
// Best effort: błąd (np. brak kolumn przed migracją 009) nie wysadza syncu.
export async function recalculateFtpEstimate(
  supabase: SupabaseClient,
  athleteId: string
): Promise<void> {
  try {
    const since = new Date(Date.now() - FTP_WINDOW_DAYS * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const { data: rides } = await supabase
      .from('strava_activities')
      .select('activity_date, type, best_efforts')
      .eq('athlete_id', athleteId)
      .gte('activity_date', since);

    const est = estimateFtp((rides ?? []) as EffortRide[]);
    if (!est) return; // za mało danych w oknie — zostaw poprzednią estymatę

    const nowIso = new Date().toISOString();
    const updates: Record<string, unknown> = {
      ftp_estimate: est.ftp,
      ftp_estimated_at: nowIso,
    };

    const { data: ath } = await supabase
      .from('athletes')
      .select('ftp_watts, ftp_updated_at')
      .eq('id', athleteId)
      .single();

    if (ath?.ftp_updated_at != null && ath.ftp_watts != null) {
      const decision = decideFtpDisplayUpdate(Number(ath.ftp_watts), String(ath.ftp_updated_at), est.ftp, nowIso);
      if (decision.update) {
        updates.ftp_watts = est.ftp;
        updates.ftp_updated_at = nowIso;
        await supabase.from('ftp_history').insert({
          athlete_id: athleteId,
          date: nowIso.slice(0, 10),
          ftp_watts: est.ftp,
          source: 'estimate',
        });
      }
    }

    const { error } = await supabase.from('athletes').update(updates).eq('id', athleteId);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error(
      `ftp estimate failed (sync kontynuowany), athlete ${athleteId}:`,
      e instanceof Error ? e.message : e
    );
  }
}

// Pobiera nowe aktywności ze Stravy i zapisuje do strava_activities
export async function syncStravaActivities(
  supabase: SupabaseClient,
  athlete: AthleteRow,
  opts: { skipCooldown?: boolean } = {}
): Promise<{ skipped: true; reason: string } | { skipped: false; synced: number }> {
  // Cron (zaufane wywołanie systemowe) omija cooldown; user-triggered go respektuje (anty-spam).
  if (!opts.skipCooldown) {
    const { data: lastActivity } = await supabase
      .from('strava_activities')
      .select('activity_date, synced_at')
      .eq('athlete_id', athlete.id)
      .order('synced_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastActivity?.synced_at) {
      const minutesSinceSync =
        (Date.now() - new Date(lastActivity.synced_at).getTime()) / 60000;
      if (minutesSinceSync < SYNC_COOLDOWN_MINUTES) {
        return { skipped: true, reason: 'cooldown' };
      }
    }
  }

  let accessToken = athlete.strava_access_token;
  const expiresAt = athlete.strava_token_expires_at
    ? new Date(athlete.strava_token_expires_at).getTime()
    : 0;

  if (expiresAt < Date.now()) {
    const refreshed = await refreshStravaToken(athlete.strava_refresh_token);
    accessToken = refreshed.access_token;

    await supabase
      .from('athletes')
      .update({
        strava_access_token: refreshed.access_token,
        strava_refresh_token: refreshed.refresh_token,
        strava_token_expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
      })
      .eq('id', athlete.id);
  }

  // Odśwież licznik sezonu (YTD) — po refreshu tokenu, przed aktywnościami. Best effort:
  // własny try/catch w środku, porażka stats nie przerywa syncu aktywności.
  if (athlete.strava_id != null) {
    await refreshSeasonDistance(supabase, athlete.id, athlete.strava_id, accessToken);
  }

  // Zawsze pobieraj pełne okno 90 dni, żeby CTL/ATL liczyły się od początku okresu (sekcja 11)
  const after = Math.floor(Date.now() / 1000) - DEFAULT_LOOKBACK_DAYS * 24 * 3600;

  const activities = await fetchStravaActivities(accessToken, after);

  const rows = activities
    .filter((a) => a.type === 'Ride' || a.type === 'VirtualRide' || a.type === 'MountainBikeRide' || a.type === 'EBikeRide')
    .map((a) => {
      const tss = computeTSS(a, athlete.ftp_watts, athlete.hrmax);
      const intensityFactor =
        athlete.ftp_watts && a.weighted_average_watts
          ? a.weighted_average_watts / athlete.ftp_watts
          : null;

      return {
        athlete_id: athlete.id,
        strava_activity_id: a.id,
        activity_date: (a.start_date_local ?? a.start_date).slice(0, 10),
        name: a.name,
        type: a.type,
        distance_km: Math.round((a.distance / 1000) * 100) / 100,
        duration_seconds: a.moving_time,
        elevation_m: Math.round(a.total_elevation_gain),
        avg_watts: a.average_watts ? Math.round(a.average_watts) : null,
        max_watts: a.max_watts ? Math.round(a.max_watts) : null,
        avg_hr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
        max_hr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
        avg_cadence: a.average_cadence ? Math.round(a.average_cadence) : null,
        normalized_power: a.weighted_average_watts ? Math.round(a.weighted_average_watts) : null,
        tss: Math.round(tss * 100) / 100,
        intensity_factor: intensityFactor ? Math.round(intensityFactor * 1000) / 1000 : null,
        raw_data: a,
        synced_at: new Date().toISOString(),
      };
    });

  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from('strava_activities')
      .upsert(rows, { onConflict: 'strava_activity_id' });

    if (upsertError) {
      throw new Error(`upsert_failed: ${upsertError.message}`);
    }
  }

  // Silnik FTP: dociągnij krzywą mocy dla jazd bez best_efforts w oknie 28 dni
  // (nowe z tego syncu + ewentualne zaległości) i przelicz cichą estymatę.
  // Oba kroki best effort — nie wysadzają syncu aktywności.
  try {
    await syncBestEfforts(supabase, athlete.id, accessToken);
  } catch (e) {
    console.error('syncBestEfforts failed (sync kontynuowany):', e instanceof Error ? e.message : e);
  }
  await recalculateFtpEstimate(supabase, athlete.id);

  return { skipped: false, synced: rows.length };
}

// Przelicza CTL/ATL/TSB na podstawie wszystkich aktywności i zapisuje do fitness_metrics
export async function recalculateFitnessMetrics(
  supabase: SupabaseClient,
  athleteId: string
): Promise<void> {
  const { data: activities, error } = await supabase
    .from('strava_activities')
    .select('activity_date, tss')
    .eq('athlete_id', athleteId)
    .order('activity_date', { ascending: true });

  if (error || !activities || activities.length === 0) return;

  const history = calculateFitnessHistory(
    activities.map((a) => ({ date: a.activity_date as string, tss: (a.tss as number) ?? 0 }))
  );

  const rows = history.map((h) => ({
    athlete_id: athleteId,
    date: h.date,
    ctl: h.ctl,
    atl: h.atl,
    tsb: h.tsb,
    daily_tss: h.tss,
    calculated_at: new Date().toISOString(),
  }));

  await supabase.from('fitness_metrics').upsert(rows, { onConflict: 'athlete_id,date' });
}
