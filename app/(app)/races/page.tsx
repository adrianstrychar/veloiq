import { createServerSupabaseClient } from '@/lib/supabase';
import { Races, type RaceRow } from '@/components/veloiq/Races';

export default async function RacesPage() {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id')
    .eq('user_id', user?.id ?? '')
    .single();

  const { data: races } = await supabase
    .from('race_calendar')
    .select('id, date, name, location, series, distance_km, elevation_m, discipline, priority')
    .eq('athlete_id', athlete?.id ?? '')
    .order('date', { ascending: true });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between py-2">
        <span className="text-lg font-bold">VeloIQ</span>
        <span className="text-sm text-secondary">Kalendarz startów</span>
      </header>

      <Races races={(races ?? []) as RaceRow[]} />
    </div>
  );
}
