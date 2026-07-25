import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import { aiErrorMessage } from '@/lib/ai/ai-error';
import { buildDailyBriefPrompt, type BriefInputs } from '@/lib/ai/dailyBrief';
import { computePowerByPeriod, POWER_DURATIONS, type PowerDuration } from '@/lib/dashboard-engagement';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const HAIKU = 'claude-haiku-4-5-20251001'; // tier #104 (spójnie z chat-intent)

const DUR_LABEL: Record<PowerDuration, string> = { '5s': '5 s', '1min': '1 min', '5min': '5 min', '20min': '20 min' };

interface PlanDayRow { dow: number; type: string; label: string }

// Dzień planu dla daty (dow 1=Pn..7=Nd; obsługuje granicę tygodnia jak daily-insight).
async function todayPlanFor(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  athleteId: string,
  date: Date
): Promise<{ type: string; label: string } | null> {
  const dow = ((date.getUTCDay() + 6) % 7) + 1;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - (dow - 1));
  const { data: plan } = await supabase
    .from('weekly_plans')
    .select('plan_json')
    .eq('athlete_id', athleteId)
    .eq('week_start', monday.toISOString().slice(0, 10))
    .maybeSingle();
  const day = (plan?.plan_json as { days?: PlanDayRow[] } | null)?.days?.find((x) => x.dow === dow);
  return day ? { type: day.type, label: day.label } : null;
}

export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, name, daily_brief_text, daily_brief_date')
    .eq('user_id', user.id)
    .single();
  if (!athlete) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });
  const athleteId = athlete.id as string;

  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const todayIso = today.toISOString().slice(0, 10);
  const sevenAgoIso = new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10);

  // Dane WYŁĄCZNIE do briefu (TSB, dzisiejsza sesja, najbliższy start, moc do świeżego rekordu).
  // Startery są statyczne → zero dodatkowych zapytań pod nie.
  const [{ data: metrics }, todaySession, { data: race }, { data: powerRides }] = await Promise.all([
    supabase.from('fitness_metrics').select('tsb').eq('athlete_id', athleteId).order('date', { ascending: false }).limit(1).maybeSingle(),
    todayPlanFor(supabase, athleteId, today),
    supabase.from('race_calendar').select('name, date').eq('athlete_id', athleteId).gte('date', todayIso).order('date', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('strava_activities').select('activity_date, best_efforts, start_date_local:raw_data->start_date_local').eq('athlete_id', athleteId).not('best_efforts', 'is', null).order('activity_date', { ascending: true }),
  ]);

  const isRest = !todaySession || todaySession.type === 'OFF';
  const raceCtx = race
    ? { name: race.name as string, days: Math.round((new Date((race.date as string) + 'T00:00:00Z').getTime() - today.getTime()) / 86400000) }
    : null;

  // Świeży rekord: rekord sezonu któregoś czasu mocy padł w ostatnich 7 dniach (preferuj dłuższy czas).
  const power = computePowerByPeriod(
    (powerRides ?? []).map((r) => ({
      date: (typeof (r as { start_date_local?: unknown }).start_date_local === 'string' ? (r as { start_date_local: string }).start_date_local : (r.activity_date as string)).slice(0, 10),
      best_efforts: (r as { best_efforts?: Record<string, number | null> | null }).best_efforts ?? null,
    })),
    today
  );
  let freshRecord: string | null = null;
  for (const dur of [...POWER_DURATIONS].reverse()) { // 20min → 5s (dłuższy = bardziej znaczący)
    const p = power.find((x) => x.dur === dur);
    if (p?.season != null && p.seasonDate != null && p.seasonDate >= sevenAgoIso) { freshRecord = `moc ${DUR_LABEL[dur]} ${p.season} W`; break; }
  }

  // Cache: brief tekstowy z dziś → zwróć bez generacji. Inaczej Haiku + zapis.
  if (athlete.daily_brief_date === todayIso && typeof athlete.daily_brief_text === 'string' && athlete.daily_brief_text.length > 0) {
    return NextResponse.json({ brief: athlete.daily_brief_text, cached: true });
  }

  const inputs: BriefInputs = {
    name: (athlete.name as string | null) ?? null, // pełne name; buildDailyBriefPrompt bierze firstName

    tsb: metrics?.tsb != null ? Number(metrics.tsb) : 0,
    todaySession: todaySession ? { type: todaySession.type, label: todaySession.label } : null,
    isRest,
    race: raceCtx,
    freshRecord,
  };
  const { system, user: userMsg } = buildDailyBriefPrompt(inputs);

  try {
    const response = await anthropic.messages.create({
      model: HAIKU,
      max_tokens: 220,
      system,
      messages: [{ role: 'user', content: userMsg }],
    });
    const brief = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    if (brief) {
      await supabase.from('athletes').update({ daily_brief_text: brief, daily_brief_date: todayIso, daily_brief_generated_at: new Date().toISOString() }).eq('id', athleteId);
    }
    return NextResponse.json({ brief, cached: false });
  } catch (err: unknown) {
    // Brief niedostępny → briefText null; startery (statyczne) i tak się pokażą. Nie psujemy czatu.
    return NextResponse.json({ brief: null, error: aiErrorMessage(err) }, { status: 200 });
  }
}
