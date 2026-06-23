import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import { buildInsightPrompt, type InsightActivity } from '@/lib/ai/insight';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ACTIVITY_SELECT =
  'athlete_id, name, activity_date, type, distance_km, elevation_m, duration_seconds, tss, avg_watts, avg_hr, max_hr, normalized_power, best_efforts, laps';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const stravaActivityId = params.id;

  const supabase = createServerSupabaseClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  // Pobierz jazdę
  const { data: activity } = await supabase
    .from('strava_activities')
    .select(ACTIVITY_SELECT)
    .eq('strava_activity_id', stravaActivityId)
    .maybeSingle();

  if (!activity) return NextResponse.json({ error: 'activity_not_found' }, { status: 404 });

  // Profil atlety (ownership + FTP + tryb)
  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, user_id, ftp_watts, training_mode')
    .eq('id', activity.athlete_id)
    .single();

  if (!athlete) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });
  if (athlete.user_id !== authUser.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { system, user } = buildInsightPrompt(
    activity as unknown as InsightActivity,
    (athlete.ftp_watts as number | null) ?? null,
    (athlete.training_mode as string | null) ?? null
  );

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 450,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const insight = response.content[0]?.type === 'text' ? response.content[0].text : '';
    return NextResponse.json({ insight });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
