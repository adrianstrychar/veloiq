import { createServerSupabaseClient } from '@/lib/supabase';
import { Plan, type PlanDayView, type WeekSlot, type PlanActivityRow, type PlanRaceRow } from '@/components/veloiq/Plan';
import { localTodayISO, mondayOfISO, addWeeks, weekKind } from '@/lib/plan';

export const dynamic = 'force-dynamic';

// Kolumny jazdy potrzebne do RideAnalysis + identyfikacja/flaga details.
// raw_data: do odczytu start_date_local (data lokalna, nie UTC) — workaround b1.
const ACTIVITY_SELECT =
  'strava_activity_id, name, activity_date, type, distance_km, elevation_m, duration_seconds, tss, avg_watts, normalized_power, avg_hr, best_efforts, laps, details_synced_at, raw_data, avg_cadence, intensity_factor, calories, avg_speed:raw_data->average_speed, max_speed:raw_data->max_speed, kilojoules:raw_data->kilojoules';

// Data lokalna jazdy (start_date_local z raw_data); fallback do activity_date (UTC).
function localDateOf(a: { activity_date: string; raw_data?: { start_date_local?: string } | null }): string {
  const local = a.raw_data?.start_date_local;
  return (typeof local === 'string' && local.length >= 10 ? local : a.activity_date).slice(0, 10);
}

interface PlanJson {
  days: PlanDayView[];
  insight?: string;
}

const CURRENT_IDX = 1; // okno: [poprzedni, BIEŻĄCY, następny, za 2 tyg]

export default async function PlanPage() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, ftp_watts')
    .eq('user_id', user?.id ?? '')
    .single();

  const ftp = (athlete?.ftp_watts as number | null) ?? 250;

  // Ostatni CTL — do rekomendacji godzin (targetWeeklyTSS = ctl*7*1.15).
  const { data: ctlRow } = await supabase
    .from('fitness_metrics')
    .select('ctl')
    .eq('athlete_id', athlete?.id ?? '')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const ctl = (ctlRow?.ctl as number | null) ?? 0;

  const todayISO = localTodayISO();
  const currentWeek = mondayOfISO(todayISO);

  // Stałe okno 4 tygodni względem dziś
  const weekStarts = [
    addWeeks(currentWeek, -1),
    currentWeek,
    addWeeks(currentWeek, 1),
    addWeeks(currentWeek, 2),
  ];

  // Jedno zapytanie po wszystkich istniejących tygodniach z okna
  const { data: rows } = await supabase
    .from('weekly_plans')
    .select('week_start, plan_json, user_hours')
    .eq('athlete_id', athlete?.id ?? '')
    .in('week_start', weekStarts);

  const byStart = new Map<string, PlanJson>();
  const userHoursByStart = new Map<string, number | null>();
  for (const r of rows ?? []) {
    byStart.set(r.week_start as string, r.plan_json as PlanJson);
    userHoursByStart.set(r.week_start as string, (r.user_hours as number | null) ?? null);
  }

  // Join ze Stravą: WSZYSTKIE jazdy z okna → mapa lokalnaData→lista jazd (nie jedna).
  // Zakres poszerzony o 1 dzień wstecz, bo data lokalna może różnić się od UTC activity_date.
  const lowerBound = (() => {
    const d = new Date(weekStarts[0] + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const { data: actRows } = await supabase
    .from('strava_activities')
    .select(ACTIVITY_SELECT)
    .eq('athlete_id', athlete?.id ?? '')
    .gte('activity_date', lowerBound);

  // Starty w oknie planu — nakładane jako dzień RACE (spójne z wstrzykiwaniem w generatorze,
  // działa też dla planów sprzed race-aware). Zakres = całe okno 4 tygodni.
  const windowEnd = (() => { const d = new Date(weekStarts[weekStarts.length - 1] + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10); })();
  const { data: raceRows } = await supabase
    .from('race_calendar')
    .select('date, name, priority, distance_km, elevation_m, discipline')
    .eq('athlete_id', athlete?.id ?? '')
    .gte('date', weekStarts[0])
    .lte('date', windowEnd);

  const activitiesByDate: Record<string, PlanActivityRow[]> = {};
  for (const a of (actRows ?? []) as unknown as PlanActivityRow[]) {
    const key = localDateOf(a as never);
    (activitiesByDate[key] ??= []).push(a);
  }
  // Posortuj dzienne listy malejąco po TSS (max TSS = ta dopasowana do planu jako "done").
  for (const k of Object.keys(activitiesByDate)) {
    activitiesByDate[k].sort((x, y) => (y.tss ?? 0) - (x.tss ?? 0));
  }

  const weeks: WeekSlot[] = weekStarts.map((ws) => {
    const pj = byStart.get(ws);
    return {
      weekStart: ws,
      kind: weekKind(ws, currentWeek),
      days: pj?.days ?? null,
      insight: pj?.insight ?? '',
      userHours: userHoursByStart.get(ws) ?? null,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between py-2">
        <span className="text-lg font-bold">Plan tygodnia</span>
      </header>

      <Plan weeks={weeks} currentIdx={CURRENT_IDX} todayISO={todayISO} ftp={ftp} ctl={ctl} activitiesByDate={activitiesByDate} races={(raceRows ?? []) as PlanRaceRow[]} />
    </div>
  );
}
