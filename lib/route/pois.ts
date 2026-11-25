// „Przed tobą” (jak Up Ahead w Edge 1060): kawiarnie, woda, toalety, serwisy rowerowe, sklepy i stacje paliw
// najwyżej ~150 m od trasy, z OpenStreetMap przez Overpass API. Wynik: dystans od startu, rodzaj, nazwa.
import { dist, type PoiKind, type RideRoute, type RoutePoi } from '@/lib/ride/gpx';

/** Serwery Overpass po kolei (pierwszy z OVERPASS_URL); kolejny, gdy poprzedni odmówi albo nie odpowie. */
export const OVERPASS_URLS = () => [
  ...(process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : []),
  'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
];
/** overpass-api.de odrzuca (406) zapytania, które nie wyglądają na zwykłego klienta OSM: potrzebny opisowy
 *  User-Agent, Referer i szerokie Accept (samo „application/json” kończy się 406). Ponawianie po 406 grozi banem,
 *  więc po odmowie od razu kolejny serwer. */
export const OVERPASS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  Accept: '*/*',
  'User-Agent': 'VeloIQ/1.0 (planer tras rowerowych; +https://veloiq-three.vercel.app)',
  Referer: 'https://veloiq-three.vercel.app/',
};
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
  const body = `data=${encodeURIComponent(overpassQuery(samplePath(r)))}`;
  let lastErr: unknown = null;
  for (const url of OVERPASS_URLS()) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetcher(url, {
        method: 'POST', signal: ctl.signal, body,
        headers: OVERPASS_HEADERS,
      });
      if (!res.ok) throw new Error(`overpass ${res.status} (${new URL(url).host})`);
      const j = (await res.json()) as { elements?: unknown[] };
      return poisFromOverpass(r, j.elements ?? []);
    } catch (e) {
      lastErr = e;
    } finally { clearTimeout(timer); }
  }
  throw lastErr instanceof Error ? lastErr : new Error('overpass');
}

const KIND_QUERY: Record<string, string> = {
  cafe: '["amenity"~"^(cafe|ice_cream)$"]', water: '["amenity"~"^(drinking_water|water_point)$"]', toilets: '["amenity"="toilets"]',
  bike: '["shop"="bicycle"]', shop: '["shop"~"^(convenience|supermarket|bakery)$"]', fuel: '["amenity"="fuel"]',
};

/** Najbliższy punkt danego rodzaju (w linii prostej, do 8 km) – „prowadź do najbliższej kawiarni”. */
export async function nearestPoi(pos: { lat: number; lon: number }, kind: string, fetcher: typeof fetch = fetch): Promise<{ lat: number; lon: number; name: string } | null> {
  const sel = KIND_QUERY[kind] ?? KIND_QUERY.cafe;
  const q = `[out:json][timeout:20];node(around:8000,${pos.lat.toFixed(5)},${pos.lon.toFixed(5)})${sel};out body 60;`;
  for (const url of OVERPASS_URLS()) {
    try {
      const res = await fetcher(url, {
        method: 'POST', body: `data=${encodeURIComponent(q)}`, signal: AbortSignal.timeout(20000),
        headers: OVERPASS_HEADERS,
      });
      if (!res.ok) continue;
      const els = ((await res.json()) as { elements?: { lat?: number; lon?: number; tags?: Record<string, string> }[] }).elements ?? [];
      let best: { lat: number; lon: number; name: string } | null = null, bd = Infinity;
      for (const e of els) {
        if (typeof e.lat !== 'number' || typeof e.lon !== 'number') continue;
        const d = dist({ lat: pos.lat, lon: pos.lon, ele: null }, { lat: e.lat, lon: e.lon, ele: null });
        if (d < bd) { bd = d; best = { lat: e.lat, lon: e.lon, name: (e.tags?.name ?? POI_LABEL[(kind in POI_LABEL ? kind : 'cafe') as PoiKind]).slice(0, 40) }; }
      }
      return best;
    } catch { /* kolejny serwer */ }
  }
  return null;
}
