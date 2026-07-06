import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { syncStravaActivities, recalculateFitnessMetrics } from '@/lib/sync';

// Syncuje aktywności ze Strava do strava_activities i przelicza CTL/ATL/TSB (sekcja 15)
export async function GET() {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  const { data: athlete, error: athleteError } = await supabase
    .from('athletes')
    .select(
      'id, strava_id, ftp_watts, hrmax, strava_access_token, strava_refresh_token, strava_token_expires_at'
    )
    .eq('user_id', user.id)
    .single();

  if (athleteError || !athlete) {
    return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });
  }

  const result = await syncStravaActivities(supabase, athlete);

  if (result.skipped) {
    return NextResponse.json({ skipped: true, reason: result.reason });
  }

  await recalculateFitnessMetrics(supabase, athlete.id);

  return NextResponse.json({ synced: result.synced });
}
