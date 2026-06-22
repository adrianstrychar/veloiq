import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  buildTwoWeekPrompt,
  validateTwoWeekPlan,
  tssBand,
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

  // Furtka na przyszłość (5.6 suwak / 5.7 czat "mocniejszy tydzień") + dry_run do
  // bezpiecznego testu bez zapisu. Body opcjonalne.
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = (body as Record<string, unknown>)?.dry_run === true;
  const overrideTarget = Number((body as Record<string, unknown>)?.target_tss) > 0
    ? Math.round(Number((body as Record<string, unknown>).target_tss)) : null;
  const intensityMul = Number((body as Record<string, unknown>)?.intensity) > 0
    ? Number((body as Record<string, unknown>).intensity) : 1.1;

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

  // Anchor: week_start z body (przycisk "Wygeneruj" dla konkretnego tygodnia) albo bieżący tydzień.
  const weekStartParam = typeof (body as Record<string, unknown>)?.week_start === 'string'
    ? String((body as Record<string, unknown>).week_start)
    : null;
  const weekStart = weekStartParam ? mondayOf(new Date(weekStartParam)) : mondayOf(new Date());
  const ctl = fm?.ctl != null ? Number(fm.ctl) : null;
  const daysToRace = race?.date
    ? Math.round((new Date(race.date).getTime() - new Date(todayIso).getTime()) / 86400000)
    : null;
  // Cel tygodniowy: override z body albo CTL*7*intensity (domyślnie 1.1); fallback gdy brak CTL
  const baseTarget = ctl != null ? Math.round(ctl * 7 * intensityMul) : 350;
  const weeklyTssTarget = overrideTarget ?? baseTarget;
  const nextWeeklyTssTarget = Math.round(weeklyTssTarget * 1.05); // sensowna progresja, nie skok

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
    nextWeeklyTssTarget,
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
        max_tokens: 3500,
        system,
        messages: [{ role: 'user', content: user }],
      });
      aiModel = response.model;
      tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
      const txt = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const v = validateTwoWeekPlan(txt, weekStart, nextWeek);
      if (!v.ok || !v.current || !v.next) {
        lastErr = v.error ?? 'walidacja nieudana';
        continue;
      }
      // Walidacja przedziału TSS — bezpieczny bufor ±10/+15% (szerszy niż prompt),
      // ale blokuje rozjazd typu +36%. Poza przedziałem → retry jak błąd struktury.
      const sumCur = v.current.days.reduce((a, d) => a + d.tss, 0);
      const sumNext = v.next.days.reduce((a, d) => a + d.tss, 0);
      const [curLo, curHi] = tssBand(weeklyTssTarget, 0.90, 1.15);
      const [nxtLo, nxtHi] = tssBand(nextWeeklyTssTarget, 0.90, 1.15);
      if (sumCur < curLo || sumCur > curHi) {
        lastErr = `bieżący TSS ${sumCur} poza przedziałem ${curLo}–${curHi}`;
        continue;
      }
      if (sumNext < nxtLo || sumNext > nxtHi) {
        lastErr = `następny TSS ${sumNext} poza przedziałem ${nxtLo}–${nxtHi}`;
        continue;
      }
      current = v.current;
      next = v.next;
      break;
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  if (!current || !next) {
    return NextResponse.json({ error: `generowanie nieudane: ${lastErr}` }, { status: 502 });
  }

  const summary = (w: { days: PlanDay[] }) => w.days.map((d) => ({
    dow: d.dow, date: d.date, type: d.type, tss: d.tss, dur_min: d.dur_min, outline: d.outline,
  }));
  const curPayload = { week_start: weekStart, total_tss: current.days.reduce((a, d) => a + d.tss, 0), insight: current.insight, days: summary(current) };
  const nextPayload = { week_start: nextWeek, total_tss: next.days.reduce((a, d) => a + d.tss, 0), insight: next.insight, days: summary(next) };

  // dry_run: zwróć wynik BEZ zapisu (test bez nadpisywania istniejącego planu)
  if (dryRun) {
    return NextResponse.json({ ok: true, dry_run: true, target: weeklyTssTarget, next_target: nextWeeklyTssTarget, current: curPayload, next: nextPayload });
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

  return NextResponse.json({ ok: true, current: curPayload, next: nextPayload });
}
