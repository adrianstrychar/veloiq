import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { syncActivityDetails } from '@/lib/strava/details';

// TODO: usunąć DEV_SECRET przed produkcją
const DEV_SECRET = process.env.DEV_TEST_SECRET ?? 'veloiq-dev-2026';

function makeAdminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const stravaActivityId = params.id;
  const isDevBypass =
    req.headers.get('x-dev-secret') === DEV_SECRET &&
    process.env.NODE_ENV !== 'production';

  let userId: string;
  let supabase: SupabaseClient;

  if (isDevBypass) {
    // TODO: usunąć ten blok przed produkcją — tylko do testów lokalnych
    supabase = makeAdminClient();

    const { data: act } = await supabase
      .from('strava_activities')
      .select('athlete_id')
      .eq('strava_activity_id', stravaActivityId)
      .maybeSingle();

    if (!act) return NextResponse.json({ error: 'activity_not_found' }, { status: 404 });

    const { data: ath } = await supabase
      .from('athletes')
      .select('user_id')
      .eq('id', act.athlete_id)
      .single();

    if (!ath) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });
    userId = ath.user_id as string;
  } else {
    supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    userId = user.id;

    const { data: athleteRow } = await supabase
      .from('athletes').select('id').eq('user_id', userId).single();
    const { data: activity } = await supabase
      .from('strava_activities')
      .select('id')
      .eq('strava_activity_id', stravaActivityId)
      .eq('athlete_id', athleteRow?.id ?? '')
      .maybeSingle();
    if (!activity) return NextResponse.json({ error: 'activity_not_found' }, { status: 404 });
  }

  try {
    const result = await syncActivityDetails(supabase, stravaActivityId, userId);
    return NextResponse.json({
      ok: true,
      laps_count: Array.isArray(result.laps) ? (result.laps as unknown[]).length : 0,
      best_efforts: result.best_efforts,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
