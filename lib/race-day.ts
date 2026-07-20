import type { createServerSupabaseClient } from '@/lib/supabase';
import type { RacePriority } from '@/lib/race-taper';

// Dzień startu wg race_calendar — ŹRÓDŁO PRAWDY, niezależne od tego, czy plan zmaterializował
// wyścig w plan_json (dzień może zostać jako Z2 z metadaną race). Ten sam autorytet, na którym
// opiera się race-overlay (#111). Kandydat na wspólny helper "czy ten dzień to wyścig" dla
// pozostałych warstw ducha (#110: execution ring / daily-insight / describe).
export interface RaceDay {
  name: string;
  priority: RacePriority | null;
  distanceKm: number | null;
  elevationM: number | null;
}

// Czy dzień jazdy to wyścig: dopasowanie po (athlete_id, date). race_calendar.date jest datą
// LOKALNĄ zawodnika — spójne z activity_date = start_date_local (lib/sync.ts). Przy kilku startach
// tego dnia bierzemy najwyższą rangę (A < B < C leksykalnie → ascending).
export async function fetchRaceDay(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  athleteId: string,
  activityDate: string
): Promise<RaceDay | null> {
  const { data } = await supabase
    .from('race_calendar')
    .select('name, priority, distance_km, elevation_m')
    .eq('athlete_id', athleteId)
    .eq('date', activityDate)
    .order('priority', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    name: data.name as string,
    priority: (data.priority as RacePriority | null) ?? null,
    distanceKm: (data.distance_km as number | null) ?? null,
    elevationM: (data.elevation_m as number | null) ?? null,
  };
}
