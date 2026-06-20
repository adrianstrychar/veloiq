import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildInsightPrompt, type InsightActivity } from '@/lib/ai/insight';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// TODO: usunąć DEV_SECRET przed produkcją
const DEV_SECRET = process.env.DEV_TEST_SECRET ?? 'veloiq-dev-2026';

function makeAdminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

const ACTIVITY_SELECT =
  'athlete_id, name, activity_date, type, distance_km, elevation_m, duration_seconds, tss, avg_watts, avg_hr, max_hr, normalized_power, best_efforts, laps';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const stravaActivityId = params.id;
  const isDevBypass =
    req.headers.get('x-dev-secret') === DEV_SECRET &&
    process.env.NODE_ENV !== 'production';

  let supabase: SupabaseClient;
  let userId: string | null = null;

  if (isDevBypass) {
    // TODO: usunąć ten blok przed produkcją — tylko do testów lokalnych
    supabase = makeAdminClient();
  } else {
    supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    userId = user.id;
  }

  // Pobierz jazdę
  const { data: activity } = await supabase
    .from('strava_activities')
    .select(ACTIVITY_SELECT)
    .eq('strava_activity_id', stravaActivityId)
    .maybeSingle();

  if (!activity) return NextResponse.json({ error: 'activity_not_found' }, { status: 404 });

  // Pobierz profil athlety (ownership + FTP + tryb)
  const athleteQuery = supabase
    .from('athletes')
    .select('id, user_id, ftp_watts, training_mode')
    .eq('id', activity.athlete_id);
  const { data: athlete } = await athleteQuery.single();

  if (!athlete) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });
  // Sprawdź ownership (poza trybem dev)
  if (!isDevBypass && athlete.user_id !== userId) {
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
