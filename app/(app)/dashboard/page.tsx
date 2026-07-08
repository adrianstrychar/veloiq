import { createServerSupabaseClient } from '@/lib/supabase';
import { type PmcRow } from '@/components/veloiq/RawMetrics';
import { EngineCards } from '@/components/veloiq/EngineCards';
import { ReadinessModule } from '@/components/veloiq/ReadinessModule';
import { DailyInsight } from '@/components/veloiq/DailyInsight';
import { Progress } from '@/components/veloiq/Progress';
import { LastActivityCard, type LastActivityRow } from '@/components/veloiq/LastActivityCard';
import { SyncButton } from '@/components/veloiq/SyncButton';
import { computeReadiness, type MetricRow } from '@/lib/readiness';
import { computeProgressStats, type ActivityStatRow } from '@/lib/progressStats';
import { type FtpPoint } from '@/components/veloiq/Progress';
import { ftpDisplay, deriveFtpSource } from '@/lib/ftp';

export default async function DashboardPage() {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, name, strava_id, ftp_watts, ftp_estimate, ftp_updated_at, has_power_meter, weight_kg, vo2max, training_mode, season_km_goal, ytd_ride_km')
    .eq('user_id', user?.id ?? '')
    .single();

  const athleteId = athlete?.id;
  const stravaConnected = !!athlete?.strava_id;

  const [{ data: pmcRows }, { data: lastActivity }, { data: hrCheck }, { data: season2026 }, { data: ftpHistory }] = await Promise.all([
    // Pełna historia sezonu — potrzebna do gotowości (szczyt CTL, rampa) i progresu.
    supabase
      .from('fitness_metrics')
      .select('date, ctl, atl, tsb')
      .eq('athlete_id', athleteId)
      .order('date', { ascending: true }),
    // Najnowsza jazda — po dacie aktywności malejąco.
    supabase
      .from('strava_activities')
      .select('strava_activity_id, name, activity_date, type, distance_km, elevation_m, duration_seconds, tss, avg_watts, avg_hr, best_efforts, laps, details_synced_at')
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
    // historia FTP — do FTP hero z wykresem
    supabase
      .from('ftp_history')
      .select('date, ftp_watts')
      .eq('athlete_id', athleteId)
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

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between py-2">
        <span className="text-lg font-bold">VeloIQ</span>
        <div className="flex items-center gap-3">
          <SyncButton />
          <span className="text-sm text-secondary">
            Cześć, {athlete?.name ?? 'Zawodniku'} 👋
          </span>
        </div>
      </header>

      {!stravaConnected && (
        <a
          href="/api/strava/auth"
          className="rounded-xl bg-accent text-background text-center text-sm font-semibold py-3"
        >
          🔗 Połącz Stravę
        </a>
      )}

      {/* 1. EngineCards: FTP (kafel VO2max ukryty — statyczna liczba bez estymaty) */}
      <EngineCards ftp={ftpData} />

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

      {/* 5. Progress: FTP hero + statystyki + cel sezonu */}
      <Progress
        stats={progressStats}
        ftpHistory={(ftpHistory ?? []) as FtpPoint[]}
        weightKg={(athlete as any)?.weight_kg ?? null}
        seasonGoalKm={(athlete as any)?.season_km_goal ?? null}
      />
    </div>
  );
}
