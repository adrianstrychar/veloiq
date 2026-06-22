import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import { buildModifyPrompt, validateWeek, type PlanDay, type ModifyContext } from '@/lib/ai/plan-generate';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
    supabase
      .from('weekly_plans')
      .select('id, plan_json')
      .eq('athlete_id', athleteId)
      .eq('week_start', weekStart)
      .maybeSingle(),
    supabase
      .from('fitness_metrics')
      .select('ctl')
      .eq('athlete_id', athleteId)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('race_calendar')
      .select('name, date')
      .eq('athlete_id', athleteId)
      .gte('date', todayIso)
      .order('date', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!plan) return NextResponse.json({ ok: false, error: 'plan_not_found' }, { status: 404 });

  const currentDays = (plan.plan_json as { days: PlanDay[] }).days;
  const ctx: ModifyContext = {
    ftp: (athlete.ftp_watts as number | null) ?? 250,
    ctl: fm?.ctl != null ? Number(fm.ctl) : null,
    raceName: (race?.name as string | null) ?? null,
    daysToRace: race?.date
      ? Math.round((new Date(race.date as string).getTime() - new Date(todayIso).getTime()) / 86400000)
      : null,
  };

  const { system, user: userMsg } = buildModifyPrompt(currentDays, ctx, message);

  // 1 retry przy błędzie strukturalnym walidacji (jak generate).
  let days: PlanDay[] | undefined;
  let insight = '';
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system,
        messages: [{ role: 'user', content: userMsg }],
      });
      const txt = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const a = txt.indexOf('{');
      const b = txt.lastIndexOf('}');
      if (a === -1 || b <= a) { lastErr = 'brak JSON'; continue; }
      const parsed = JSON.parse(txt.slice(a, b + 1));
      const v = validateWeek(parsed.days, weekStart, { outline: false });
      if (!v.ok || !v.days) { lastErr = v.error ?? 'walidacja nieudana'; continue; }
      days = v.days;
      insight = typeof parsed.insight === 'string' ? parsed.insight : 'Plan zaktualizowany.';
      break;
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  if (!days) return NextResponse.json({ ok: false, error: lastErr }, { status: 502 });

  const planJson = { days, insight };
  await supabase
    .from('weekly_plans')
    .update({ plan_json: planJson, weekly_tss_target: days.reduce((s, d) => s + d.tss, 0) })
    .eq('id', plan.id);

  return NextResponse.json({ ok: true, days, insight });
}
