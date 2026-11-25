// „Przed tobą” (jak Up Ahead w Edge 1060): kawiarnie, woda, toalety, serwisy rowerowe, sklepy i stacje paliw
// najwyżej ~150 m od trasy, z OpenStreetMap przez Overpass API. Wynik: dystans od startu, rodzaj, nazwa.
import { dist, type PoiKind, type RideRoute, type RoutePoi } from '@/lib/ride/gpx';

/** Serwery Overpass po kolei (pierwszy z OVERPASS_URL); kolejny, gdy poprzedni odmówi albo nie odpowie. */
export const OVERPASS_URLS = () => [
  ...(process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : []),
  'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
  // ostatnia deska ratunku (publiczny mirror VK Maps): w testach z GitHub Actions jedyny, który odpowiadał od ręki.
  // Dostaje tylko samo zapytanie z serwera VeloIQ (współrzędne, bez danych użytkownika). Własny serwer: OVERPASS_URL.
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
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

type OverpassEl = { type?: string; id?: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

/** Zapytanie do publicznych serwerów Overpass „z asekuracją”: zaczyna od pierwszego, a gdy ten po `hedgeMs` nie odpowie
 *  (albo od razu odmówi), dokłada kolejny; wygrywa pierwsza poprawna odpowiedź, reszta jest przerywana.
 *  Bez zalewania serwerów – kolejny dochodzi dopiero, gdy poprzedni milczy albo odmówił. */
export async function overpassFetch(query: string, budgetMs = 25000, fetcher: typeof fetch = fetch, hedgeMs = 4000): Promise<OverpassEl[]> {
  const urls = OVERPASS_URLS();
  const body = `data=${encodeURIComponent(query)}`;
  const ctls: AbortController[] = [];
  const errors: string[] = [];
  return new Promise<OverpassEl[]>((resolve, reject) => {
    let done = false, next = 0, running = 0;
    let hedge: ReturnType<typeof setTimeout> | null = null;
    const finish = (v: OverpassEl[] | null, err?: Error) => {
      if (done) return;
      done = true;
      if (hedge) clearTimeout(hedge);
      clearTimeout(overall);
      ctls.forEach((c) => c.abort());
      if (v) resolve(v); else reject(err ?? new Error('overpass'));
    };
    const overall = setTimeout(() => finish(null, new Error(`overpass: brak odpowiedzi w ${Math.round(budgetMs / 1000)} s (${errors.join(', ') || 'timeout'})`)), budgetMs);
    const launch = () => {
      if (done || next >= urls.length) return;
      const url = urls[next++];
      const ctl = new AbortController();
      ctls.push(ctl);
      running++;
      if (hedge) clearTimeout(hedge);
      hedge = setTimeout(launch, hedgeMs);
      (async () => {
        try {
          const res = await fetcher(url, { method: 'POST', signal: ctl.signal, body, headers: OVERPASS_HEADERS });
          if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
          const j = (await res.json()) as { elements?: OverpassEl[]; remark?: string };
          if (!Array.isArray(j.elements) || (j.remark && /error|timed out|out of memory/i.test(j.remark))) throw new Error(`${new URL(url).host}: ${j.remark ?? 'zła odpowiedź'}`);
          finish(j.elements);
        } catch (e) {
          if (done) return;
          errors.push(e instanceof Error ? e.message : String(e));
          running--;
          if (next < urls.length) launch();
          else if (running === 0) finish(null, new Error(`overpass: ${errors.join(', ')}`));
        }
      })();
    };
    launch();
  });
}

export async function fetchPois(r: RideRoute, fetcher: typeof fetch = fetch, timeoutMs = 30000): Promise<RoutePoi[]> {
  const els = await overpassFetch(overpassQuery(samplePath(r)), timeoutMs, fetcher);
  return poisFromOverpass(r, els);
}

const KIND_QUERY: Record<string, string> = {
  cafe: '["amenity"~"^(cafe|ice_cream)$"]', water: '["amenity"~"^(drinking_water|water_point)$"]', toilets: '["amenity"="toilets"]',
  bike: '["shop"="bicycle"]', shop: '["shop"~"^(convenience|supermarket|bakery)$"]', fuel: '["amenity"="fuel"]',
};

/** Najbliższy punkt danego rodzaju (w linii prostej, do 8 km) – „prowadź do najbliższej kawiarni”. */
export async function nearestPoi(pos: { lat: number; lon: number }, kind: string, fetcher: typeof fetch = fetch, budgetMs = 20000): Promise<{ lat: number; lon: number; name: string } | null> {
  const sel = KIND_QUERY[kind] ?? KIND_QUERY.cafe;
  const q = `[out:json][timeout:20];nwr(around:8000,${pos.lat.toFixed(5)},${pos.lon.toFixed(5)})${sel};out center 80;`;
  const els = await overpassFetch(q, budgetMs, fetcher);
  let best: { lat: number; lon: number; name: string } | null = null, bd = Infinity;
  for (const e of els) {
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const d = dist({ lat: pos.lat, lon: pos.lon, ele: null }, { lat, lon, ele: null });
    if (d < bd) { bd = d; best = { lat, lon, name: (e.tags?.name ?? POI_LABEL[(kind in POI_LABEL ? kind : 'cafe') as PoiKind]).slice(0, 40) }; }
  }
  return best;
}
