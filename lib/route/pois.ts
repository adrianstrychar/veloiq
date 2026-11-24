// „Przed tobą” (jak Up Ahead w Edge 1060): kawiarnie, woda, toalety, serwisy rowerowe, sklepy i stacje paliw
// najwyżej ~150 m od trasy, z OpenStreetMap przez Overpass API. Wynik: dystans od startu, rodzaj, nazwa.
import { dist, type PoiKind, type RideRoute, type RoutePoi } from '@/lib/ride/gpx';

export const OVERPASS_URL = () => process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
export const POI_LABEL: Record<PoiKind, string> = {
  cafe: 'Kawiarnia', water: 'Woda pitna', toilets: 'Toaleta', bike: 'Serwis rowerowy', shop: 'Sklep', fuel: 'Stacja paliw', food: 'Jedzenie',
};
const MAX_POIS = 40;
const NEAR_M = 150;

/** Co ~400 m punkt trasy – linia do zapytania „around” (Overpass przyjmuje listę współrzędnych). */
export function samplePath(r: RideRoute, stepM = 400, max = 400): [number, number][] {
  const out: [number, number][] = [];
  let next = 0;
  const step = Math.max(stepM, r.total / max);
  for (const p of r.pts) {
    if (p[3] >= next) { out.push([p[0], p[1]]); next = p[3] + step; }
  }
  const last = r.pts[r.pts.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

export function overpassQuery(path: [number, number][], radius = NEAR_M): string {
  const line = path.map(([la, lo]) => `${la.toFixed(5)},${lo.toFixed(5)}`).join(',');
  const around = `(around:${radius},${line})`;
  return `[out:json][timeout:25];(`
    + `node${around}["amenity"~"^(cafe|ice_cream|drinking_water|water_point|toilets|bicycle_repair_station|fuel|restaurant|fast_food)$"];`
    + `node${around}["shop"~"^(bicycle|bakery|convenience|supermarket)$"];`
    + `node${around}["man_made"="water_tap"];`
    + `);out body 400;`;
}

export function kindOf(t: Record<string, string>): PoiKind | null {
  const a = t.amenity, s = t.shop;
  if (a === 'drinking_water' || a === 'water_point' || t.man_made === 'water_tap') return t.drinking_water === 'no' ? null : 'water';
  if (a === 'cafe' || a === 'ice_cream' || s === 'bakery') return 'cafe';
  if (a === 'toilets') return 'toilets';
  if (s === 'bicycle' || a === 'bicycle_repair_station') return 'bike';
  if (a === 'fuel') return 'fuel';
  if (s === 'convenience' || s === 'supermarket') return 'shop';
  if (a === 'restaurant' || a === 'fast_food') return 'food';
  return null;
}

/** Rzut punktu na trasę: dystans od startu i odległość od śladu (m). */
export function project(r: RideRoute, lat: number, lon: number): { d: number; off: number } {
  let best = Infinity, bd = 0;
  const step = Math.max(1, Math.floor(r.pts.length / 4000));
  for (let i = 0; i < r.pts.length; i += step) {
    const p = r.pts[i];
    const x = dist({ lat, lon, ele: null }, { lat: p[0], lon: p[1], ele: null });
    if (x < best) { best = x; bd = p[3]; }
  }
  return { d: Math.round(bd), off: Math.round(best) };
}

const PRIORITY: Record<PoiKind, number> = { water: 0, cafe: 1, bike: 2, toilets: 3, shop: 4, fuel: 5, food: 6 };

/** Elementy Overpass → punkty „Przed tobą”: tylko blisko trasy, bez dubli (ten sam rodzaj w promieniu 400 m),
 *  najwyżej MAX_POIS – woda i kawiarnie mają pierwszeństwo. */
export function poisFromOverpass(r: RideRoute, elements: unknown[]): RoutePoi[] {
  const found: RoutePoi[] = [];
  for (const e of elements) {
    const el = e as { lat?: number; lon?: number; tags?: Record<string, string> };
    if (typeof el.lat !== 'number' || typeof el.lon !== 'number') continue;
    const kind = kindOf(el.tags ?? {});
    if (!kind) continue;
    const { d, off } = project(r, el.lat, el.lon);
    if (off > NEAR_M + 30) continue;
    const name = (el.tags?.name ?? el.tags?.brand ?? POI_LABEL[kind]).replace(/\s+/g, ' ').trim().slice(0, 28);
    found.push({ d, kind, name, off });
  }
  found.sort((a, b) => a.d - b.d || PRIORITY[a.kind] - PRIORITY[b.kind]);
  const kept: RoutePoi[] = [];
  for (const p of found) {
    if (kept.some((k) => k.kind === p.kind && Math.abs(k.d - p.d) < 400)) continue;
    kept.push(p);
  }
  if (kept.length <= MAX_POIS) return kept;
  return kept.slice().sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.d - b.d).slice(0, MAX_POIS).sort((a, b) => a.d - b.d);
}

export async function fetchPois(r: RideRoute, fetcher: typeof fetch = fetch, timeoutMs = 25000): Promise<RoutePoi[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetcher(OVERPASS_URL(), {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'VeloIQ/1.0 (+https://veloiq-three.vercel.app)' },
      body: `data=${encodeURIComponent(overpassQuery(samplePath(r)))}`,
    });
    if (!res.ok) throw new Error(`overpass ${res.status}`);
    const j = (await res.json()) as { elements?: unknown[] };
    return poisFromOverpass(r, j.elements ?? []);
  } finally { clearTimeout(timer); }
}
