import { createServerSupabaseClient } from '@/lib/supabase';
import { RawMetrics, type PmcRow } from '@/components/veloiq/RawMetrics';
import { EngineCards } from '@/components/veloiq/EngineCards';
import { LastActivityCard, type LastActivityRow } from '@/components/veloiq/LastActivityCard';
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

  const [{ data: pmcRows }, { data: lastActivity }, { data: hrCheck }] = await Promise.all([
    supabase
      .from('fitness_metrics')
      .select('date, ctl, atl, tsb')
      .eq('athlete_id', athleteId)
      .order('date', { ascending: false })
      .limit(65),
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

  const pmc: PmcRow[] = (pmcRows ?? [])
    .slice()
    .reverse()
    .map((r) => {
      const d = new Date(r.date as string);
      const label = `${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
      return {
        date: r.date as string,
        label,
        ctl: Number(r.ctl),
        atl: Number(r.atl),
        tsb: Number(r.tsb),
      };
    });

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

      {/* EngineCards: FTP + VO2max */}
      <EngineCards ftp={ftpData} vo2max={(athlete as any)?.vo2max ?? null} />

      {/* RawMetrics: 3 kafle CTL/ATL/TSB + wykres PMC */}
      <RawMetrics pmc={pmc} />

      {/* Ostatnia aktywność — klikalna, otwiera RideAnalysis */}
      {lastActivity && (
        <LastActivityCard
          activity={lastActivity as unknown as LastActivityRow}
          ftp={(athlete as any)?.ftp_watts ?? null}
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
