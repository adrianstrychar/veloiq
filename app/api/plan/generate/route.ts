import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
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

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  // Opcje generowania (legalne funkcje, działają za sesją): dry_run = podgląd bez
  // zapisu, intensity/target_tss = nadpisanie celu tygodniowego (pod 5.6/5.7).
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = (body as Record<string, unknown>)?.dry_run === true;
  const overrideTarget = Number((body as Record<string, unknown>)?.target_tss) > 0
    ? Math.round(Number((body as Record<string, unknown>).target_tss)) : null;
  const intensityMul = Number((body as Record<string, unknown>)?.intensity) > 0
    ? Number((body as Record<string, unknown>).intensity) : 1.1;

  // ── Dane wejściowe z bazy ──
  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, ftp_watts, weight_kg, vo2max, training_mode')
    .eq('user_id', authUser.id)
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

  // IDEMPOTENTNY RE-CHECK (anti-double-gen dla lazy promocji szkicu). Jeśli kotwiczny tydzień ma
  // już PEŁNY plan (żaden dzień nie jest outline), ktoś go zdążył wygenerować/awansować —
  // refresh po zakończeniu albo równoległe żądanie. Nie wołaj AI drugi raz. Pusty wiersz/szkic
  // (są dni outline) → przechodzimy dalej i generujemy. Rzadkie równoległe żądania w oknie przed
  // pierwszym zapisem dadzą co najwyżej podwójny koszt AI, bez korupcji (upsert nadpisuje spójnie).
  if (!dryRun) {
    const { data: anchorRow } = await supabase
      .from('weekly_plans')
      .select('plan_json')
      .eq('athlete_id', athleteId)
      .eq('week_start', weekStart)
      .maybeSingle();
    const anchorDays = ((anchorRow?.plan_json as { days?: { outline?: boolean }[] } | null)?.days) ?? [];
    if (anchorDays.length > 0 && anchorDays.every((d) => !d.outline)) {
      return NextResponse.json({ ok: true, already_promoted: true });
    }
  }
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
        max_tokens: 16000, // structure + reguła spójności minut → model liczy w prozie (bywa >8k tokenów) przed JSON-em; walidator wycina sam JSON (kotwica "current")
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
    // UWAGA: `row` CELOWO nie zawiera `user_hours`. Przy promocji/regeneracji bieżący tydzień to
    // ten sam wiersz, który trzyma ręczny wybór godzin suwaka (weekly_plans.user_hours). Supabase
    // .update(row) generuje SET tylko dla podanych kluczy, więc pominięcie tej kolumny ZACHOWUJE
    // wybór usera. NIE dopisywać user_hours (ani nie zamieniać na upsert pełnego wiersza) — to po
    // cichu skasowałoby wybór godzin przy każdej regeneracji. Pominięcie jest zamierzone.
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
