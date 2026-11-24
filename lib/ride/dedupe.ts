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

export interface LocalRide { id: string; started_at: string; duration_sec: number; source: string | null }

/** Ta sama jazda nagrana dwa razy w VeloIQ (telefon i licznik Garmin jednocześnie): które kopie odrzucić.
 *  Zostaje dłuższa (pełniejsza); przy podobnej długości (±5 %) – zapis z telefonu (1 Hz, licznik wysyła co 5 s). */
export function pickLocalDuplicates(rows: LocalRide[]): { drop: LocalRide; keep: LocalRide }[] {
  const live = rows.filter((r) => r.duration_sec > 0 && Number.isFinite(Date.parse(r.started_at)));
  const span = (r: LocalRide) => ({ start: Date.parse(r.started_at), dur: r.duration_sec });
  const garmin = (r: LocalRide) => /^veloiq-garmin/.test(r.source ?? '');
  const better = (a: LocalRide, b: LocalRide) => {
    const longer = Math.max(a.duration_sec, b.duration_sec);
    if (Math.abs(a.duration_sec - b.duration_sec) > 0.05 * longer) return a.duration_sec > b.duration_sec ? a : b;
    if (garmin(a) !== garmin(b)) return garmin(a) ? b : a;
    return a.started_at <= b.started_at ? a : b;
  };
  const out: { drop: LocalRide; keep: LocalRide }[] = [];
  const gone = new Set<string>();
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (gone.has(a.id) || gone.has(b.id) || !sameRide(span(a), span(b))) continue;
      const keep = better(a, b), drop = keep === a ? b : a;
      gone.add(drop.id);
      out.push({ drop, keep });
    }
  }
  return out;
}

/** Kopie tej samej jazdy z telefonu i z licznika: odrzucona dostaje w `source` znacznik `:dup:<id zachowanej>`
 *  (import jej nie przywróci) i znika z listy aktywności. Zwraca liczbę odrzuconych. */
export async function dedupeLocalRides(supabase: SupabaseClient, userId: string, athleteId: string): Promise<number> {
  const since = new Date(Date.now() - 120 * 86400_000).toISOString();
  const { data } = await supabase.from('rides').select('id, started_at, duration_sec, source')
    .eq('user_id', userId).gte('started_at', since)
    .neq('source', 'veloiq-web-sim').not('source', 'like', '%:strava:%').not('source', 'like', '%:dup:%')
    .order('started_at', { ascending: false }).limit(60);
  const pairs = pickLocalDuplicates((data ?? []) as LocalRide[]);
  let n = 0;
  for (const { drop, keep } of pairs) {
    const { error } = await supabase.from('rides').update({ source: `${drop.source ?? 'veloiq'}:dup:${keep.id}` }).eq('id', drop.id);
    if (error) continue;
    n++;
    const dropAct = -Math.floor(Date.parse(drop.started_at) / 1000), keepAct = -Math.floor(Date.parse(keep.started_at) / 1000);
    if (dropAct !== keepAct) await supabase.from('strava_activities').delete().eq('athlete_id', athleteId).eq('strava_activity_id', dropAct);
  }
  return n;
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
