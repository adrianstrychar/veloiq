// Zapis kalendarza startów (race_calendar) — NET-NEW (dotąd tylko odczyty w apce).
// Deterministyczne, scoped athleteId. Reużywane przez write tools czatu (propose/commit_change).
import type { SupabaseClient } from '@supabase/supabase-js';

export interface RaceRow {
  id: string;
  name: string;
  date: string;
  priority: 'A' | 'B' | 'C';
  series: string | null;
  distance_km: number | null;
  elevation_m: number | null;
}

export interface RaceAddInput {
  name: string;
  date: string;
  priority: 'A' | 'B' | 'C';
  series?: string | null;
  distance_km?: number | null;
  elevation_m?: number | null;
}

export async function getRace(supabase: SupabaseClient, athleteId: string, raceId: string): Promise<RaceRow | null> {
  const { data } = await supabase
    .from('race_calendar')
    .select('id, name, date, priority, series, distance_km, elevation_m')
    .eq('id', raceId)
    .eq('athlete_id', athleteId)
    .maybeSingle();
  return (data as RaceRow | null) ?? null;
}

export async function addRace(supabase: SupabaseClient, athleteId: string, r: RaceAddInput): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('race_calendar')
    .insert({
      athlete_id: athleteId,
      name: r.name,
      date: r.date,
      priority: r.priority,
      series: r.series ?? null,
      distance_km: r.distance_km ?? null,
      elevation_m: r.elevation_m ?? null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'insert failed');
  return { id: data.id as string };
}

export async function editRace(
  supabase: SupabaseClient,
  athleteId: string,
  raceId: string,
  patch: Partial<Omit<RaceRow, 'id'>>
): Promise<void> {
  const { error } = await supabase.from('race_calendar').update(patch).eq('id', raceId).eq('athlete_id', athleteId);
  if (error) throw new Error(error.message);
}

export async function deleteRace(supabase: SupabaseClient, athleteId: string, raceId: string): Promise<void> {
  const { error } = await supabase.from('race_calendar').delete().eq('id', raceId).eq('athlete_id', athleteId);
  if (error) throw new Error(error.message);
}
