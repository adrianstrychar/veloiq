import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import {
  fetchStravaActivities,
  refreshStravaToken,
  type StravaActivity,
} from '@/lib/strava';
import { calculateTSSfromHR, calculateTSSfromPower } from '@/lib/fitness';

const SYNC_COOLDOWN_MINUTES = 60;
const DEFAULT_LOOKBACK_DAYS = 90;

function computeTSS(
  activity: StravaActivity,
  ftpWatts: number | null,
  hrmax: number | null
): number {
  if (ftpWatts && activity.weighted_average_watts) {
    return calculateTSSfromPower(activity.moving_time, activity.weighted_average_watts, ftpWatts);
  }
  if (hrmax && activity.average_heartrate) {
    return calculateTSSfromHR(activity.moving_time, activity.average_heartrate, hrmax);
  }
  return 0;
}

// Syncuje aktywności ze Strava do strava_activities (sekcja 15)
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
      'id, ftp_watts, hrmax, strava_access_token, strava_refresh_token, strava_token_expires_at'
    )
    .eq('user_id', user.id)
    .single();

  if (athleteError || !athlete) {
    return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });
  }

  // Strava rate limits: 100 req/15min, 1000/dzień — sprawdź synced_at przed synciem
  const { data: lastActivity } = await supabase
    .from('strava_activities')
    .select('activity_date, synced_at')
    .eq('athlete_id', athlete.id)
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastActivity?.synced_at) {
    const minutesSinceSync =
      (Date.now() - new Date(lastActivity.synced_at).getTime()) / 60000;
    if (minutesSinceSync < SYNC_COOLDOWN_MINUTES) {
      return NextResponse.json(
        { skipped: true, reason: 'cooldown', minutes_remaining: Math.ceil(SYNC_COOLDOWN_MINUTES - minutesSinceSync) },
        { status: 200 }
      );
    }
  }

  // Odśwież token jeśli wygasł
  let accessToken = athlete.strava_access_token as string;
  const expiresAt = athlete.strava_token_expires_at
    ? new Date(athlete.strava_token_expires_at).getTime()
    : 0;

  if (expiresAt < Date.now()) {
    const refreshed = await refreshStravaToken(athlete.strava_refresh_token as string);
    accessToken = refreshed.access_token;

    await supabase
      .from('athletes')
      .update({
        strava_access_token: refreshed.access_token,
        strava_refresh_token: refreshed.refresh_token,
        strava_token_expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
      })
      .eq('id', athlete.id);
  }

  const after = lastActivity?.activity_date
    ? Math.floor(new Date(lastActivity.activity_date).getTime() / 1000)
    : Math.floor(Date.now() / 1000) - DEFAULT_LOOKBACK_DAYS * 24 * 3600;

  const activities = await fetchStravaActivities(accessToken, after);

  const rows = activities
    .filter((a) => a.type === 'Ride' || a.type === 'VirtualRide' || a.type === 'MountainBikeRide')
    .map((a) => {
      const tss = computeTSS(a, athlete.ftp_watts, athlete.hrmax);
      const intensityFactor =
        athlete.ftp_watts && a.weighted_average_watts
          ? a.weighted_average_watts / athlete.ftp_watts
          : null;

      return {
        athlete_id: athlete.id,
        strava_activity_id: a.id,
        activity_date: a.start_date.slice(0, 10),
        name: a.name,
        type: a.type,
        distance_km: Math.round((a.distance / 1000) * 100) / 100,
        duration_seconds: a.moving_time,
        elevation_m: Math.round(a.total_elevation_gain),
        avg_watts: a.average_watts ? Math.round(a.average_watts) : null,
        max_watts: a.max_watts ? Math.round(a.max_watts) : null,
        avg_hr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
        max_hr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
        avg_cadence: a.average_cadence ? Math.round(a.average_cadence) : null,
        normalized_power: a.weighted_average_watts ? Math.round(a.weighted_average_watts) : null,
        tss: Math.round(tss * 100) / 100,
        intensity_factor: intensityFactor ? Math.round(intensityFactor * 1000) / 1000 : null,
        raw_data: a,
        synced_at: new Date().toISOString(),
      };
    });

  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from('strava_activities')
      .upsert(rows, { onConflict: 'strava_activity_id' });

    if (upsertError) {
      return NextResponse.json({ error: 'upsert_failed', details: upsertError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ synced: rows.length });
}
