import { createServerSupabaseClient } from '@/lib/supabase';
import { mondayOfISO } from '@/lib/plan';
import { userTodayISO } from '@/lib/timezone';
import type { PlanDayRow } from '@/lib/planned-day';
import { planDayToScript } from '@/lib/ride/plan-to-script';
import { TreningClient } from './TreningClient';
import { buildBriefing } from '@/lib/ride/briefing';
import { parsePacing, type RacePacing } from '@/lib/ride/race-pacing';
import { shiftISO } from '@/lib/timezone';
import { deviceName } from '@/lib/garmin/auth';
import type { GarminDevice } from '@/components/ride/GarminPanel';

export const dynamic = 'force-dynamic';

// Zakładka „Jedź”: dzisiejszy dzień planu → skrypt RideEngine (budowany na serwerze z plan_json,
// tymi samymi watami co rozpiska w /plan). Brak planu / OFF → jazda swobodna.
export default async function TreningPage() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, ftp_watts, name, hrmax')
    .eq('user_id', user?.id ?? '')
    .maybeSingle();

  const ftp = (athlete?.ftp_watts as number | null) ?? 250;
  const today = userTodayISO();
  const dow = ((new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1; // 1=Pn … 7=Nd

  // plan dnia i odprawa równolegle (wcześniej po kolei – „Jedź” długo nie reagował)
  // liczniki Garmin na koncie: „Jedź” od razu pokazuje kartę licznika (bez mignięcia ekranu czujników telefonu)
  const devicesP = user
    ? supabase.from('garmin_devices').select('id, model, app_version, created_at, last_seen_at').is('revoked_at', null)
        .order('created_at', { ascending: false }).then((r) => r, () => ({ data: null }))
    : Promise.resolve({ data: null });
  const [planRes, briefing, raceRes] = athlete?.id
    ? await Promise.all([
        supabase.from('weekly_plans').select('plan_json').eq('athlete_id', athlete.id).eq('week_start', mondayOfISO(today)).maybeSingle(),
        buildBriefing(supabase, athlete.id as string).catch(() => undefined),
        // tryb startowy: najbliższy start (do 60 dni) ze strategią – Enzo poda cele mocy na podjazdy
        supabase.from('race_calendar').select('id, name, date')
          .eq('athlete_id', athlete.id).gte('date', today).lte('date', shiftISO(today, 60))
          .order('date', { ascending: true }).limit(1).maybeSingle(),
      ])
    : [null, undefined, null];
  let racePacing: RacePacing | undefined;
  const race = raceRes?.data;
  if (race && athlete?.id) {
    const { data: rp } = await supabase.from('race_plans').select('tactical_plan')
      .eq('athlete_id', athlete.id).eq('race_id', race.id).maybeSingle();
    const pacing = (rp?.tactical_plan as { pacing?: { phase?: string; tier?: string; watts?: string; tip?: string }[] } | null)?.pacing;
    racePacing = { raceId: String(race.id), name: String(race.name), date: String(race.date), phases: parsePacing(pacing) };
  }
  const day: PlanDayRow | null = (planRes?.data?.plan_json as { days?: PlanDayRow[] } | null)?.days?.find((d) => d.dow === dow) ?? null;

  const script = planDayToScript(day, ftp, `plan-${today}`, athlete?.hrmax as number | null);
  const planLabel = day && script ? [day.type, `${day.dur_min} min`, day.tss ? `TSS ${day.tss}` : null].filter(Boolean).join(' · ') : undefined;

  const firstName = String((athlete?.name as string | null) ?? '').trim().split(/\s+/)[0] || undefined;
  const devRows = ((await devicesP).data ?? []) as { id: string; model: string | null; app_version: string | null; created_at: string; last_seen_at: string | null }[];
  const garminDevices: GarminDevice[] = devRows.map((d) => ({ id: d.id, name: deviceName(d.model), app: d.app_version, createdAt: d.created_at, lastSeenAt: d.last_seen_at }));
  return <TreningClient plan={script} planLabel={planLabel} ftp={ftp} firstName={firstName} briefing={briefing} racePacing={racePacing} garminDevices={garminDevices} />;
}
