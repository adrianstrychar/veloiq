import { refreshStravaToken } from '@/lib/strava';
import type { SupabaseClient } from '@supabase/supabase-js';

// Durations for best efforts in seconds
const BEST_EFFORT_DURATIONS: Record<string, number> = {
  '5s':   5,
  '15s':  15,
  '1min': 60,
  '5min': 300,
  '8min': 480,
  '10min': 600,
  '20min': 1200,
  '30min': 1800,
  '1h':   3600,
};

// Próg luki w streamie time, powyżej którego traktujemy przerwę jako PAUZĘ
// (kawa, auto-pause) i nie rozciągamy jej w czasie — tak jak Strava liczy efforty
// po czasie nagrywania, nie po elapsed. Krótsze dziury to dropouty czujnika i je
// interpolujemy (forward-fill), żeby nie zaniżać średnich.
const PAUSE_GAP_SECONDS = 10;

// Strava próbkuje nierównomiernie (dropouty, smart recording, pauzy), więc indeks
// punktu ≠ sekunda. Budujemy ciągłą tablicę "sekunda → moc" na bazie streamu `time`:
//  - krótkie dziury (≤ PAUSE_GAP_SECONDS) wypełniamy ostatnią mocą (dropout czujnika),
//  - dłuższe (pauzy) pomijamy — nie wstrzykujemy zer, by nie zaniżać długich okien.
function buildPerSecondWatts(watts: number[], time: number[] | undefined): number[] {
  // Brak streamu time albo niespójna długość → zakładamy 1 Hz (indeks = sekunda)
  if (!time || time.length !== watts.length || time.length === 0) {
    return watts;
  }

  const out: number[] = [];
  for (let i = 0; i < watts.length; i++) {
    if (i > 0) {
      const gap = time[i] - time[i - 1];
      if (gap > 1 && gap <= PAUSE_GAP_SECONDS) {
        const fill = watts[i - 1] ?? 0;
        for (let g = 1; g < gap; g++) out.push(fill);
      }
    }
    out.push(watts[i] ?? 0);
  }
  return out;
}

// Max średnia krocząca po ciągłej tablicy per-second (okno = sekundy).
function maxMovingAverage(perSec: number[], windowSec: number): number | null {
  if (perSec.length < windowSec) return null;
  let sum = 0;
  for (let i = 0; i < windowSec; i++) sum += perSec[i];
  let best = sum;
  for (let i = windowSec; i < perSec.length; i++) {
    sum += perSec[i] - perSec[i - windowSec];
    if (sum > best) best = sum;
  }
  return Math.round(best / windowSec);
}

// Eksport: reuse przez sync (hurtowe liczenie krzywej pod silnik FTP) — ta sama logika
// co przy lazy sync-details po kliknięciu (obwiednia, pauzy, forward-fill).
export function computeBestEfforts(watts: number[], time: number[] | undefined): Record<string, number | null> {
  const perSec = buildPerSecondWatts(watts, time);

  // Surowa max-średnia bywa NIEMONOTONICZNA przy strukturze interwałowej
  // (najlepsze okno 8 min może łapać dwa interwały + surge i przebić każde 5 min).
  // Krzywa mocy-czasu z definicji musi być nierosnąca, więc wymuszamy obwiednię:
  // dłuższe okno nie może przekroczyć krótszego (running min, durations rosnąco).
  const result: Record<string, number | null> = {};
  let prev = Infinity;
  for (const [label, dur] of Object.entries(BEST_EFFORT_DURATIONS)) {
    let v = maxMovingAverage(perSec, dur);
    if (v != null) {
      if (v > prev) v = prev; // clamp dłuższego okna w dół
      prev = v;
    }
    result[label] = v;
  }
  return result;
}

// Rekord segmentu (tylko PR-y). Pełne 43 efforty NIE zapisujemy — kom_rank (top-10) i tak
// zawsze null po zmianach API Stravy (zweryfikowane), więc trzymamy sam podzbiór z pr_rank.
export interface PrEffort {
  name: string;
  distance: number | null;   // metry
  elev: number | null;       // m (z segmentu: high-low), null gdy brak
  time: number | null;       // sekundy
  watts: number | null;
  pr_rank: number;           // 1=złoto, 2=srebro, 3=brąz
}

interface RawSegmentEffort {
  name?: string; distance?: number; moving_time?: number; elapsed_time?: number;
  average_watts?: number; pr_rank?: number | null;
  segment?: { elevation_high?: number; elevation_low?: number };
}

export function extractPrEfforts(segmentEfforts: RawSegmentEffort[] | undefined): PrEffort[] {
  return (segmentEfforts ?? [])
    .filter((e) => e.pr_rank != null)
    .map((e) => ({
      name: e.name ?? '—',
      distance: e.distance != null ? Math.round(e.distance) : null,
      elev: e.segment?.elevation_high != null && e.segment?.elevation_low != null
        ? Math.round(e.segment.elevation_high - e.segment.elevation_low) : null,
      time: e.moving_time ?? e.elapsed_time ?? null,
      watts: e.average_watts != null ? Math.round(e.average_watts) : null,
      pr_rank: e.pr_rank as number,
    }));
}

export async function syncActivityDetails(
  supabase: SupabaseClient,
  stravaActivityId: string,
  userId: string
): Promise<{ laps: unknown; best_efforts: Record<string, number | null>; calories: number | null; pr_efforts: PrEffort[] }> {
  // 1. Pobierz athletę i token
  const { data: athlete, error: athErr } = await supabase
    .from('athletes')
    .select('id, strava_access_token, strava_refresh_token, strava_token_expires_at')
    .eq('user_id', userId)
    .single();

  if (athErr || !athlete) throw new Error('Athlete not found');

  // 2. Odśwież token jeśli wygasł
  let accessToken = athlete.strava_access_token as string;
  const expiresAt = athlete.strava_token_expires_at
    ? new Date(athlete.strava_token_expires_at as string).getTime()
    : 0;

  if (expiresAt < Date.now()) {
    const refreshed = await refreshStravaToken(athlete.strava_refresh_token as string);
    accessToken = refreshed.access_token;
    await supabase.from('athletes').update({
      strava_access_token: refreshed.access_token,
      strava_refresh_token: refreshed.refresh_token,
      strava_token_expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
    }).eq('id', athlete.id);
  }

  // 3. Pobierz DETAL aktywności jednym callem: laps + segment_efforts (pr_rank) + calories.
  //    Zastępuje osobny /laps (lista go nie zwraca; calories i PR-y też są tylko tutaj).
  const detailRes = await fetch(
    `https://www.strava.com/api/v3/activities/${stravaActivityId}?include_all_efforts=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!detailRes.ok) throw new Error(`Strava activity detail failed: ${detailRes.status}`);
  const detail = await detailRes.json();
  const laps = detail.laps ?? [];
  const calories: number | null = detail.calories != null ? Math.round(detail.calories) : null;
  // pr_efforts ZAWSZE tablica (min []), nawet gdy jazda nie ma żadnego PR-a: [] = sentinel
  // "detal przetworzony", null (w DB) = "nigdy nie pobrany". Gate backfillu polega na tym
  // rozróżnieniu (pr_efforts IS NULL) — dlatego gwarancja tablicy jest w kodzie, nie w konwencji.
  const pr_efforts: PrEffort[] = extractPrEfforts(detail.segment_efforts) ?? [];

  // 4. Pobierz strumień mocy + czasu (time potrzebny do poprawnych okien — Strava
  //    próbkuje nierównomiernie, więc nie można liczyć okien po indeksie punktów)
  const streamRes = await fetch(
    `https://www.strava.com/api/v3/activities/${stravaActivityId}/streams?keys=watts,time&key_by_type=true&resolution=high`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  let bestEfforts: Record<string, number | null> = {};
  if (streamRes.ok) {
    const streams = await streamRes.json();
    const watts: number[] | undefined = streams?.watts?.data;
    const time: number[] | undefined = streams?.time?.data;
    if (watts && watts.length > 0) {
      bestEfforts = computeBestEfforts(watts, time);
    }
  }
  // Jeśli brak miernika (403 lub brak danych) — best_efforts zostanie pusty obiekt

  // 5. Zapisz do DB (laps + best_efforts jak dotąd + NOWE: calories, pr_efforts)
  const { error: updateErr } = await supabase
    .from('strava_activities')
    .update({
      laps,
      best_efforts: bestEfforts,
      calories,
      pr_efforts,
      details_synced_at: new Date().toISOString(),
    })
    .eq('strava_activity_id', stravaActivityId)
    .eq('athlete_id', athlete.id);

  if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`);

  return { laps, best_efforts: bestEfforts, calories, pr_efforts };
}
