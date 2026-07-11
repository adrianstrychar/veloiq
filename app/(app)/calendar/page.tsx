import { createServerSupabaseClient } from '@/lib/supabase';
import { type RaceRow } from '@/components/veloiq/Races';
import { type CalActivity, type CalPlanDay } from '@/components/veloiq/Calendar';
import { type PlanDayView } from '@/components/veloiq/Plan';
import { CalendarView } from '@/components/veloiq/CalendarView';
import { CALENDAR_RANGE } from '@/lib/calendar-events';
import { localTodayISO, mondayOfISO, addWeeks } from '@/lib/plan';

// SLIM kolumny listy (P1-a dieta: 395 KB → kilkanaście KB): kalendarz pokazuje nazwę/kolor/
// dystans/TSS — ciężkie jsonb (laps/best_efforts) i metryki karty NIE wchodzą; RideAnalysis
// dociąga pełny wiersz lazy po kliknięciu (Calendar.openRide). sport_type: kolory wg sportu.
const ACTIVITY_SELECT =
  'strava_activity_id, name, activity_date, type, distance_km, tss, details_synced_at, sport_type:raw_data->sport_type';

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
      // Okno dat = nawigowalny zakres siatki (MIN..MAX miesiąc w Calendar) — ‹ › nie wyjdzie
      // poza nie, więc okno nie może zrobić pustego miesiąca.
      .gte('activity_date', CALENDAR_RANGE.from)
      .lte('activity_date', CALENDAR_RANGE.to)
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
