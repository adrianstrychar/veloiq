import { createServerSupabaseClient } from '@/lib/supabase';
import { mondayOfISO } from '@/lib/plan';
import { userTodayISO } from '@/lib/timezone';
import type { PlanDayRow } from '@/lib/planned-day';
import { planDayToScript } from '@/lib/ride/plan-to-script';
import { TreningClient } from './TreningClient';

export const dynamic = 'force-dynamic';

// Zakładka „Jedź”: dzisiejszy dzień planu → skrypt RideEngine (budowany na serwerze z plan_json,
// tymi samymi watami co rozpiska w /plan). Brak planu / OFF → jazda swobodna.
export default async function TreningPage() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, ftp_watts, name')
    .eq('user_id', user?.id ?? '')
    .maybeSingle();

  const ftp = (athlete?.ftp_watts as number | null) ?? 250;
  const today = userTodayISO();
  const dow = ((new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1; // 1=Pn … 7=Nd

  let day: PlanDayRow | null = null;
  if (athlete?.id) {
    const { data: plan } = await supabase
      .from('weekly_plans')
      .select('plan_json')
      .eq('athlete_id', athlete.id)
      .eq('week_start', mondayOfISO(today))
      .maybeSingle();
    day = (plan?.plan_json as { days?: PlanDayRow[] } | null)?.days?.find((d) => d.dow === dow) ?? null;
  }

  const script = planDayToScript(day, ftp, `plan-${today}`);
  const planLabel = day && script ? [day.type, `${day.dur_min} min`, day.tss ? `TSS ${day.tss}` : null].filter(Boolean).join(' · ') : undefined;

  const firstName = String((athlete?.name as string | null) ?? '').trim().split(/\s+/)[0] || undefined;
  return <TreningClient plan={script} planLabel={planLabel} ftp={ftp} firstName={firstName} />;
}
