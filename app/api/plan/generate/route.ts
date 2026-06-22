import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  buildPlanPrompt,
  validatePlan,
  mondayOf,
  type GeneratorInputs,
  type PlanDay,
} from '@/lib/ai/plan-generate';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// TODO: usunąć DEV_SECRET przed produkcją
const DEV_SECRET = process.env.DEV_TEST_SECRET ?? 'veloiq-dev-2026';

function makeAdminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function POST(req: NextRequest) {
  const isDevBypass =
    req.headers.get('x-dev-secret') === DEV_SECRET &&
    process.env.NODE_ENV !== 'production';

  let supabase: SupabaseClient;
  let athleteFilter: { col: 'user_id' | 'id'; val: string };

  if (isDevBypass) {
    // TODO: usunąć ten blok przed produkcją — tylko do testów lokalnych
    supabase = makeAdminClient();
    const { data: ath } = await supabase.from('athletes').select('id').limit(1).maybeSingle();
    if (!ath) return NextResponse.json({ error: 'no_athlete' }, { status: 404 });
    athleteFilter = { col: 'id', val: ath.id as string };
  } else {
    supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    athleteFilter = { col: 'user_id', val: user.id };
  }

  // ── Dane wejściowe z bazy ──
  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, ftp_watts, weight_kg, vo2max, training_mode')
    .eq(athleteFilter.col, athleteFilter.val)
    .single();

  if (!athlete) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });
  const athleteId = athlete.id as string;

  const todayIso = new Date().toISOString().slice(0, 10);

  const [{ data: fm }, { data: race }] = await Promise.all([
    supabase
      .from('fitness_metrics')
      .select('ctl, atl, tsb')
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

  const weekStart = mondayOf(new Date());
  const ctl = fm?.ctl != null ? Number(fm.ctl) : null;
  const daysToRace = race?.date
    ? Math.round((new Date(race.date).getTime() - new Date(todayIso).getTime()) / 86400000)
    : null;
  // Cel tygodniowy: CTL*7 z lekką progresją; fallback gdy brak CTL
  const weeklyTssTarget = ctl != null ? Math.round(ctl * 7 * 1.1) : 350;

  const inputs: GeneratorInputs = {
    weekStart,
    ftp: (athlete.ftp_watts as number) ?? 250,
    mass: (athlete.weight_kg as number | null) ?? null,
    vo2max: (athlete.vo2max as number | null) ?? null,
    ctl,
    atl: fm?.atl != null ? Number(fm.atl) : null,
    tsb: fm?.tsb != null ? Number(fm.tsb) : null,
    raceName: (race?.name as string | null) ?? null,
    raceDate: (race?.date as string | null) ?? null,
    daysToRace,
    weeklyTssTarget,
  };

  const { system, user } = buildPlanPrompt(inputs);

  // ── Wywołanie AI z 1 retry przy błędzie walidacji ──
  let days: PlanDay[] | undefined;
  let insight = '';
  let lastErr = '';
  let tokensUsed = 0;
  let aiModel = 'claude-sonnet-4-6';

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system,
        messages: [{ role: 'user', content: user }],
      });
      aiModel = response.model;
      tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
      const txt = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const v = validatePlan(txt, weekStart);
      if (v.ok && v.days) {
        days = v.days;
        insight = v.insight ?? '';
        break;
      }
      lastErr = v.error ?? 'walidacja nieudana';
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  if (!days) {
    return NextResponse.json({ error: `generowanie nieudane: ${lastErr}` }, { status: 502 });
  }

  // ── Ręczny upsert do weekly_plans (działa bez unique constraintu) ──
  const totalTss = days.reduce((a, d) => a + d.tss, 0);
  const row = {
    athlete_id: athleteId,
    week_start: weekStart,
    plan_json: { days, insight },
    ctl_at_generation: inputs.ctl,
    atl_at_generation: inputs.atl,
    tsb_at_generation: inputs.tsb,
    weekly_tss_target: totalTss,
    generated_by: 'manual' as const,
    ai_model: aiModel,
    tokens_used: tokensUsed,
  };

  const { data: existing } = await supabase
    .from('weekly_plans')
    .select('id')
    .eq('athlete_id', athleteId)
    .eq('week_start', weekStart)
    .maybeSingle();

  let saveErr;
  if (existing) {
    ({ error: saveErr } = await supabase.from('weekly_plans').update(row).eq('id', existing.id));
  } else {
    ({ error: saveErr } = await supabase.from('weekly_plans').insert(row));
  }

  if (saveErr) {
    return NextResponse.json({ error: `zapis nieudany: ${saveErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    week_start: weekStart,
    total_tss: totalTss,
    insight,
    days: days.map((d) => ({ dow: d.dow, date: d.date, type: d.type, label: d.label, tss: d.tss, dur_min: d.dur_min })),
  });
}
