import { createServerSupabaseClient } from '@/lib/supabase';
import { type PmcRow } from '@/components/veloiq/RawMetrics';
import { EngineCards } from '@/components/veloiq/EngineCards';
import { ReadinessModule } from '@/components/veloiq/ReadinessModule';
import { DailyInsight } from '@/components/veloiq/DailyInsight';
import { Progress } from '@/components/veloiq/Progress';
import { LastActivityCard, type LastActivityRow } from '@/components/veloiq/LastActivityCard';
import { computeReadiness, type MetricRow } from '@/lib/readiness';
import { computeProgressStats, type ActivityStatRow } from '@/lib/progressStats';
import { ftpDisplay, deriveFtpSource } from '@/lib/ftp';

export default async function DashboardPage() {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, name, strava_id, ftp_watts, has_power_meter, weight_kg, vo2max, training_mode')
    .eq('user_id', user?.id ?? '')
    .single();

  const athleteId = athlete?.id;
  const stravaConnected = !!athlete?.strava_id;

  const [{ data: pmcRows }, { data: lastActivity }, { data: hrCheck }, { data: season2026 }] = await Promise.all([
    // Pełna historia sezonu — potrzebna do gotowości (szczyt CTL, rampa) i progresu.
    supabase
      .from('fitness_metrics')
      .select('date, ctl, atl, tsb')
      .eq('athlete_id', athleteId)
      .order('date', { ascending: true }),
    // TODO TEMP: na czas testów struktury lapów wymuszamy jazdę interwałową z 13.05
    //            (19 lapów). Przywrócić order+limit(1) po zakończeniu testów 6b/6c.
    supabase
      .from('strava_activities')
      .select('strava_activity_id, name, activity_date, type, distance_km, elevation_m, duration_seconds, tss, avg_watts, avg_hr, best_efforts, laps, details_synced_at')
      .eq('athlete_id', athleteId)
      .eq('strava_activity_id', 18491356555)
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
    null, // ftpEst — brak kalkulatora estymaty w tym etapie
    (athlete as any)?.weight_kg ?? null
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

  const seasonStart = metricRows[0] ?? null;
  const seasonNow = metricRows[metricRows.length - 1] ?? null;

  const progressStats = computeProgressStats((season2026 ?? []) as ActivityStatRow[]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between py-2">
        <span className="text-lg font-bold">VeloIQ</span>
        <span className="text-sm text-secondary">
          Cześć, {athlete?.name ?? 'Zawodniku'} 👋
        </span>
      </header>

      {!stravaConnected && (
        <a
          href="/api/strava/auth"
          className="rounded-xl bg-accent text-background text-center text-sm font-semibold py-3"
        >
          🔗 Połącz Stravę
        </a>
      )}

      {/* 1. EngineCards: FTP + VO2max */}
      <EngineCards ftp={ftpData} vo2max={(athlete as any)?.vo2max ?? null} />

      {/* 2. ReadinessModule: gotowość z TSB + rozwijany RawMetrics (CTL/ATL/TSB) */}
      {readiness && <ReadinessModule readiness={readiness} pmc={pmc} />}

      {/* 3. AI Insight: forma na dziś */}
      {readiness && <DailyInsight />}

      {/* 4. Ostatnia aktywność — klikalna, otwiera RideAnalysis */}
      {lastActivity && (
        <LastActivityCard
          activity={lastActivity as unknown as LastActivityRow}
          ftp={(athlete as any)?.ftp_watts ?? null}
        />
      )}

      {/* 5. Progress: rozwój formy (CTL teraz vs start sezonu) */}
      {seasonStart && seasonNow && (
        <Progress
          seasonStartCtl={seasonStart.ctl}
          seasonStartDate={seasonStart.date}
          nowCtl={seasonNow.ctl}
          nowDate={seasonNow.date}
          stats={progressStats}
        />
      )}

      {/* Nawigacja */}
      <div className="grid grid-cols-2 gap-3">
        <a href="/chat" className="rounded-xl bg-card border border-border text-center text-sm font-semibold py-3">
          💬 Chat z trenerem
        </a>
        <a href="/plan" className="rounded-xl bg-card border border-border text-center text-sm font-semibold py-3">
          📅 Plan tygodnia
        </a>
      </div>
    </div>
  );
}
