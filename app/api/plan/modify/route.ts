import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { type PlanDay, type ModifyContext } from '@/lib/ai/plan-generate';
import { computePlanModification, applyPlanModification } from '@/lib/ai/plan-modify';
import { localTodayISO } from '@/lib/plan';

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const weekStart = typeof body.weekStart === 'string' ? body.weekStart : '';
  if (!message || !weekStart) {
    return NextResponse.json({ ok: false, error: 'missing_params' }, { status: 400 });
  }

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, ftp_watts')
    .eq('user_id', user.id)
    .single();
  if (!athlete) return NextResponse.json({ ok: false, error: 'athlete_not_found' }, { status: 404 });
  const athleteId = athlete.id as string;
  const todayIso = new Date().toISOString().slice(0, 10);

  const [{ data: plan }, { data: fm }, { data: race }] = await Promise.all([
    supabase.from('weekly_plans').select('id, plan_json').eq('athlete_id', athleteId).eq('week_start', weekStart).maybeSingle(),
    supabase.from('fitness_metrics').select('ctl').eq('athlete_id', athleteId).order('date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('race_calendar').select('name, date').eq('athlete_id', athleteId).gte('date', todayIso).order('date', { ascending: true }).limit(1).maybeSingle(),
  ]);

  if (!plan) return NextResponse.json({ ok: false, error: 'plan_not_found' }, { status: 404 });

  const currentDays = (plan.plan_json as { days: PlanDay[] }).days;
  const ctx: ModifyContext = {
    lockedDows: currentDays.filter((d) => d.locked).map((d) => d.dow),
    ftp: (athlete.ftp_watts as number | null) ?? 250,
    ctl: fm?.ctl != null ? Number(fm.ctl) : null,
    raceName: (race?.name as string | null) ?? null,
    daysToRace: race?.date
      ? Math.round((new Date(race.date as string).getTime() - new Date(todayIso).getTime()) / 86400000)
      : null,
  };

  // Wspólna pipeline (prompt + walidacja + lockSet #43 + structure + past-day guard #44).
  const comp = await computePlanModification(currentDays, ctx, message, weekStart, localTodayISO());
  if (!comp.ok) return NextResponse.json({ ok: false, error: comp.error }, { status: 502 });

  await applyPlanModification(supabase, plan.id as string, comp.result);

  return NextResponse.json({
    ok: true,
    days: comp.result.days,
    insight: comp.result.insight, // stan tygodnia → karta planu (overrideInsight)
    change: comp.result.change,   // opis zmiany → wiadomość w czacie
    skippedPastDows: comp.result.skippedPastDows,
  });
}
