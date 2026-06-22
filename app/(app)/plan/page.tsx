import { createServerSupabaseClient } from '@/lib/supabase';
import { Plan, type PlanDayView, type WeekSlot } from '@/components/veloiq/Plan';
import { localTodayISO, mondayOfISO, addWeeks, weekKind } from '@/lib/plan';

export const dynamic = 'force-dynamic';

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
    .select('week_start, plan_json')
    .eq('athlete_id', athlete?.id ?? '')
    .in('week_start', weekStarts);

  const byStart = new Map<string, PlanJson>();
  for (const r of rows ?? []) byStart.set(r.week_start as string, r.plan_json as PlanJson);

  const weeks: WeekSlot[] = weekStarts.map((ws) => {
    const pj = byStart.get(ws);
    return {
      weekStart: ws,
      kind: weekKind(ws, currentWeek),
      days: pj?.days ?? null,
      insight: pj?.insight ?? '',
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between py-2">
        <span className="text-lg font-bold">Plan tygodnia</span>
      </header>

      <Plan weeks={weeks} currentIdx={CURRENT_IDX} todayISO={todayISO} ftp={ftp} />
    </div>
  );
}
