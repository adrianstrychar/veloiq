// VeloIQ na Garmin Edge – składanie jazdy wysłanej z licznika.
//
// Licznik wysyła: podsumowanie (liczby policzone na urządzeniu), serie / lapy / wysiłki z silnika treningu
// oraz paczki binarne w base64: próbki co 5 s (moc 2 B, tętno 1 B, kadencja 1 B) i ślad GPS co 10 s
// (szer., dł. w mikrostopniach int32 LE, wysokość + 500 m uint16). Tu zamieniamy to na ten sam zapis co
// jazda z telefonu: wiersz w `rides` + plik 1 Hz w Storage – dzięki temu reszta aplikacji (lista aktywności,
// analiza, krzywa mocy → FTP, CTL/ATL, eksport na Stravę, scalanie z kopią ze Stravy) działa bez zmian.
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateTSSfromHR } from '@/lib/fitness';
import type { SavedSample } from '@/lib/ride/save-ride';
import { importMissingRides, veloiqActivityId } from '@/lib/ride/import-rides';
import type { WorkoutScript } from '@/lib/ride/workout-script';
import { STEP_TYPES } from './sync';

export const MAX_CHUNKS = 60;            // na rodzaj: 60 × 562 próbek × 5 s ≈ 46 h – z dużym zapasem
export const MAX_CHUNK_B64 = 4096;
const MAX_RIDE_SEC = 24 * 3600;
const NO_FIX = 0x7fffffff;

const num = (v: unknown, lo: number, hi: number, dflt = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const int = (v: unknown, lo: number, hi: number, dflt = 0) => Math.round(num(v, lo, hi, dflt));
const str = (v: unknown, max: number, dflt = '') => (typeof v === 'string' ? v : dflt).slice(0, max);

export interface GarminSummary {
  startedAt: number; durationSec: number; elapsedSec: number; avgPower: number; maxPower: number; np: number; tss: number; kJ: number;
  avgHr: number; maxHr: number; avgCad: number; compliancePct: number; seriesCount: number; ftp: number; outdoor: boolean;
  distanceM: number; ascentM: number; workoutId: string; workoutName: string; workoutType: string;
  best: number[]; zones: number[]; wbalMinPct: number; samplePeriod: number; gpsPeriod: number; device: string; app: string;
}

/** Podsumowanie z licznika – każda liczba przycięta do rozsądnego zakresu (dane przychodzą z zewnątrz). */
export function cleanSummary(raw: unknown, rideKey: number): GarminSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const durationSec = int(r.durationSec, 0, MAX_RIDE_SEC);
  const now = Math.floor(Date.now() / 1000);
  // początek jazdy: nie z przyszłości i nie starszy niż rok (zegar licznika bywa rozjechany, ale nie o lata)
  if (!Number.isInteger(rideKey) || rideKey > now + 3600 || rideKey < now - 366 * 86400) return null;
  const arr = (v: unknown, n: number, hi: number) => (Array.isArray(v) ? v.slice(0, n).map((x) => int(x, 0, hi)) : []);
  return {
    startedAt: rideKey, durationSec, elapsedSec: int(r.elapsedSec, durationSec, 3 * MAX_RIDE_SEC, durationSec),
    avgPower: int(r.avgPower, 0, 2500), maxPower: int(r.maxPower, 0, 3000), np: int(r.np, 0, 2500), tss: int(r.tss, 0, 2000),
    kJ: int(r.kJ, 0, 100000), avgHr: int(r.avgHr, 0, 250), maxHr: int(r.maxHr, 0, 250), avgCad: int(r.avgCad, 0, 250),
    compliancePct: int(r.compliancePct, 0, 100), seriesCount: int(r.seriesCount, 0, 500), ftp: int(r.ftp, 50, 700, 250),
    outdoor: Number(r.outdoor) === 1 || r.outdoor === true, distanceM: int(r.distanceM, 0, 2_000_000), ascentM: int(r.ascentM, 0, 30000),
    workoutId: str(r.workoutId, 60, 'free'), workoutName: str(r.workoutName, 80, 'Jazda swobodna'), workoutType: str(r.workoutType, 12),
    best: arr(r.best, 5, 3000), zones: arr(r.zones, 7, MAX_RIDE_SEC), wbalMinPct: int(r.wbalMinPct, -500, 100, 100),
    samplePeriod: int(r.samplePeriod, 1, 60, 5), gpsPeriod: int(r.gpsPeriod, 1, 120, 10), device: str(r.device, 40), app: str(r.app, 20),
  };
}

export interface GarminExtra {
  series: Array<Record<string, unknown>>;
  laps: Array<{ startSec: number; name: string; type: string }>;
  efforts: Array<{ startSec: number; durationSec: number; avgPower: number }>;
  script: WorkoutScript;
}

export function cleanExtra(raw: unknown, sum: GarminSummary): GarminExtra {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n).filter((x) => x && typeof x === 'object') as Record<string, unknown>[] : []);
  const series = list(r.series, 60).map((x) => {
    const verdict = x.verdict === 'high' || x.verdict === 'low' ? x.verdict : 'ok';
    return {
      n: int(x.n, 0, 500), durationSec: int(x.durationSec, 0, MAX_RIDE_SEC), plannedSec: int(x.plannedSec, 0, MAX_RIDE_SEC),
      avgPower: int(x.avgPower, 0, 2500), compliancePct: int(x.compliancePct, 0, 100), endedEarly: x.endedEarly === true,
      startSec: int(x.startSec, 0, MAX_RIDE_SEC), verdict, deltaW: int(x.deltaW, 0, 2500),
      ...(x.avgHr != null ? { avgHr: int(x.avgHr, 0, 250) } : {}),
      ...(x.restBeforeSec != null ? { restBeforeSec: int(x.restBeforeSec, 0, MAX_RIDE_SEC) } : {}),
    };
  });
  const laps = list(r.laps, 120).map((x) => ({ startSec: int(x.startSec, 0, MAX_RIDE_SEC), name: str(x.name, 40, 'Lap'), type: str(x.type, 12, 'free') }));
  const efforts = list(r.efforts, 60).map((x) => ({ startSec: int(x.startSec, 0, MAX_RIDE_SEC), durationSec: int(x.durationSec, 0, MAX_RIDE_SEC), avgPower: int(x.avgPower, 0, 2500) }));
  const steps = (Array.isArray(r.steps) ? r.steps.slice(0, 150) : []).filter((a): a is unknown[] => Array.isArray(a) && a.length >= 5).map((a) => {
    const cadLo = int(a[5], 0, 200), cadHi = int(a[6], 0, 200), start = int(a[7], 0, 2), hrLo = int(a[8], 0, 250), hrHi = int(a[9], 0, 250);
    return {
      name: str(a[0], 40, 'Krok'), type: STEP_TYPES[int(a[1], 0, 4, 3)] ?? 'steady', durationSec: int(a[2], 1, MAX_RIDE_SEC, 1),
      powerLow: int(a[3], 0, 2500), powerHigh: int(a[4], 0, 2500),
      ...(cadLo ? { cadenceLow: cadLo } : {}), ...(cadHi ? { cadenceHigh: cadHi } : {}),
      ...(start ? { start: start === 1 ? 'auto' as const : 'time' as const } : {}),
      ...(hrLo ? { hrLow: hrLo } : {}), ...(hrHi ? { hrHigh: hrHi } : {}),
    };
  });
  const script: WorkoutScript = {
    version: 1, id: sum.workoutId, name: sum.workoutName, ftp: sum.ftp, lang: 'pl-PL', steps,
    ...(sum.workoutType ? { type: sum.workoutType } : {}),
  };
  return { series, laps, efforts, script };
}

const bytes = (chunks: string[]) => Buffer.concat(chunks.map((c) => Buffer.from(c, 'base64')));

export interface RawSample { p: number | null; hr: number | null; cad: number | null }

/** Próbki co `samplePeriod` s: [moc lo, moc hi, tętno (0 = brak), kadencja (255 = brak)]. */
export function decodeSamples(chunks: string[]): RawSample[] {
  const b = bytes(chunks);
  const out: RawSample[] = [];
  for (let o = 0; o + 4 <= b.length; o += 4) {
    const p = b.readUInt16LE(o);
    out.push({ p: p === 0xffff ? null : p, hr: b[o + 2] === 0 ? null : b[o + 2], cad: b[o + 3] === 255 ? null : b[o + 3] });
  }
  return out;
}

export interface GpsPoint { lat: number; lon: number; alt: number }

/** Ślad co `gpsPeriod` s; null = brak pozycji w tej chwili. */
export function decodeGps(chunks: string[]): (GpsPoint | null)[] {
  const b = bytes(chunks);
  const out: (GpsPoint | null)[] = [];
  for (let o = 0; o + 10 <= b.length; o += 10) {
    const la = b.readInt32LE(o), lo = b.readInt32LE(o + 4);
    const lat = la / 1e6, lon = lo / 1e6;
    const ok = la !== NO_FIX && lo !== NO_FIX && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(la === 0 && lo === 0);
    out.push(ok ? { lat, lon, alt: b.readUInt16LE(o + 8) - 500 } : null);
  }
  return out;
}

/**
 * Zapis 1 Hz jak z telefonu: wartość próbki powtórzona w jej sekundach, pozycja interpolowana liniowo
 * między punktami GPS. Sekunda = sekunda aktywnego czasu jazdy (bez pauz).
 */
export function expandSamples(raw: RawSample[], gps: (GpsPoint | null)[], durationSec: number, period = 5, gpsPeriod = 10): SavedSample[] {
  const n = Math.min(Math.max(durationSec, 0), raw.length * period, MAX_RIDE_SEC);
  const out: SavedSample[] = [];
  for (let s = 0; s < n; s++) {
    const r = raw[Math.min(raw.length - 1, Math.floor(s / period))];
    const x: SavedSample = { s };
    if (r.p != null) x.p = r.p;
    if (r.hr != null) x.hr = r.hr;
    if (r.cad != null) x.cad = r.cad;
    if (gps.length) {
      const j = Math.floor(s / gpsPeriod), f = (s % gpsPeriod) / gpsPeriod;
      const a = gps[j], b = gps[j + 1];
      if (a && b) { x.lat = +(a.lat + (b.lat - a.lat) * f).toFixed(6); x.lon = +(a.lon + (b.lon - a.lon) * f).toFixed(6); }
      else if (a && f === 0) { x.lat = a.lat; x.lon = a.lon; }
    }
    out.push(x);
  }
  return out;
}

export interface AssembleResult { ok: boolean; rideId?: string; added?: number; error?: string }

/** Składa wysłaną jazdę w `rides` (+ plik próbek) i wprowadza ją na listę aktywności. Bezpieczne do powtórzenia. */
export async function assembleRide(admin: SupabaseClient, userId: string, rideKey: number): Promise<AssembleResult> {
  const { data: up } = await admin.from('garmin_uploads')
    .select('summary, extra, ns, ng, ride_id').eq('user_id', userId).eq('ride_key', rideKey).maybeSingle();
  if (!up) return { ok: false, error: 'unknown_ride' };
  if (up.ride_id) return { ok: true, rideId: up.ride_id as string, added: 0 };   // już złożona (ponowione „finish”)

  const sum = cleanSummary(up.summary, rideKey);
  if (!sum) return { ok: false, error: 'bad_summary' };
  const extra = cleanExtra(up.extra, sum);

  const { data: chunks } = await admin.from('garmin_upload_chunks')
    .select('kind, seq, data').eq('user_id', userId).eq('ride_key', rideKey).order('seq', { ascending: true });
  const pick = (kind: string, n: number) => {
    const rows = (chunks ?? []).filter((c) => c.kind === kind);
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const row = rows.find((c) => c.seq === i);
      if (!row) return null;
      out.push(row.data as string);
    }
    return out;
  };
  const sChunks = pick('s', up.ns as number), gChunks = pick('g', up.ng as number);
  if (!sChunks || !gChunks) return { ok: false, error: 'missing_chunks' };

  const { data: athlete } = await admin.from('athletes').select('id, hrmax').eq('user_id', userId).maybeSingle();
  if (!athlete) return { ok: false, error: 'athlete_not_found' };

  const gps = decodeGps(gChunks);
  const samples = expandSamples(decodeSamples(sChunks), gps, sum.durationSec, sum.samplePeriod, sum.gpsPeriod);
  const hasGps = samples.some((x) => x.lat != null);
  const startedAt = new Date(rideKey * 1000).toISOString();

  // ta sama jazda mogła już zostać złożona, a zapis ride_id się nie udał – nie twórz drugiej
  const { data: existing } = await admin.from('rides').select('id')
    .eq('user_id', userId).eq('started_at', startedAt).like('source', 'veloiq-garmin%').maybeSingle();
  const rideId = (existing?.id as string | undefined) ?? randomUUID();
  if (!existing) {
    const path = `${userId}/${rideId}.jsonl`;
    const body = samples.map((x) => JSON.stringify(x)).join('\n');
    const upl = await admin.storage.from('rides').upload(path, Buffer.from(body), { contentType: 'application/x-ndjson', upsert: true });
    if (upl.error) return { ok: false, error: `storage: ${upl.error.message}` };

    const IF = sum.np > 0 ? sum.np / sum.ftp : null;
    const hrmax = (athlete.hrmax as number | null) ?? sum.maxHr;
    const hrTss = !IF && sum.avgHr && hrmax ? calculateTSSfromHR(sum.durationSec, sum.avgHr, hrmax) : null;
    const tss = IF ? Math.round((sum.durationSec * sum.np * IF) / (sum.ftp * 3600) * 100) : hrTss != null ? Math.round(hrTss) : null;
    const row = {
      id: rideId,
      user_id: userId,
      started_at: startedAt,
      duration_sec: sum.durationSec,
      avg_power: sum.avgPower,
      normalized_power: sum.np,
      intensity_factor: IF != null ? Math.round(IF * 1000) / 1000 : null,
      tss,
      kj: sum.kJ,
      avg_hr: sum.avgHr || null,
      max_hr: sum.maxHr || null,
      compliance_pct: extra.series.length ? sum.compliancePct : null,
      ftp_at_ride: sum.ftp,
      outdoor: sum.outdoor,
      has_gps: hasGps,
      workout_name: sum.workoutName,
      workout_script: extra.script,
      series: extra.series,
      efforts: extra.efforts,
      samples_path: path,
      source: 'veloiq-garmin',
      laps: extra.laps,
      extra: {
        distanceM: sum.distanceM, ascentM: sum.ascentM, elapsedSec: sum.elapsedSec, maxPower: sum.maxPower, avgCad: sum.avgCad,
        best: sum.best, zones: sum.zones, wbalMinPct: sum.wbalMinPct, device: sum.device, app: sum.app, samplePeriod: sum.samplePeriod,
      },
    };
    let ins = await admin.from('rides').insert(row);
    if (ins.error && /extra/i.test(ins.error.message)) {
      const { extra: _skip, ...noExtra } = row; void _skip;   // migracja 026 jeszcze nie dodała kolumny `extra`
      ins = await admin.from('rides').insert(noExtra);
    }
    if (ins.error) {
      await admin.storage.from('rides').remove([path]);
      return { ok: false, error: `insert: ${ins.error.message}` };
    }
  }

  await admin.from('garmin_uploads').update({ ride_id: rideId }).eq('user_id', userId).eq('ride_key', rideKey);
  await admin.from('garmin_upload_chunks').delete().eq('user_id', userId).eq('ride_key', rideKey);

  // lista aktywności, kalendarz, realizacja planu, FTP, CTL/ATL – tą samą drogą co jazdy z telefonu
  let added = 0;
  try {
    added = await importMissingRides(admin, userId, athlete.id as string);
    // dystans i przewyższenie z licznika (czujnik prędkości + barometr są dokładniejsze niż rzadki ślad GPS)
    if (sum.distanceM > 0 || sum.ascentM > 0) {
      await admin.from('strava_activities')
        .update({ ...(sum.distanceM > 0 ? { distance_km: Math.round(sum.distanceM / 10) / 100 } : {}), elevation_m: sum.ascentM })
        .eq('athlete_id', athlete.id).eq('strava_activity_id', veloiqActivityId(startedAt));
    }
  } catch (e) {
    console.error('[garmin/ride] import nieudany:', e instanceof Error ? e.message : e);
  }
  return { ok: true, rideId, added };
}
