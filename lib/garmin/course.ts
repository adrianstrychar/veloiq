// Trasa GPX dla aplikacji VeloIQ na liczniku Garmin Edge.
// Wejście: RideRoute z modułu „Jedź” (lib/ride/gpx.ts – punkty co ~10 m, skręty, podjazdy, opcjonalnie cele mocy
// ze strategii wyścigu). Licznik ma mało pamięci i małe odpowiedzi HTTP, więc trasa jest upraszczana
// (Douglas–Peucker, najwyżej MAX_POINTS punktów) i pakowana binarnie w części po PART_POINTS punktów:
//   punkt = 12 B: szer. int32 LE (mikrostopnie), dług. int32 LE, wysokość uint16 LE (m + 500, 65535 = brak),
//                 odległość od poprzedniego punktu uint16 LE (m, po trasie)
// Skręty: [dystans m, kod kierunku]; podjazdy: [start m, koniec m, przewyższenie m, nachylenie ×10, cel↓ W, cel↑ W, taktyka].
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { plainText } from './sync';

export const MAX_POINTS = 1496;        // 8 części × 187 punktów
export const PART_POINTS = 187;        // 2244 B → 2992 znaki base64 (jedna wartość w pamięci licznika)
const MAX_CUES = 300;
const MAX_CLIMBS = 40;
const MAX_GAP_M = 200;                 // najdłuższy odcinek bez punktu (profil wysokości na prostych)

export const DIR_CODES = ['left', 'right', 'slightLeft', 'slightRight', 'sharpLeft', 'sharpRight', 'uturn'] as const;
export const TIER_CODES = ['', 'oszczedz', 'atak', 'full'] as const;

export interface CoursePoint { lat: number; lon: number; ele: number | null; d: number }
export interface StoredCourse {
  v: 1;
  id: string;
  name: string;
  total: number;        // m
  gain: number;         // m
  n: number;            // liczba punktów
  parts: string[];      // base64
  cues: number[][];
  climbs: number[][];
  savedAt: string;
}

export class CourseError extends Error {}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Sprawdza i normalizuje punkty trasy z klienta. */
export function readPoints(pts: unknown): CoursePoint[] {
  if (!Array.isArray(pts) || pts.length < 2) throw new CourseError('Trasa nie ma punktów.');
  if (pts.length > 20000) throw new CourseError('Trasa ma za dużo punktów.');
  const out: CoursePoint[] = [];
  let lastD = -1;
  for (const p of pts) {
    if (!Array.isArray(p) || p.length < 4) continue;
    const lat = num(p[0]), lon = num(p[1]), d = num(p[3]);
    if (lat == null || lon == null || d == null) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || d < 0) continue;
    if (d <= lastD) continue;                       // dystans musi rosnąć
    out.push({ lat, lon, ele: num(p[2]), d });
    lastD = d;
  }
  if (out.length < 2) throw new CourseError('Trasa nie ma poprawnych punktów.');
  return out;
}

/** Douglas–Peucker w metrach (lokalne przybliżenie płaskie) – zwraca maskę punktów do zachowania. */
function dpMask(p: CoursePoint[], tolM: number): boolean[] {
  const keep = new Array<boolean>(p.length).fill(false);
  keep[0] = keep[p.length - 1] = true;
  const k = Math.cos((p[0].lat * Math.PI) / 180) * 111_320;
  const x = p.map((q) => q.lon * k), y = p.map((q) => q.lat * 110_540);
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    if (b - a < 2) continue;
    const dx = x[b] - x[a], dy = y[b] - y[a];
    const l2 = dx * dx + dy * dy;
    let best = -1, bestD = tolM;
    for (let i = a + 1; i < b; i++) {
      let d: number;
      if (l2 === 0) d = Math.hypot(x[i] - x[a], y[i] - y[a]);
      else {
        const t = Math.max(0, Math.min(1, ((x[i] - x[a]) * dx + (y[i] - y[a]) * dy) / l2));
        d = Math.hypot(x[i] - (x[a] + t * dx), y[i] - (y[a] + t * dy));
      }
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best > 0) { keep[best] = true; stack.push([a, best], [best, b]); }
  }
  return keep;
}

/** Uproszczenie śladu: Douglas–Peucker od 4 m (tolerancja rośnie, aż zostanie najwyżej `max` punktów),
 *  a na prostych zostaje punkt co MAX_GAP_M – żeby profil wysokości między punktami nie był zbyt zgrubny. */
export function simplify(p: CoursePoint[], max = MAX_POINTS): CoursePoint[] {
  if (p.length <= 2) return p;
  let tol = 4;
  for (let round = 0; round < 14; round++) {
    const keep = dpMask(p, tol);
    let last = 0;
    for (let i = 1; i < p.length; i++) {
      if (keep[i]) { last = i; continue; }
      if (p[i].d - p[last].d >= MAX_GAP_M) { keep[i] = true; last = i; }
    }
    const out = p.filter((_, i) => keep[i]);
    if (out.length <= max) return out;
    tol *= 1.5;
  }
  // bardzo długa, kręta trasa: równomierne przerzedzenie jako ostatnia deska
  const step = (p.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => p[Math.min(p.length - 1, Math.round(i * step))]);
}

export function encodePoints(p: CoursePoint[]): Buffer {
  const buf = Buffer.alloc(p.length * 12);
  for (let i = 0; i < p.length; i++) {
    const o = i * 12;
    buf.writeInt32LE(Math.round(p[i].lat * 1e6), o);
    buf.writeInt32LE(Math.round(p[i].lon * 1e6), o + 4);
    const e = p[i].ele;
    buf.writeUInt16LE(e == null ? 65535 : Math.max(0, Math.min(65534, Math.round(e) + 500)), o + 8);
    buf.writeUInt16LE(i === 0 ? 0 : Math.max(0, Math.min(65535, Math.round(p[i].d - p[i - 1].d))), o + 10);
  }
  return buf;
}

/** Do testów i podglądu: części base64 → punkty (dystans narastająco, jak liczy licznik). */
export function decodeParts(parts: string[]): CoursePoint[] {
  const out: CoursePoint[] = [];
  let d = 0;
  for (const part of parts) {
    const b = Buffer.from(part, 'base64');
    for (let o = 0; o + 12 <= b.length; o += 12) {
      const e = b.readUInt16LE(o + 8);
      d += b.readUInt16LE(o + 10);
      out.push({ lat: b.readInt32LE(o) / 1e6, lon: b.readInt32LE(o + 4) / 1e6, ele: e === 65535 ? null : e - 500, d });
    }
  }
  return out;
}

const int = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

/** RideRoute (z aplikacji) → trasa w formacie licznika. Rzuca CourseError, gdy danych nie da się użyć. */
export function buildCourse(route: unknown): StoredCourse {
  const r = (route && typeof route === 'object' ? route : {}) as Record<string, unknown>;
  const all = readPoints(r.pts);
  const pts = simplify(all);
  const total = Math.round(all[all.length - 1].d);
  if (total < 500) throw new CourseError('Trasa jest krótsza niż 500 m.');
  if (total > 600_000) throw new CourseError('Trasa jest dłuższa niż 600 km.');

  // dystans po uproszczeniu ma zostać dystansem z oryginału (suma różnic = d ostatniego punktu)
  const bin = encodePoints(pts);
  const parts: string[] = [];
  for (let i = 0; i < pts.length; i += PART_POINTS) parts.push(bin.subarray(i * 12, Math.min(pts.length, i + PART_POINTS) * 12).toString('base64'));

  const cues = (Array.isArray(r.cues) ? r.cues : []).map((c) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const dir = DIR_CODES.indexOf(String(o.dir) as (typeof DIR_CODES)[number]);
    return dir < 0 ? null : [int(o.d, 0, total), dir];
  }).filter((x): x is number[] => x != null).sort((a, b) => a[0] - b[0]).slice(0, MAX_CUES);

  const climbs = (Array.isArray(r.climbs) ? r.climbs : []).map((c) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const start = int(o.start, 0, total), end = int(o.end, 0, total);
    if (end <= start) return null;
    const low = int(o.low, 0, 2000), high = int(o.high, 0, 2000);
    const tier = Math.max(0, TIER_CODES.indexOf(String(o.tier ?? '') as (typeof TIER_CODES)[number]));
    return [start, end, int(o.gain, 0, 9000), int(Number(o.grade) * 10, 0, 400), low > 0 && high >= low ? low : 0, low > 0 && high >= low ? high : 0, tier];
  }).filter((x): x is number[] => x != null).sort((a, b) => a[0] - b[0]).slice(0, MAX_CLIMBS);

  const name = plainText(String(r.name ?? 'Trasa')).trim().slice(0, 40) || 'Trasa';
  const id = createHash('sha1').update(bin).update(JSON.stringify([name, cues, climbs])).digest('hex').slice(0, 12);
  return { v: 1, id, name, total, gain: int(r.gain, 0, 30000), n: pts.length, parts, cues, climbs, savedAt: new Date().toISOString() };
}

/** Nagłówek trasy dla licznika (bez punktów – te idą częściami). */
export function courseMeta(c: StoredCourse) {
  return { id: c.id, name: c.name, total: c.total, gain: c.gain, n: c.n, parts: c.parts.length, cues: c.cues, climbs: c.climbs };
}

// ---------------------------------------------------------------- zapis (Supabase Storage, bucket `rides`)

const pathFor = (userId: string) => `${userId}/garmin-course.json`;

export async function saveCourse(admin: SupabaseClient, userId: string, course: StoredCourse): Promise<void> {
  const up = await admin.storage.from('rides').upload(pathFor(userId), Buffer.from(JSON.stringify(course)), { contentType: 'application/json', upsert: true });
  if (up.error) throw new Error(`storage: ${up.error.message}`);
}

export async function loadCourse(admin: SupabaseClient, userId: string): Promise<StoredCourse | null> {
  const dl = await admin.storage.from('rides').download(pathFor(userId));
  if (dl.error || !dl.data) return null;
  try {
    const c = JSON.parse(await dl.data.text()) as StoredCourse;
    return c && c.v === 1 && Array.isArray(c.parts) && c.parts.length > 0 ? c : null;
  } catch { return null; }
}

export async function deleteCourse(admin: SupabaseClient, userId: string): Promise<void> {
  await admin.storage.from('rides').remove([pathFor(userId)]);
}
