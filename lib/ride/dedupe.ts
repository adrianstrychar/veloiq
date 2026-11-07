// Ta sama jazda zapisana dwa razy: w VeloIQ (telefon) i ze Stravy (np. Garmin → Strava).
// Zostaje wersja ze Stravy (GPS, segmenty, detale), a kopia VeloIQ znika z listy aktywności.
// Dane VeloIQ (serie, lapy, zapis 1 Hz) zostają w `rides` i są podpięte pod aktywność ze Stravy
// (raw_data.veloiq_ride_id), a jazda dostaje znacznik `:strava:<id>` – import jej nie przywróci,
// a eksport na Stravę wie, że już tam jest.

import type { SupabaseClient } from '@supabase/supabase-js';

interface Row { id: number; start: number; dur: number; rideId?: string | null }

const toRow = (x: Record<string, unknown>): Row | null => {
  const start = Date.parse(String(x.start_date ?? ''));
  const dur = Number(x.elapsed_time ?? x.duration_seconds ?? 0);
  if (!Number.isFinite(start) || !(dur > 0)) return null;
  return { id: Number(x.strava_activity_id), start, dur, rideId: (x.veloiq_ride_id as string | null) ?? null };
};

/** Czy dwie jazdy to ten sam trening: start ±10 min albo pokrycie ≥ 50 % krótszej. */
export function sameRide(a: { start: number; dur: number }, b: { start: number; dur: number }): boolean {
  if (Math.abs(a.start - b.start) <= 10 * 60_000) return true;
  const ov = Math.min(a.start + a.dur * 1000, b.start + b.dur * 1000) - Math.max(a.start, b.start);
  return ov > 0 && ov >= 0.5 * Math.min(a.dur, b.dur) * 1000;
}

/** Usuwa kopie VeloIQ zdublowane przez aktywność ze Stravy. Zwraca liczbę usuniętych kopii. */
export async function dedupeVeloiqRides(supabase: SupabaseClient, athleteId: string): Promise<number> {
  const since = new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10);
  const cols = 'strava_activity_id, duration_seconds, start_date:raw_data->>start_date, elapsed_time:raw_data->>elapsed_time, veloiq_ride_id:raw_data->>veloiq_ride_id';
  const [{ data: local }, { data: strava }] = await Promise.all([
    supabase.from('strava_activities').select(cols).eq('athlete_id', athleteId).lt('strava_activity_id', 0).gte('activity_date', since),
    supabase.from('strava_activities').select(cols).eq('athlete_id', athleteId).gt('strava_activity_id', 0).gte('activity_date', since),
  ]);
  const L = (local ?? []).map((x) => toRow(x as Record<string, unknown>)).filter((x): x is Row => !!x);
  const S = (strava ?? []).map((x) => toRow(x as Record<string, unknown>)).filter((x): x is Row => !!x);
  let removed = 0;
  for (const v of L) {
    const twin = S.find((s) => sameRide(v, s));
    if (!twin) continue;
    // podepnij dane VeloIQ pod aktywność ze Stravy (analiza serii/lapów z telefonu)
    if (v.rideId && !twin.rideId) {
      const { data: tw } = await supabase.from('strava_activities').select('raw_data').eq('strava_activity_id', twin.id).maybeSingle();
      if (tw) await supabase.from('strava_activities').update({ raw_data: { ...(tw.raw_data as object ?? {}), veloiq_ride_id: v.rideId } }).eq('strava_activity_id', twin.id);
    }
    if (v.rideId) {
      const { data: ride } = await supabase.from('rides').select('source').eq('id', v.rideId).maybeSingle();
      if (ride && !/:strava:\d+$/.test(String(ride.source ?? ''))) {
        await supabase.from('rides').update({ source: `${ride.source ?? 'veloiq-ios'}:strava:${twin.id}` }).eq('id', v.rideId);
      }
    }
    const { error } = await supabase.from('strava_activities').delete().eq('athlete_id', athleteId).eq('strava_activity_id', v.id);
    if (!error) removed++;
  }
  return removed;
}
