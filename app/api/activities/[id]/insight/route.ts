import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import { buildInsightPrompt, type InsightActivity } from '@/lib/ai/insight';
import { fetchPlannedDay } from '@/lib/planned-day';
import { fetchRaceDay } from '@/lib/race-day';
import { aiErrorMessage } from '@/lib/ai/ai-error';
import {
  buildFormSignals, insightFingerprint,
  type RecentRide, type CurrentRide, type FitnessTrend,
} from '@/lib/ai/insight-context';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ACTIVITY_SELECT =
  'athlete_id, name, activity_date, type, distance_km, elevation_m, duration_seconds, tss, avg_watts, avg_hr, max_hr, normalized_power, best_efforts, laps, details_synced_at, insight_text, insight_generated_at, insight_inputs_hash';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const stravaActivityId = params.id;
  const supabase = createServerSupabaseClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  // ring% dosyłany przez klienta (streams liczą się po stronie karty — serwer ich nie ma).
  const body = await req.json().catch(() => ({}));
  const pct = typeof body?.pct === 'number' ? body.pct : null;

  const { data: activity } = await supabase
    .from('strava_activities').select(ACTIVITY_SELECT)
    .eq('strava_activity_id', stravaActivityId).maybeSingle();
  if (!activity) return NextResponse.json({ error: 'activity_not_found' }, { status: 404 });

  const { data: athlete } = await supabase
    .from('athletes').select('id, user_id, ftp_watts, training_mode')
    .eq('id', activity.athlete_id).single();
  if (!athlete) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });
  if (athlete.user_id !== authUser.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const planned = await fetchPlannedDay(supabase, athlete.id as string, activity.activity_date as string);
  // Twardy sygnał "to wyścig" z race_calendar (źródło prawdy) — NIE z type==='RACE' (dzień bywa
  // Z2 z metadaną race) ani z nazwy jazdy. Steruje gałęzią RACE promptu + wycięciem sygnałów HR.
  const race = await fetchRaceDay(supabase, athlete.id as string, activity.activity_date as string);
  const isRace = race != null;

  // ── Cache: fingerprint wejść (details / plan / pct / metryki / race). Zgodny → zwróć, ZERO calla. ──
  const fingerprint = insightFingerprint({
    detailsSyncedAt: activity.details_synced_at as string | null,
    planned,
    pct,
    tss: activity.tss as number | null,
    np: activity.normalized_power as number | null,
    avgHr: activity.avg_hr as number | null,
    durationSec: activity.duration_seconds as number | null,
    isRace,
  });
  if (activity.insight_text && activity.insight_inputs_hash === fingerprint) {
    return NextResponse.json({ insight: activity.insight_text, cached: true });
  }

  // ── Kontekst formy: trend CTL/TSB (7d) + jazdy 90 dni (EF, tętno@moc) ──
  const isEbike = activity.type === 'EBikeRide';
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const [{ data: fmRows }, { data: recent }] = await Promise.all([
    supabase.from('fitness_metrics').select('date, ctl, tsb').eq('athlete_id', athlete.id).order('date', { ascending: false }).limit(8),
    supabase.from('strava_activities')
      .select('activity_date, normalized_power, avg_hr, tss')
      .eq('athlete_id', athlete.id)
      .neq('strava_activity_id', stravaActivityId) // wyklucz bieżącą jazdę z bazy porównawczej
      .gte('activity_date', since).order('activity_date', { ascending: false }),
  ]);

  const fm = (fmRows ?? []) as { date: string; ctl: number | null; tsb: number | null }[];
  const trend: FitnessTrend = {
    ctlNow: fm[0]?.ctl ?? null,
    ctl7ago: fm[7]?.ctl ?? null,
    tsbNow: fm[0]?.tsb ?? null,
  };
  const cur: CurrentRide = {
    normalized_power: activity.normalized_power as number | null,
    avg_hr: activity.avg_hr as number | null,
    tss: activity.tss as number | null,
    duration_seconds: activity.duration_seconds as number | null,
    details_synced_at: activity.details_synced_at as string | null,
  };
  const signals = buildFormSignals(cur, (recent ?? []) as RecentRide[], trend, pct, isEbike, isRace);

  const { system, user } = buildInsightPrompt(
    activity as unknown as InsightActivity,
    (athlete.ftp_watts as number | null) ?? null,
    (athlete.training_mode as string | null) ?? null,
    planned,
    signals,
    race
  );

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 450, system,
      messages: [{ role: 'user', content: user }],
    });
    const insight = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';

    // Zapis cache — best effort (błąd zapisu nie psuje odpowiedzi; kolejne otwarcie zregeneruje).
    if (insight) {
      await supabase.from('strava_activities')
        .update({ insight_text: insight, insight_generated_at: new Date().toISOString(), insight_inputs_hash: fingerprint })
        .eq('strava_activity_id', stravaActivityId).eq('athlete_id', athlete.id);
    }
    return NextResponse.json({ insight, cached: false });
  } catch (err: unknown) {
    return NextResponse.json({ error: aiErrorMessage(err), unavailable: true }, { status: 503 });
  }
}
