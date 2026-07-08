import { refreshStravaToken } from '@/lib/strava';
import type { SupabaseClient } from '@supabase/supabase-js';

// Kontrakt streams_json (v1). Serie RÓWNOLEGŁE (mniejsze niż pary [t,v]): indeks i → czas i*dt s
// od startu jazdy, więc osi czasu nie przechowujemy. dt=5 s (downsampling). Luki = null.
//  - watts/cad: średnia w oknie 5 s (wygładza szum),
//  - alt/lat/lng: próbka reprezentatywna (ostatnia w oknie) — pozycja, nie uśredniamy.
export interface StreamsJson {
  v: 1;
  dt: number;                 // sekund na próbkę (5)
  n: number;                  // liczba próbek
  t0: number | null;          // epoch startu (s) — opcjonalnie do absolutnej osi; null gdy brak
  series: {
    watts: (number | null)[];
    alt: (number | null)[];
    lat: (number | null)[];
    lng: (number | null)[];
    cad: (number | null)[];
  };
}

export interface RawStreams {
  time?: number[];            // sekundy od startu (nierównomierne)
  watts?: number[];
  altitude?: number[];
  latlng?: [number, number][];
  cadence?: number[];
}

const r5 = (x: number) => Math.round(x * 1e5) / 1e5; // ~1 m precyzji lat/lng

// Downsampling do koszy dt-sekundowych. watts/cad uśredniane, alt/latlng = ostatnia próbka kosza.
export function downsampleStreams(raw: RawStreams, dt = 5, t0: number | null = null): StreamsJson {
  const time = raw.time ?? [];
  const N = time.length;
  const n = N ? Math.floor(time[N - 1] / dt) + 1 : 0;

  const wSum = new Array<number>(n).fill(0), wCnt = new Array<number>(n).fill(0);
  const cSum = new Array<number>(n).fill(0), cCnt = new Array<number>(n).fill(0);
  const alt = new Array<number | null>(n).fill(null);
  const lat = new Array<number | null>(n).fill(null);
  const lng = new Array<number | null>(n).fill(null);

  for (let i = 0; i < N; i++) {
    const k = Math.floor(time[i] / dt);
    if (k < 0 || k >= n) continue;
    const w = raw.watts?.[i];
    if (w != null) { wSum[k] += w; wCnt[k]++; }
    const c = raw.cadence?.[i];
    if (c != null) { cSum[k] += c; cCnt[k]++; }
    const a = raw.altitude?.[i];
    if (a != null) alt[k] = Math.round(a * 10) / 10;
    const ll = raw.latlng?.[i];
    if (ll) { lat[k] = r5(ll[0]); lng[k] = r5(ll[1]); }
  }

  const watts = new Array<number | null>(n);
  const cad = new Array<number | null>(n);
  for (let k = 0; k < n; k++) {
    watts[k] = wCnt[k] ? Math.round(wSum[k] / wCnt[k]) : null;
    cad[k] = cCnt[k] ? Math.round(cSum[k] / cCnt[k]) : null;
  }

  return { v: 1, dt, n, t0, series: { watts, alt, lat, lng, cad } };
}

// NP z serii per-sekunda (30 s rolling avg, ^4, 4-pierwiastek). Do sanity-checku downsamplingu —
// KARTA pokazuje NP z kolumny, nie stąd (spójność z PMC). null gdy za mało danych.
export function normalizedPower(perSecondWatts: number[]): number | null {
  const win = 30;
  if (perSecondWatts.length < win) return null;
  let sum = 0;
  const roll: number[] = [];
  for (let i = 0; i < perSecondWatts.length; i++) {
    sum += perSecondWatts[i];
    if (i >= win) sum -= perSecondWatts[i - win];
    if (i >= win - 1) roll.push(sum / win);
  }
  const avg4 = roll.reduce((a, p) => a + p * p * p * p, 0) / roll.length;
  return Math.round(Math.pow(avg4, 0.25));
}

// On-demand + persist. streams_json obecny → z bazy (cached). null → fetch Stravy, downsample,
// zapis, zwrot. Refresh tokenu jak w syncActivityDetails. Ownership po user_id.
export async function syncActivityStreams(
  supabase: SupabaseClient,
  stravaActivityId: string,
  userId: string
): Promise<{ streams: StreamsJson | null; bytes: number; cached: boolean }> {
  const { data: athlete, error: athErr } = await supabase
    .from('athletes')
    .select('id, strava_access_token, strava_refresh_token, strava_token_expires_at')
    .eq('user_id', userId)
    .single();
  if (athErr || !athlete) throw new Error('Athlete not found');

  const { data: act } = await supabase
    .from('strava_activities')
    .select('streams_json')
    .eq('strava_activity_id', stravaActivityId)
    .eq('athlete_id', athlete.id)
    .maybeSingle();
  if (!act) throw new Error('activity_not_found');

  if (act.streams_json) {
    const s = act.streams_json as StreamsJson;
    return { streams: s, bytes: JSON.stringify(s).length, cached: true };
  }

  // Odśwież token jeśli wygasł
  let accessToken = athlete.strava_access_token as string;
  const expiresAt = athlete.strava_token_expires_at ? new Date(athlete.strava_token_expires_at as string).getTime() : 0;
  if (expiresAt < Date.now()) {
    const refreshed = await refreshStravaToken(athlete.strava_refresh_token as string);
    accessToken = refreshed.access_token;
    await supabase.from('athletes').update({
      strava_access_token: refreshed.access_token,
      strava_refresh_token: refreshed.refresh_token,
      strava_token_expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
    }).eq('id', athlete.id);
  }

  const res = await fetch(
    `https://www.strava.com/api/v3/activities/${stravaActivityId}/streams?keys=time,watts,altitude,latlng,cadence&key_by_type=true&resolution=high`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Strava streams failed: ${res.status}`);
  const s = await res.json();

  const raw: RawStreams = {
    time: s?.time?.data,
    watts: s?.watts?.data,
    altitude: s?.altitude?.data,
    latlng: s?.latlng?.data,
    cadence: s?.cadence?.data,
  };
  const streams = downsampleStreams(raw, 5);
  const bytes = JSON.stringify(streams).length;

  const { error: upErr } = await supabase
    .from('strava_activities')
    .update({ streams_json: streams })
    .eq('strava_activity_id', stravaActivityId)
    .eq('athlete_id', athlete.id);
  if (upErr) throw new Error(`DB update failed: ${upErr.message}`);

  return { streams, bytes, cached: false };
}
