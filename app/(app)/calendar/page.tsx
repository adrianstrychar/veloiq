import { createServerSupabaseClient } from '@/lib/supabase';
import { type RaceRow } from '@/components/veloiq/Races';
import { type CalActivity, type CalPlanDay } from '@/components/veloiq/Calendar';
import { type PlanDayView } from '@/components/veloiq/Plan';
import { CalendarView } from '@/components/veloiq/CalendarView';
import { localTodayISO, mondayOfISO, addWeeks } from '@/lib/plan';

// Pełny zestaw kolumn aktywności — potrzebny żeby klik w dniu kalendarza
// otworzył RideAnalysis bez dociągania danych. sport_type: kolory wg sportu
// (gravel/szosa/zwift) — kolumna type ma 'Ride' także dla graveli, rozróżnia raw_data.
const ACTIVITY_SELECT =
  'strava_activity_id, name, activity_date, type, distance_km, elevation_m, duration_seconds, tss, avg_watts, avg_hr, best_efforts, laps, details_synced_at, avg_cadence, normalized_power, intensity_factor, calories, avg_speed:raw_data->average_speed, max_speed:raw_data->max_speed, kilojoules:raw_data->kilojoules, sport_type:raw_data->sport_type';

export default async function CalendarPage() {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, ftp_watts')
    .eq('user_id', user?.id ?? '')
    .single();

  const athleteId = athlete?.id ?? '';

  // Treningi z planu do kalendarza (Etap 5): bieżący tydzień = szczegół, następny = zarys.
  const currentWeek = mondayOfISO(localTodayISO());
  const weekStarts = [currentWeek, addWeeks(currentWeek, 1)];

  const [{ data: races }, { data: activities }, { data: planRows }] = await Promise.all([
    supabase
      .from('race_calendar')
      .select('id, date, name, location, series, distance_km, elevation_m, discipline, priority')
      .eq('athlete_id', athleteId)
      .order('date', { ascending: true }),
    supabase
      .from('strava_activities')
      .select(ACTIVITY_SELECT)
      .eq('athlete_id', athleteId)
      .order('activity_date', { ascending: true }),
    supabase
      .from('weekly_plans')
      .select('week_start, plan_json')
      .eq('athlete_id', athleteId)
      .in('week_start', weekStarts),
  ]);

  // Spłaszcz dni obu tygodni; następny tydzień = outline (zarys — dashed, nieklikalny).
  const planDays: CalPlanDay[] = [];
  for (const row of planRows ?? []) {
    const days = ((row.plan_json as { days?: PlanDayView[] } | null)?.days ?? []);
    const outline = (row.week_start as string) !== currentWeek;
    for (const d of days) planDays.push({ ...d, outline: outline || !!d.outline });
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between py-2">
        <span className="text-lg font-bold">VeloIQ</span>
        <span className="text-sm text-secondary">Kalendarz</span>
      </header>

      <CalendarView
        races={(races ?? []) as RaceRow[]}
        activities={(activities ?? []) as CalActivity[]}
        planDays={planDays}
        ftp={(athlete?.ftp_watts as number | null) ?? null}
      />
    </div>
  );
}
