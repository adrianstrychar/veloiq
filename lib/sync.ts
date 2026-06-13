// Shared Strava sync + fitness metrics recalculation (sekcja 15)
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchStravaActivities,
  refreshStravaToken,
  type StravaActivity,
} from '@/lib/strava';
import { calculateTSSfromHR, calculateTSSfromPower, calculateFitnessHistory } from '@/lib/fitness';

const SYNC_COOLDOWN_MINUTES = 60;
const DEFAULT_LOOKBACK_DAYS = 90;

interface AthleteRow {
  id: string;
  ftp_watts: number | null;
  hrmax: number | null;
  strava_access_token: string;
  strava_refresh_token: string;
  strava_token_expires_at: string | null;
}

function computeTSS(
  activity: StravaActivity,
  ftpWatts: number | null,
  hrmax: number | null
): number {
  if (ftpWatts && activity.weighted_average_watts) {
    return calculateTSSfromPower(activity.moving_time, activity.weighted_average_watts, ftpWatts);
  }
  // Brak hrmax w profilu — przybliż go z max_heartrate tej aktywności (sekcja 11)
  const effectiveHrmax = hrmax ?? activity.max_heartrate;
  if (effectiveHrmax && activity.average_heartrate) {
    return calculateTSSfromHR(activity.moving_time, activity.average_heartrate, effectiveHrmax);
  }
  return 0;
}

// Pobiera nowe aktywności ze Stravy i zapisuje do strava_activities
export async function syncStravaActivities(
  supabase: SupabaseClient,
  athlete: AthleteRow
): Promise<{ skipped: true; reason: string } | { skipped: false; synced: number }> {
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
      return { skipped: true, reason: 'cooldown' };
    }
  }

  let accessToken = athlete.strava_access_token;
  const expiresAt = athlete.strava_token_expires_at
    ? new Date(athlete.strava_token_expires_at).getTime()
    : 0;

  if (expiresAt < Date.now()) {
    const refreshed = await refreshStravaToken(athlete.strava_refresh_token);
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
      throw new Error(`upsert_failed: ${upsertError.message}`);
    }
  }

  return { skipped: false, synced: rows.length };
}

// Przelicza CTL/ATL/TSB na podstawie wszystkich aktywności i zapisuje do fitness_metrics
export async function recalculateFitnessMetrics(
  supabase: SupabaseClient,
  athleteId: string
): Promise<void> {
  const { data: activities, error } = await supabase
    .from('strava_activities')
    .select('activity_date, tss')
    .eq('athlete_id', athleteId)
    .order('activity_date', { ascending: true });

  if (error || !activities || activities.length === 0) return;

  const history = calculateFitnessHistory(
    activities.map((a) => ({ date: a.activity_date as string, tss: (a.tss as number) ?? 0 }))
  );

  const rows = history.map((h) => ({
    athlete_id: athleteId,
    date: h.date,
    ctl: h.ctl,
    atl: h.atl,
    tsb: h.tsb,
    daily_tss: 0,
    calculated_at: new Date().toISOString(),
  }));

  await supabase.from('fitness_metrics').upsert(rows, { onConflict: 'athlete_id,date' });
}
