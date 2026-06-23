import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { syncActivityDetails } from '@/lib/strava/details';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const stravaActivityId = params.id;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  const userId = user.id;

  // Ownership: jazda musi należeć do zalogowanego atlety
  const { data: athleteRow } = await supabase
    .from('athletes').select('id').eq('user_id', userId).single();
  const { data: activity } = await supabase
    .from('strava_activities')
    .select('id')
    .eq('strava_activity_id', stravaActivityId)
    .eq('athlete_id', athleteRow?.id ?? '')
    .maybeSingle();
  if (!activity) return NextResponse.json({ error: 'activity_not_found' }, { status: 404 });

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
