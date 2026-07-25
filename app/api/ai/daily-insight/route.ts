import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import { aiErrorMessage } from '@/lib/ai/ai-error';
import {
  buildDailyInsightPrompt,
  buildRaceContext,
  enforceInsightSafety,
  type DailyInsightMetrics,
  type PlanDaySlim,
  type YesterdayContext,
  type RaceContext,
} from '@/lib/ai/dailyInsight';
import type { RacePriority } from '@/lib/race-taper';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface PlanDayRow {
  dow: number;
  type: string;
  label: string;
}

// Dzień planu dla konkretnej DATY (obsługuje granicę tygodnia — wczoraj może być w poprzednim).
async function planDayFor(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  athleteId: string,
  date: Date
): Promise<PlanDaySlim | null> {
  const dow = ((date.getUTCDay() + 6) % 7) + 1; // 1=Pn … 7=Nd
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - (dow - 1));
  const weekStart = monday.toISOString().slice(0, 10);

  const { data: plan } = await supabase
    .from('weekly_plans')
    .select('plan_json')
    .eq('athlete_id', athleteId)
    .eq('week_start', weekStart)
    .maybeSingle();

  const day = (plan?.plan_json as { days?: PlanDayRow[] } | null)?.days?.find((x) => x.dow === dow);
  if (!day) return null;
  return { type: day.type, label: day.label };
}

// Dopasowane WYKONANIE dnia = jazda o najwyższym TSS tej daty (spójnie z insight/describe).
async function executedFor(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  athleteId: string,
  isoDate: string
): Promise<YesterdayContext['executed']> {
  const { data: rides } = await supabase
    .from('strava_activities')
    .select('name, type, tss')
    .eq('athlete_id', athleteId)
    .eq('activity_date', isoDate);
  if (!rides || rides.length === 0) return null;
  const top = [...rides].sort((a, b) => (Number(b.tss) || 0) - (Number(a.tss) || 0))[0];
  return { type: (top.type as string | null) ?? null, tss: top.tss != null ? Number(top.tss) : null, name: (top.name as string | null) ?? null };
}

// Najbliższy nadchodzący start (date >= dziś). null = brak → Insight działa bez weta.
async function nextRace(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  athleteId: string,
  todayIso: string,
  today: Date
): Promise<RaceContext | null> {
  const { data: race } = await supabase
    .from('race_calendar')
    .select('name, date, priority')
    .eq('athlete_id', athleteId)
    .gte('date', todayIso)
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!race) return null;
  const raceDate = new Date((race.date as string) + 'T00:00:00Z');
  const daysToRace = Math.round((raceDate.getTime() - today.getTime()) / 86400000);
  return buildRaceContext(race.name as string, (race.priority as RacePriority) ?? 'C', daysToRace);
}

export async function GET() {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, name')
    .eq('user_id', user.id)
    .single();
  if (!athlete) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });

  const athleteId = athlete.id as string;

  // "Dziś" = realna data serwera (plan/start liczymy od dziś, TSB z ostatniego wiersza PMC).
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const todayIso = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setUTCDate(today.getUTCDate() - 1);
  const yesterdayIso = yesterday.toISOString().slice(0, 10);

  const [{ data: rows }, todayPlan, yPlan, yExec, race] = await Promise.all([
    supabase
      .from('fitness_metrics')
      .select('date, ctl, atl, tsb')
      .eq('athlete_id', athleteId)
      .order('date', { ascending: true }),
    planDayFor(supabase, athleteId, today),
    planDayFor(supabase, athleteId, yesterday),
    executedFor(supabase, athleteId, yesterdayIso),
    nextRace(supabase, athleteId, todayIso, today),
  ]);

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'no_metrics' }, { status: 404 });
  }

  const now = rows[rows.length - 1];
  const peakCtl = rows.reduce((mx, r) => Math.max(mx, Number(r.ctl)), 0);
  const prev = rows[Math.max(0, rows.length - 8)];
  const ctlRamp = +(Number(now.ctl) - Number(prev.ctl)).toFixed(1);

  const yesterdayCtx: YesterdayContext = { plan: yPlan, executed: yExec };
  const metrics: DailyInsightMetrics = {
    date: now.date as string,
    ctl: Number(now.ctl),
    atl: Number(now.atl),
    tsb: Number(now.tsb),
    peakCtl,
    ctlRamp,
  };

  const { system, user: userMsg } = buildDailyInsightPrompt(metrics, todayPlan, yesterdayCtx, race, (athlete as { name?: string | null }).name ?? null);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 160,
      system,
      messages: [{ role: 'user', content: userMsg }],
    });
    const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
    // HARD-CHECK NA WYJŚCIU: w oknie taperu A docisk/intensywność → podmiana na fallback (gwarancja w kodzie).
    const { text: insight } = enforceInsightSafety(raw, metrics, todayPlan, yesterdayCtx, race);
    return NextResponse.json({ insight });
  } catch (err: unknown) {
    // Czytelny komunikat zamiast surowego err.message — klient (DailyInsight) i tak ma
    // własny statyczny fallback ("WSKAZÓWKA"), więc karta się nie psuje.
    return NextResponse.json({ error: aiErrorMessage(err), unavailable: true }, { status: 503 });
  }
}
