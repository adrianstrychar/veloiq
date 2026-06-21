import { createServerSupabaseClient } from '@/lib/supabase';
import { type RaceRow } from '@/components/veloiq/Races';
import { RacesView } from '@/components/veloiq/RacesView';
import { type CalActivity } from '@/components/veloiq/Calendar';

// Pełny zestaw kolumn aktywności — potrzebny żeby klik w dniu kalendarza
// otworzył RideAnalysis bez dociągania danych.
const ACTIVITY_SELECT =
  'strava_activity_id, name, activity_date, type, distance_km, elevation_m, duration_seconds, tss, avg_watts, avg_hr, best_efforts, laps, details_synced_at';

export default async function RacesPage() {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, ftp_watts')
    .eq('user_id', user?.id ?? '')
    .single();

  const athleteId = athlete?.id ?? '';

  const [{ data: races }, { data: activities }] = await Promise.all([
    supabase
      .from('race_calendar')
      .select('id, date, name, location, series, distance_km, elevation_m, discipline, priority')
      .eq('athlete_id', athleteId)
      .order('date', { ascending: true }),
    supabase
      .from('strava_activities')
      .select(ACTIVITY_SELECT)
      .eq('athlete_id', athleteId)
      .order('activity_date', { ascending: true }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between py-2">
        <span className="text-lg font-bold">VeloIQ</span>
        <span className="text-sm text-secondary">Kalendarz startów</span>
      </header>

      <RacesView
        races={(races ?? []) as RaceRow[]}
        activities={(activities ?? []) as CalActivity[]}
        ftp={(athlete as any)?.ftp_watts ?? null}
      />
    </div>
  );
}
