import { createServerSupabaseClient } from '@/lib/supabase';
import { Plan, type PlanDayView } from '@/components/veloiq/Plan';
import { localTodayISO, mondayOfISO } from '@/lib/plan';
import { C } from '@/lib/theme';

export const dynamic = 'force-dynamic';

interface PlanJson {
  days: PlanDayView[];
  insight?: string;
}

export default async function PlanPage() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id')
    .eq('user_id', user?.id ?? '')
    .single();

  const todayISO = localTodayISO();
  const weekStart = mondayOfISO(todayISO);

  const { data: planRow } = await supabase
    .from('weekly_plans')
    .select('plan_json, week_start')
    .eq('athlete_id', athlete?.id ?? '')
    .eq('week_start', weekStart)
    .maybeSingle();

  const planJson = planRow?.plan_json as PlanJson | undefined;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between py-2">
        <span className="text-lg font-bold">Plan tygodnia</span>
      </header>

      {planJson?.days?.length ? (
        <Plan
          days={planJson.days}
          insight={planJson.insight ?? ''}
          weekStart={planRow!.week_start as string}
          todayISO={todayISO}
        />
      ) : (
        // Stan pusty — brak planu na ten tydzień.
        // TODO 5.7: tutaj wejdzie przycisk "Wygeneruj plan" (client) wołający
        //           POST /api/plan/generate, potem revalidate/refresh tej strony.
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
          padding: '28px 18px', textAlign: 'center', display: 'flex',
          flexDirection: 'column', gap: 8, alignItems: 'center',
        }}>
          <div style={{ fontSize: 28 }}>📋</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Brak planu na ten tydzień</div>
          <div style={{ fontSize: 12, color: C.muted, maxWidth: 280, lineHeight: 1.5 }}>
            Plan dla bieżącego tygodnia nie został jeszcze wygenerowany.
          </div>
          {/* TODO 5.7: <GeneratePlanButton /> — generowanie planu AI z UI */}
        </div>
      )}
    </div>
  );
}
