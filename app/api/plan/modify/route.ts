import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import { buildModifyPrompt, validateWeek, parseCommandDows, type PlanDay, type ModifyContext } from '@/lib/ai/plan-generate';

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
  const lockedDows = currentDays.filter((d) => d.locked).map((d) => d.dow);
  const ctx: ModifyContext = {
    lockedDows,
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
      // ── TWARDY ENFORCEMENT lockowanych dni (serwer, NIE ufamy AI przy lockowaniu) ──
      // LOCK SET = dni JAWNIE wskazane przez usera (AI: userSpecifiedDays) ∩ dni faktycznie
      // obecne w SUROWYM tekście komendy (leksykon parseCommandDows). Przecięcie jest jednostronne:
      // może lock set tylko ZWĘZIĆ, nigdy poszerzyć → dzień nieobecny w tekście NIE zostanie
      // zlockowany, choćby AI wrzucił go do userSpecifiedDays. Over-locking niemożliwy z konstrukcji.
      // changedDays (bilansowanie AI, np. Cz/Pt) NIE lockuje — dni przebudowane zostają skalowalne suwakiem.
      const off = new Set<number>(Array.isArray(parsed.off) ? parsed.off.map(Number) : []);
      const unlock = new Set<number>(Array.isArray(parsed.unlock) ? parsed.unlock.map(Number) : []);
      const userSpecified = new Set<number>(Array.isArray(parsed.userSpecifiedDays) ? parsed.userSpecifiedDays.map(Number) : []);
      const commandDays = new Set<number>(parseCommandDows(message));
      const lockSet = new Set<number>(Array.from(userSpecified).filter((d) => commandDays.has(d)));
      // Każdy case ma JAWNY warunek (nie polega na pozycji w łańcuchu).
      days = v.days.map((aiDay) => {
        const dow = aiDay.dow;
        const orig = currentDays.find((o) => o.dow === dow);
        // 0. JAWNE WOLNE (off) → typ OFF. locked TYLKO gdy dzień w lock set (jawnie wymieniony w komendzie).
        if (off.has(dow)) {
          return { ...aiDay, type: 'OFF' as const, label: 'Odpoczynek', tss: 0, dur_min: 0, watt: '–', hr: '–', zones: [0, 0, 0, 0, 0], locked: lockSet.has(dow) };
        }
        // 1. jawne odblokowanie → zmiana AI + zdejmij lock
        if (unlock.has(dow)) return { ...aiDay, locked: false };
        // 2. dzień JAWNIE WSKAZANY w komendzie (lock set) → zmiana AI + lock
        if (lockSet.has(dow)) return { ...aiDay, locked: true };
        // 3. lock z POPRZEDNICH komend (orig.locked), NIE ruszany teraz → PRZYWRÓĆ oryginał (immutability).
        if (orig?.locked) return { ...orig };
        // 4. dzień przebudowany przez AI (bilansowanie) albo nietknięty, bez wcześniejszego locka → BEZ locka.
        return { ...aiDay, locked: false };
      });
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
