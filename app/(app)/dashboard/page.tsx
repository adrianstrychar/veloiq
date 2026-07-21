import { createServerSupabaseClient } from '@/lib/supabase';
import { type PmcRow } from '@/components/veloiq/RawMetrics';
import { EngineCards } from '@/components/veloiq/EngineCards';
import { ReadinessModule } from '@/components/veloiq/ReadinessModule';
import { DailyInsight } from '@/components/veloiq/DailyInsight';
import { Progress } from '@/components/veloiq/Progress';
import { LastActivityCard, type LastActivityRow } from '@/components/veloiq/LastActivityCard';
import { DashboardHeader } from '@/components/veloiq/DashboardHeader';
import { FtpEngineNote } from '@/components/veloiq/FtpEngineNote';
import { computeReadiness, type MetricRow } from '@/lib/readiness';
import { computeProgressStats, type ActivityStatRow } from '@/lib/progressStats';
import { ftpDisplay, deriveFtpSource } from '@/lib/ftp';
import { localTodayISO } from '@/lib/plan';
import type { RacePriority } from '@/lib/race-taper';
import { reconstructFtp, type ReconRide } from '@/lib/ftp-reconstruct';
import { forecastFtpPeriodized, buildRateFromEnvelope, type RaceLite } from '@/lib/ftp-forecast';

export default async function DashboardPage() {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, name, strava_id, ftp_watts, ftp_estimate, ftp_updated_at, ftp_source, ftp_prev_value, ftp_engine_note_seen, has_power_meter, weight_kg, vo2max, vo2_estimate, training_mode, season_km_goal, ytd_ride_km')
    .eq('user_id', user?.id ?? '')
    .single();

  const athleteId = athlete?.id;
  const stravaConnected = !!athlete?.strava_id;
  const todayISO = localTodayISO();

  const [{ data: pmcRows }, { data: lastActivity }, { data: hrCheck }, { data: season2026 }, { data: powerRides }, { data: upcomingRaces }] = await Promise.all([
    // Pełna historia sezonu — potrzebna do gotowości (szczyt CTL, rampa) i progresu.
    supabase
      .from('fitness_metrics')
      .select('date, ctl, atl, tsb')
      .eq('athlete_id', athleteId)
      .order('date', { ascending: true }),
    // Najnowsza jazda — po dacie aktywności malejąco.
    supabase
      .from('strava_activities')
      .select('strava_activity_id, name, activity_date, type, distance_km, elevation_m, duration_seconds, tss, avg_watts, avg_hr, best_efforts, laps, details_synced_at, synced_at, avg_cadence, normalized_power, intensity_factor, calories, avg_speed:raw_data->average_speed, max_speed:raw_data->max_speed, kilojoules:raw_data->kilojoules')
      .eq('athlete_id', athleteId)
      .order('activity_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // sprawdź czy są aktywności z tętnem (potrzebne do deriveFtpSource)
    supabase
      .from('strava_activities')
      .select('id')
      .eq('athlete_id', athleteId)
      .not('avg_hr', 'is', null)
      .limit(1)
      .maybeSingle(),
    // wszystkie jazdy sezonu 2026 — do statystyk rozwoju (streak, najdłuższa, suma km)
    supabase
      .from('strava_activities')
      .select('activity_date, distance_km, name')
      .eq('athlete_id', athleteId)
      .gte('activity_date', '2026-01-01')
      .order('activity_date', { ascending: true }),
    // Jazdy z krzywą mocy — REKONSTRUKCJA historii FTP (silnik 28d wstecz, best_efforts; streams
    // niepotrzebne). intensity_factor = sygnał "twardej jazdy" do envelope dowodowego (hold vs zejście).
    supabase
      .from('strava_activities')
      .select('activity_date, type, best_efforts, intensity_factor')
      .eq('athlete_id', athleteId)
      .not('best_efforts', 'is', null)
      .order('activity_date', { ascending: true }),
    // Nadchodzące starty — fazy prognozy (BUILD/TAPER/REGEN) + markery milestone'ów.
    supabase
      .from('race_calendar')
      .select('name, date, priority')
      .eq('athlete_id', athleteId)
      .gte('date', todayISO)
      .order('date', { ascending: true }),
  ]);

  // Wyprowadź source FTP i zbuduj display object
  const ftpSource = deriveFtpSource(
    (athlete as any)?.training_mode ?? null,
    (athlete as any)?.has_power_meter ?? false,
    (athlete as any)?.ftp_watts ?? null,
    !!hrCheck
  );
  const ftpData = ftpDisplay(
    ftpSource,
    (athlete as any)?.ftp_watts ?? null,
    (athlete as any)?.ftp_estimate != null ? Number((athlete as any).ftp_estimate) : null, // cicha estymata silnika (28 dni)
    (athlete as any)?.weight_kg ?? null,
    (athlete as any)?.ftp_updated_at ?? null
  );

  // pmcRows przychodzi już rosnąco po dacie.
  const metricRows: MetricRow[] = (pmcRows ?? []).map((r) => ({
    date: r.date as string,
    ctl: Number(r.ctl),
    atl: Number(r.atl),
    tsb: Number(r.tsb),
  }));

  const readiness = computeReadiness(metricRows);

  const pmc: PmcRow[] = metricRows.map((r) => {
    const d = new Date(r.date);
    const label = `${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
    return { date: r.date, label, ctl: r.ctl, atl: r.atl, tsb: r.tsb };
  });

  // Licznik sezonu ("KM W SEZONIE" + pierścień celu + pace): YTD ze Stravy — nasza baza ma
  // tylko ~90 dni wstecz od podłączenia, więc suma z niej zaniża km userowi wchodzącemu
  // w środku sezonu. NULL (przed pierwszym syncem po wdrożeniu) → suma z bazy jak dotąd.
  // Streak i najdłuższa jazda ŚWIADOMIE zostają z bazy — baza służy analizom, nie sumie km.
  const dbStats = computeProgressStats((season2026 ?? []) as ActivityStatRow[]);
  const ytdKm = (athlete as any)?.ytd_ride_km != null ? Math.round(Number((athlete as any).ytd_ride_km)) : null;
  const progressStats = ytdKm != null ? { ...dbStats, totalKm: ytdKm } : dbStats;

  // ── FTP: rekonstrukcja historii (envelope) + prognoza periodyzowana — w locie server-side (RSC),
  // zero migracji/stanu. Rekonstrukcja karmi się best_efforts (kompletne od pierwszej jazdy z mocą).
  const weight = (athlete as any)?.weight_kg != null ? Number((athlete as any).weight_kg) : null;
  const recon = reconstructFtp((powerRides ?? []) as ReconRide[], todayISO);
  const reconLast = recon.length ? recon[recon.length - 1].ftp : null;
  const forecastStart = reconLast ?? ftpData.value; // start prognozy = koniec rekonstrukcji ?? kolumna FTP
  const races: RaceLite[] = (upcomingRaces ?? []).map((r) => ({
    name: r.name as string, date: r.date as string, priority: ((r.priority as RacePriority) ?? 'C'),
  }));
  const forecast = forecastStart != null
    ? forecastFtpPeriodized({
        ftpNow: forecastStart,
        massKg: weight,
        today: todayISO,
        buildRatePerWeek: buildRateFromEnvelope(recon.map((p) => ({ date: p.date, ftp: p.ftp }))),
        races,
      })
    : { points: [], milestones: [], buildRatePerWeek: 0 };

  return (
    <div className="flex flex-col gap-4">
      <DashboardHeader
        athleteName={athlete?.name ?? 'Zawodniku'}
        lastSyncedAt={(lastActivity as { synced_at?: string | null } | null)?.synced_at ?? null}
      />

      {!stravaConnected && (
        <a
          href="/api/strava/auth"
          className="rounded-xl bg-accent text-background text-center text-sm font-semibold py-3"
        >
          🔗 Połącz Stravę
        </a>
      )}

      {/* Notka jednorazowa: tymczasowy FTP z onboardingu podmieniony na policzony przez silnik */}
      {(athlete as any)?.ftp_source === 'engine' &&
        (athlete as any)?.ftp_engine_note_seen === false &&
        (athlete as any)?.ftp_prev_value != null &&
        (athlete as any)?.ftp_watts != null && (
          <FtpEngineNote from={Number((athlete as any).ftp_prev_value)} to={Number((athlete as any).ftp_watts)} />
        )}

      {/* 1. EngineCards: FTP + VO2max (estymata z 5-min mocy; null → kafel VO2 ukryty) */}
      <EngineCards ftp={ftpData} vo2Estimate={(athlete as any)?.vo2_estimate != null ? Math.round(Number((athlete as any).vo2_estimate)) : null} />

      {/* 2. ReadinessModule: gotowość z TSB + rozwijany RawMetrics (CTL/ATL/TSB) */}
      {readiness && <ReadinessModule readiness={readiness} pmc={pmc} />}

      {/* 3. AI Insight: forma na dziś (fallback = statyczny advice gdy AI padnie) */}
      {readiness && <DailyInsight fallback={readiness.advice} />}

      {/* 4. Ostatnia aktywność — klikalna, otwiera RideAnalysis */}
      {lastActivity && (
        <LastActivityCard
          activity={lastActivity as unknown as LastActivityRow}
          ftp={(athlete as any)?.ftp_watts ?? null}
        />
      )}

      {/* 5. Progress: FTP hero (rekonstrukcja + prognoza periodyzowana) + statystyki + cel sezonu */}
      <Progress
        stats={progressStats}
        weightKg={weight}
        seasonGoalKm={(athlete as any)?.season_km_goal ?? null}
        ftpNow={ftpData.value}
        recon={recon}
        forecast={forecast.points}
        milestones={forecast.milestones}
      />
    </div>
  );
}
