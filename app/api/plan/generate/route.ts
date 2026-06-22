import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  buildTwoWeekPrompt,
  validateTwoWeekPlan,
  mondayOf,
  nextWeekStart,
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

  const nextWeek = nextWeekStart(weekStart);
  const { system, user } = buildTwoWeekPrompt(inputs);

  // ── Wywołanie AI (jedno, zwraca oba tygodnie) z 1 retry przy błędzie walidacji ──
  let current: { days: PlanDay[]; insight: string } | undefined;
  let next: { days: PlanDay[]; insight: string } | undefined;
  let lastErr = '';
  let tokensUsed = 0;
  let aiModel = 'claude-sonnet-4-6';

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        system,
        messages: [{ role: 'user', content: user }],
      });
      aiModel = response.model;
      tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
      const txt = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const v = validateTwoWeekPlan(txt, weekStart, nextWeek);
      if (v.ok && v.current && v.next) {
        current = v.current;
        next = v.next;
        break;
      }
      lastErr = v.error ?? 'walidacja nieudana';
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  if (!current || !next) {
    return NextResponse.json({ error: `generowanie nieudane: ${lastErr}` }, { status: 502 });
  }

  // ── Ręczny upsert tygodnia do weekly_plans (działa bez unique constraintu) ──
  async function upsertWeek(ws: string, days: PlanDay[], insight: string) {
    const row = {
      athlete_id: athleteId,
      week_start: ws,
      plan_json: { days, insight },
      ctl_at_generation: inputs.ctl,
      atl_at_generation: inputs.atl,
      tsb_at_generation: inputs.tsb,
      weekly_tss_target: days.reduce((a, d) => a + d.tss, 0),
      generated_by: 'manual' as const,
      ai_model: aiModel,
      tokens_used: tokensUsed,
    };
    const { data: existing } = await supabase
      .from('weekly_plans')
      .select('id')
      .eq('athlete_id', athleteId)
      .eq('week_start', ws)
      .maybeSingle();
    if (existing) {
      return supabase.from('weekly_plans').update(row).eq('id', existing.id);
    }
    return supabase.from('weekly_plans').insert(row);
  }

  const [curRes, nextRes] = await Promise.all([
    upsertWeek(weekStart, current.days, current.insight),
    upsertWeek(nextWeek, next.days, next.insight),
  ]);
  const saveErr = curRes.error || nextRes.error;
  if (saveErr) {
    return NextResponse.json({ error: `zapis nieudany: ${saveErr.message}` }, { status: 500 });
  }

  const summary = (w: { days: PlanDay[] }) => w.days.map((d) => ({
    dow: d.dow, date: d.date, type: d.type, tss: d.tss, dur_min: d.dur_min, outline: d.outline,
  }));

  return NextResponse.json({
    ok: true,
    current: { week_start: weekStart, total_tss: current.days.reduce((a, d) => a + d.tss, 0), insight: current.insight, days: summary(current) },
    next: { week_start: nextWeek, total_tss: next.days.reduce((a, d) => a + d.tss, 0), insight: next.insight, days: summary(next) },
  });
}
