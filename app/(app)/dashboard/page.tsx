import { createServerSupabaseClient } from '@/lib/supabase';
import { type PmcRow } from '@/components/veloiq/RawMetrics';
import { EngineCard } from '@/components/veloiq/EngineCard';
import { ReadinessModule } from '@/components/veloiq/ReadinessModule';
import { DailyInsight } from '@/components/veloiq/DailyInsight';
import { LastActivityCard, type LastActivityRow } from '@/components/veloiq/LastActivityCard';
import { DashboardHeader } from '@/components/veloiq/DashboardHeader';
import { FtpBar } from '@/components/veloiq/FtpBar';
import { FtpEngineNote } from '@/components/veloiq/FtpEngineNote';
import { computeReadiness, type MetricRow } from '@/lib/readiness';
import { computeProgressStats, type ActivityStatRow } from '@/lib/progressStats';
import { ftpDisplay, deriveFtpSource } from '@/lib/ftp';
import { localTodayISO, mondayOfISO } from '@/lib/plan';
import type { RacePriority } from '@/lib/race-taper';
import { reconstructFtp, type ReconRide } from '@/lib/ftp-reconstruct';
import { forecastFtpPeriodized, buildRateFromEnvelope, type RaceLite } from '@/lib/ftp-forecast';
import { Link2 } from 'lucide-react';
import { RecordsCard } from '@/components/veloiq/RecordsCard';
import { PowerShelfCard } from '@/components/veloiq/PowerShelfCard';
import { SeasonGoalCard } from '@/components/veloiq/SeasonGoalCard';
import { TodayCard, type TodayPlan } from '@/components/veloiq/TodayCard';
import { WeekCard, type WeekDay } from '@/components/veloiq/WeekCard';
import { computeRecords, computePowerByPeriod, computeGoal, type Period, type PeriodRecords } from '@/lib/dashboard-engagement';
import styles from './dashboard.module.css';

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

  const weekStart = mondayOfISO(todayISO);
  const [{ data: pmcRows }, { data: lastActivity }, { data: hrCheck }, { data: season2026 }, { data: powerRides }, { data: upcomingRaces }, { data: weekPlan }] = await Promise.all([
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
    // wszystkie jazdy sezonu 2026 — streak, suma km, rekordy okresowe (RecordsCard) + słupki tygodnia.
    // start_date_local: bucketowanie rekordów po dacie lokalnej (spójnie ze specem).
    supabase
      .from('strava_activities')
      .select('activity_date, distance_km, name, duration_seconds, elevation_m, tss, start_date_local:raw_data->start_date_local')
      .eq('athlete_id', athleteId)
      .gte('activity_date', '2026-01-01')
      .order('activity_date', { ascending: true }),
    // Jazdy z krzywą mocy — REKONSTRUKCJA historii FTP (silnik 28d wstecz, best_efforts; streams
    // niepotrzebne). intensity_factor = sygnał "twardej jazdy" do envelope dowodowego (hold vs zejście).
    supabase
      .from('strava_activities')
      .select('activity_date, type, best_efforts, intensity_factor, start_date_local:raw_data->start_date_local')
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
    // Plan bieżącego tygodnia — karta "Dziś" (sesja na dziś) + "Ten tydzień" (dni plan vs wykonane).
    supabase
      .from('weekly_plans')
      .select('plan_json')
      .eq('athlete_id', athleteId)
      .eq('week_start', weekStart)
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

  // ── Moduły zaangażowania (ETAP 3.5) — czyste helpery (lib/dashboard-engagement) ──
  const addDaysISO = (isoDate: string, n: number): string => {
    const d = new Date(isoDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const [ty, tm, td] = todayISO.split('-').map(Number);
  const todayDate = new Date(ty, tm - 1, td); // tylko części daty → niezależne od TZ serwera

  // Rekordy per okres (tydzień/miesiąc/sezon) — data lokalna jazdy (start_date_local ?? activity_date).
  const rideStats = (season2026 ?? []).map((r) => ({
    date: (typeof (r as { start_date_local?: unknown }).start_date_local === 'string'
      ? (r as { start_date_local: string }).start_date_local
      : (r.activity_date as string)).slice(0, 10),
    distance_km: r.distance_km as number | null,
    elevation_m: (r as { elevation_m?: number | null }).elevation_m ?? null,
    duration_seconds: (r as { duration_seconds?: number | null }).duration_seconds ?? null,
  }));
  const records: Record<Period, PeriodRecords> = {
    week: computeRecords(rideStats, 'week', todayDate),
    month: computeRecords(rideStats, 'month', todayDate),
    season: computeRecords(rideStats, 'season', todayDate),
  };

  // Rekordy mocy per okres — best_efforts, bucketowane po dacie lokalnej (start_date_local ?? activity_date),
  // spójnie z RecordsCard. Okno okresu (tydzień/miesiąc/sezon) filtruje helper.
  const power = computePowerByPeriod(
    (powerRides ?? []).map((r) => ({
      date: (typeof (r as { start_date_local?: unknown }).start_date_local === 'string'
        ? (r as { start_date_local: string }).start_date_local
        : (r.activity_date as string)).slice(0, 10),
      best_efforts: (r as { best_efforts?: Record<string, number | null> | null }).best_efforts ?? null,
    })),
    todayDate
  );

  // Cel sezonu — stała w configu (TODO: przenieść do configu/athletes.season_km_goal, bez UI w tym etapie).
  const SEASON_KM_GOAL = 12000;
  const goal = computeGoal(progressStats.totalKm, SEASON_KM_GOAL, todayDate);

  // Plan bieżącego tygodnia → Dziś + Ten tydzień.
  const planDays = (((weekPlan as { plan_json?: { days?: Array<{ dow: number; date: string; type: string; label: string; tss: number; dur_min: number; zones: number[] }> } } | null)?.plan_json)?.days) ?? [];
  const todayPlanDay = planDays.find((d) => d.date === todayISO) ?? null;
  const todayPlan: TodayPlan | null = todayPlanDay
    ? { label: todayPlanDay.label, type: todayPlanDay.type, tss: todayPlanDay.tss, durMin: todayPlanDay.dur_min, zones: todayPlanDay.zones ?? [] }
    : null;

  // Ten tydzień: wykonane (jazdy sezonu w oknie tygodnia) vs plan.
  const weekEnd = addDaysISO(weekStart, 6);
  const weekActs = (season2026 ?? []).filter((a) => (a.activity_date as string) >= weekStart && (a.activity_date as string) <= weekEnd);
  const doneTssByDate = new Map<string, number>();
  for (const a of weekActs) {
    const k = a.activity_date as string;
    doneTssByDate.set(k, (doneTssByDate.get(k) ?? 0) + Number((a as { tss?: number | null }).tss ?? 0));
  }
  const DOW_LABELS = ['PN', 'WT', 'ŚR', 'CZW', 'PT', 'SO', 'ND'];
  const rawWeek = Array.from({ length: 7 }, (_, i) => {
    const date = addDaysISO(weekStart, i);
    const plan = planDays.find((d) => d.date === date);
    const doneTss = doneTssByDate.get(date) ?? 0;
    const planTss = plan && plan.type !== 'OFF' ? plan.tss : 0;
    return { label: DOW_LABELS[i], hasDone: doneTssByDate.has(date), doneTss, planTss, isToday: date === todayISO, planned: !doneTssByDate.has(date) && !!plan && plan.type !== 'OFF' };
  });
  const maxWeek = Math.max(1, ...rawWeek.map((d) => (d.hasDone ? d.doneTss : d.planTss)));
  const weekDays: WeekDay[] = rawWeek.map((d) => ({
    label: d.label, done: d.hasDone, planned: d.planned, isToday: d.isToday,
    heightPct: ((d.hasDone ? d.doneTss : d.planTss) / maxWeek) * 100,
  }));
  const weekTotals = {
    rides: weekActs.length,
    km: Math.round(weekActs.reduce((s, x) => s + Number(x.distance_km ?? 0), 0)),
    // Czas w ruchu — suma duration_seconds jazd tygodnia (do podpisu "H:MM h").
    movingSec: weekActs.reduce((s, x) => s + Number((x as { duration_seconds?: number | null }).duration_seconds ?? 0), 0),
    doneTss: Math.round(weekActs.reduce((s, x) => s + Number((x as { tss?: number | null }).tss ?? 0), 0)),
    // Zweryfikowane na realnej bazie: plan_json.days każdego wiersza weekly_plans ma dokładnie 7 dni
    // w oknie week_start..+6 → to suma TSS TYLKO bieżącego tygodnia (pon–nd), nie szerszego zakresu.
    planTss: planDays.filter((d) => d.type !== 'OFF').reduce((s, d) => s + (d.tss ?? 0), 0),
  };

  return (
    <div className={`flex flex-col gap-4 ${styles.page}`}>
      <DashboardHeader
        athleteName={athlete?.name ?? 'Zawodniku'}
        lastSyncedAt={(lastActivity as { synced_at?: string | null } | null)?.synced_at ?? null}
      />

      {!stravaConnected && (
        <a
          href="/api/strava/auth"
          className="rounded-xl bg-accent text-background text-center text-sm font-semibold py-3 inline-flex items-center justify-center gap-2"
        >
          <Link2 size={16} strokeWidth={2} /> Połącz Stravę
        </a>
      )}

      {/* Notka jednorazowa: tymczasowy FTP z onboardingu podmieniony na policzony przez silnik */}
      {(athlete as any)?.ftp_source === 'engine' &&
        (athlete as any)?.ftp_engine_note_seen === false &&
        (athlete as any)?.ftp_prev_value != null &&
        (athlete as any)?.ftp_watts != null && (
          <FtpEngineNote from={Number((athlete as any).ftp_prev_value)} to={Number((athlete as any).ftp_watts)} />
        )}

      {/* Siatka kart (ETAP 3.5): desktop 2 kolumny ≥860px, mobile 1 kolumna; span2 = pełna szerokość.
          Kolejność: 1 Gotowość | 2 Dziś · 3 AI Insight(span2) · 4 Tydzień | 5 Ostatnia ·
          6 Silnik(span2) · 7 Rekordy | 8 Moc · 9 Cel sezonu(span2). */}
      <div className={styles.grid}>
        {/* 0. Pasek FTP (span2) — pierwszy element, nad Gotowością. Szybki rzut oka na FTP;
            karta "Twój silnik" (poz. 6) niesie wykres/prognozę/VO2 bez zmian. */}
        <div className={styles.span2}>
          <FtpBar ftp={ftpData} />
        </div>

        {/* 1. Gotowość */}
        {readiness && <ReadinessModule readiness={readiness} pmc={pmc} />}

        {/* 2. Dziś — zaplanowana sesja (pasek stref, bez tekstu struktury) */}
        <TodayCard plan={todayPlan} />

        {/* 3. AI Insight (span2) */}
        <div className={styles.span2}>
          {readiness && <DailyInsight fallback={readiness.advice} />}
        </div>

        {/* 4. Ten tydzień — słupki plan vs wykonane + streak */}
        <WeekCard days={weekDays} streakWeeks={progressStats.streakWeeks} totals={weekTotals} />

        {/* 5. Ostatnia aktywność */}
        {lastActivity && (
          <LastActivityCard
            activity={lastActivity as unknown as LastActivityRow}
            ftp={(athlete as any)?.ftp_watts ?? null}
          />
        )}

        {/* 6. Twój silnik (span2) — FTP + pułap tlenowy (bez stopki sezonu) */}
        <div className={styles.span2}>
          <EngineCard
            ftp={ftpData}
            vo2Estimate={(athlete as any)?.vo2_estimate != null ? Math.round(Number((athlete as any).vo2_estimate)) : null}
            weightKg={weight}
            recon={recon}
            forecast={forecast.points}
            milestones={forecast.milestones}
          />
        </div>

        {/* 7. Twoje rekordy */}
        <RecordsCard records={records} />

        {/* 8. Rekordy mocy */}
        <PowerShelfCard power={power} />

        {/* 9. Cel sezonu (span2, slim strip) */}
        <div className={styles.span2}>
          <SeasonGoalCard goal={goal} />
        </div>
      </div>
    </div>
  );
}
