// Jazdy nagrane w VeloIQ (tabela `rides` + zapis 1 Hz w Storage) → wiersz w `strava_activities`,
// żeby były widoczne wszędzie tak jak jazdy ze Stravy: ostatnia jazda, kalendarz, plan (realizacja),
// analiza AI, krzywa mocy → silnik FTP, CTL/ATL. Na Stravę NIC nie wysyłamy.
//
// Identyfikator: strava_activity_id = −(epoch startu w sekundach). Ujemne id = „jazda z VeloIQ”
// (Strava ma tylko dodatnie), więc nie ma kolizji, a kod wołający API Stravy omija takie jazdy.
// Detal/krzywa/streams są liczone tu z pełnego zapisu, więc nic nie jest dociągane ze Stravy.

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeBestEfforts } from '@/lib/strava/details';
import { downsampleStreams } from '@/lib/strava/streams';
import { recalculateFitnessMetrics, recalculateFtpEstimate, recalculateVo2Estimate } from '@/lib/sync';
import type { SavedSample } from './save-ride';

export const isVeloiqRideId = (id: number | string) => Number(id) < 0;
export const veloiqActivityId = (startedAtIso: string) => -Math.floor(new Date(startedAtIso).getTime() / 1000);

interface RideRow {
  id: string; started_at: string; duration_sec: number; avg_power: number | null; normalized_power: number | null;
  intensity_factor: number | null; tss: number | null; kj: number | null; avg_hr: number | null; max_hr: number | null;
  outdoor: boolean; workout_name: string | null; series: unknown; samples_path: string; source: string;
}
interface SeriesItem { n: number; durationSec: number; avgPower: number; avgHr?: number; startSec: number; compliancePct: number }

const localIso = (d: Date) => {
  // "2026-10-25T09:12:00Z" w czasie Europe/Warsaw – tak jak start_date_local ze Stravy (bez strefy, z „Z”)
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`;
};

function haversineKm(a: SavedSample, b: SavedSample) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat! - a.lat!) * rad, dLon = (b.lon! - a.lon!) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat! * rad) * Math.cos(b.lat! * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Google encoded polyline (mapa na karcie jazdy). */
function encodePolyline(pts: [number, number][]): string {
  let out = '', pLat = 0, pLon = 0;
  const enc = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1, s = '';
    while (x >= 0x20) { s += String.fromCharCode((0x20 | (x & 0x1f)) + 63); x >>= 5; }
    return s + String.fromCharCode(x + 63);
  };
  for (const [la, lo] of pts) {
    const a = Math.round(la * 1e5), b = Math.round(lo * 1e5);
    out += enc(a - pLat) + enc(b - pLon); pLat = a; pLon = b;
  }
  return out;
}

export function buildActivityRow(ride: RideRow, samples: SavedSample[], athleteId: string) {
  const sid = veloiqActivityId(ride.started_at);
  const start = new Date(ride.started_at);
  const startLocal = localIso(start);
  const n = samples.length;
  const watts = samples.map((x) => x.p ?? 0);
  const gps = samples.filter((x) => x.lat != null && x.lon != null);
  let km = 0, maxSpeed = 0;
  for (let i = 1; i < gps.length; i++) {
    const d = haversineKm(gps[i - 1], gps[i]);
    const dt = Math.max(1, gps[i].s - gps[i - 1].s);
    if (d / dt * 3600 < 120) { km += d; maxSpeed = Math.max(maxSpeed, d * 1000 / dt); } // odrzuć skoki GPS
  }
  const cads = samples.map((x) => x.cad ?? 0).filter((c) => c > 0);
  const avgCad = cads.length ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null;
  const maxW = watts.length ? Math.max(...watts) : null;
  const moving = samples.filter((x) => (x.p ?? 0) > 0 || (x.cad ?? 0) > 0).length || ride.duration_sec;
  const step = Math.max(1, Math.ceil(gps.length / 400));
  const poly = gps.length > 1 ? encodePolyline(gps.filter((_, i) => i % step === 0).map((x) => [x.lat!, x.lon!])) : null;
  const series = (Array.isArray(ride.series) ? ride.series : []) as SeriesItem[];
  const laps = series.map((x) => ({
    name: `Interwał ${x.n}`, lap_index: x.n, elapsed_time: x.durationSec, moving_time: x.durationSec,
    start_index: x.startSec, end_index: x.startSec + x.durationSec, average_watts: x.avgPower,
    average_heartrate: x.avgHr ?? null, distance: 0, compliance_pct: x.compliancePct,
  }));
  const type = ride.outdoor ? 'Ride' : 'VirtualRide';
  const name = ride.workout_name ? `${ride.workout_name} · VeloIQ` : 'Jazda VeloIQ';

  return {
    athlete_id: athleteId,
    strava_activity_id: sid,
    activity_date: startLocal.slice(0, 10),
    name,
    type,
    distance_km: Math.round(km * 100) / 100,
    duration_seconds: moving,
    elevation_m: 0,
    avg_watts: ride.avg_power,
    max_watts: maxW,
    avg_hr: ride.avg_hr,
    max_hr: ride.max_hr,
    avg_cadence: avgCad,
    normalized_power: ride.normalized_power,
    tss: ride.tss,
    intensity_factor: ride.intensity_factor,
    best_efforts: n ? computeBestEfforts(watts, samples.map((x) => x.s)) : {},
    laps,
    pr_efforts: [],
    calories: ride.kj ?? null, // kJ ≈ kcal przy jeździe (sprawność ~24%)
    details_synced_at: new Date().toISOString(),
    streams_json: n ? downsampleStreams({
      time: samples.map((x) => x.s), watts, cadence: samples.map((x) => x.cad ?? 0),
      latlng: samples.map((x) => (x.lat != null && x.lon != null ? [x.lat, x.lon] : undefined)) as [number, number][],
    }, 5, Math.floor(start.getTime() / 1000)) : null,
    raw_data: {
      id: sid, source: 'veloiq', veloiq_ride_id: ride.id, name, type, sport_type: type, trainer: !ride.outdoor,
      start_date: ride.started_at, start_date_local: startLocal, elapsed_time: ride.duration_sec, moving_time: moving,
      distance: Math.round(km * 1000), average_watts: ride.avg_power, weighted_average_watts: ride.normalized_power,
      max_watts: maxW, kilojoules: ride.kj, device_watts: true, average_heartrate: ride.avg_hr, max_heartrate: ride.max_hr,
      average_cadence: avgCad, average_speed: moving ? (km * 1000) / moving : 0, max_speed: maxSpeed,
      map: { summary_polyline: poly },
    },
    synced_at: ride.started_at,
  };
}

/**
 * Wprowadza do strava_activities wszystkie jazdy z telefonu, których tam jeszcze nie ma.
 * Bezpieczne do wołania często (jedno zapytanie, gdy nic nowego). Zwraca liczbę dodanych.
 */
export async function importMissingRides(supabase: SupabaseClient, userId: string, athleteId: string): Promise<number> {
  const { data: rides, error } = await supabase
    .from('rides')
    .select('id, started_at, duration_sec, avg_power, normalized_power, intensity_factor, tss, kj, avg_hr, max_hr, outdoor, workout_name, series, samples_path, source')
    .eq('user_id', userId)
    .neq('source', 'veloiq-web-sim') // symulacja w przeglądarce to nie trening
    .order('started_at', { ascending: false })
    .limit(30);
  if (error || !rides?.length) return 0;

  const ids = rides.map((r) => veloiqActivityId(r.started_at as string));
  const { data: have } = await supabase.from('strava_activities').select('strava_activity_id').in('strava_activity_id', ids);
  const known = new Set((have ?? []).map((x) => Number(x.strava_activity_id)));
  let added = 0;
  for (const r of rides as RideRow[]) {
    if (known.has(veloiqActivityId(r.started_at)) || r.duration_sec < 60) continue;
    try {
      const file = await supabase.storage.from('rides').download(r.samples_path);
      if (file.error || !file.data) throw new Error(file.error?.message ?? 'brak pliku');
      const samples = (await file.data.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as SavedSample);
      const row = buildActivityRow(r, samples, athleteId);
      const { error: insErr } = await supabase.from('strava_activities').upsert(row, { onConflict: 'strava_activity_id' });
      if (insErr) throw new Error(insErr.message);
      added++;
    } catch (e) {
      console.error(`[rides] import ${r.id} nieudany:`, e instanceof Error ? e.message : e);
    }
  }
  if (added) {
    await recalculateFitnessMetrics(supabase, athleteId);
    await recalculateFtpEstimate(supabase, athleteId);
    await recalculateVo2Estimate(supabase, athleteId);
  }
  return added;
}
