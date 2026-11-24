// Wyznaczanie tras rowerowych przez BRouter (https://brouter.de – otwarty silnik na danych OpenStreetMap).
// Każdy profil VeloIQ to profil BRouter + parametry, które zmieniają dobór dróg (bez własnego serwera):
//   szosa  → fastbike (asfalt, mały ruch) / fastbike-verylowtraffic („omijaj ruch”)
//   gravel → gravel (szutry i drogi polne, unika głównych dróg; opcja „więcej szutru”)
//   MTB    → mtb (ścieżki i single, teren)
//   spokojna → trekking z unikaniem niebezpiecznych dróg (rodzinnie, rekreacyjnie)
// Adres silnika: BROUTER_URL (domyślnie publiczny brouter.de); własna instancja = ten sam interfejs.
import type { Raw, RouteCue, SurfaceCode, TurnDir } from '@/lib/ride/gpx';
import { dist } from '@/lib/ride/gpx';
import { isMainRoad, parseTags, surfaceOf } from './surface';

export type RouteProfile = 'road' | 'gravel' | 'mtb' | 'calm';
export const PROFILES: RouteProfile[] = ['road', 'gravel', 'mtb', 'calm'];
export const PROFILE_LABEL: Record<RouteProfile, string> = { road: 'Szosa', gravel: 'Gravel', mtb: 'MTB', calm: 'Spokojna' };

export interface RouteOptions {
  quiet?: boolean;          // omijaj drogi z ruchem
  flow?: boolean;           // płynnie: omijaj miasta (mniej świateł, skrzyżowań i hamowania)
  flat?: boolean;           // omijaj strome podjazdy
  green?: boolean;          // lasy i zieleń
  moreUnpaved?: boolean;    // gravel: jak najwięcej szutru / MTB: jak najwięcej singli
}

export interface LatLon { lat: number; lon: number }

export const BROUTER_URL = () => (process.env.BROUTER_URL || 'https://brouter.de/brouter').replace(/\/$/, '');

/** Profil BRouter i parametry dla wyboru zawodnika. `fallback` – gdy serwer nie zna profilu. */
export function brouterProfile(p: RouteProfile, o: RouteOptions): { name: string; params: Record<string, string | number>; fallback?: string } {
  // BRouter wstrzykuje parametry jako liczby (Float.parseFloat) – „true” kończy się błędem 500, więc 1 / 0
  const b = (x: boolean | undefined) => (x ? 1 : 0);
  switch (p) {
    case 'road': {
      const params: Record<string, string | number> = { consider_town: b(o.flow), consider_forest: b(o.green) };
      if (o.flat) { params.uphillcost = 80; params.uphillcutoff = 3; }
      if (o.quiet) return { name: 'fastbike-verylowtraffic', params, fallback: 'fastbike' };
      params.consider_traffic = 0.3;
      return { name: 'fastbike', params };
    }
    case 'gravel':
      return {
        name: 'gravel',
        params: {
          prefer_unpaved_paths: b(o.moreUnpaved !== false), consider_traffic_estimate: b(o.quiet !== false),
          avoid_towns: b(o.flow), avoid_steep_inclines: b(o.flat), prefer_forests: b(o.green),
        },
        fallback: 'trekking',
      };
    case 'mtb':
      return {
        name: 'mtb',
        params: { MTB_factor: o.moreUnpaved ? 1.5 : 0.8, hills: o.flat ? 1 : 0, avoid_unsafe: o.quiet === false ? 0 : 1 },
        fallback: 'trekking',
      };
    default:
      return { name: 'trekking', params: { avoid_unsafe: 1, consider_traffic: 1, consider_forest: b(o.green), consider_town: b(o.flow) } };
  }
}

export function brouterUrl(points: LatLon[], profile: string, params: Record<string, string | number>, alt = 0): string {
  // klucze „profile:xxx” i separatory | , bez kodowania – tak jak buduje je klient brouter-web
  const lonlats = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join('|');
  const parts = [`lonlats=${lonlats}`, `profile=${encodeURIComponent(profile)}`, `alternativeidx=${alt}`, 'format=geojson', 'timode=3'];
  for (const [k, v] of Object.entries(params)) parts.push(`profile:${k}=${encodeURIComponent(String(v))}`);
  return `${BROUTER_URL()}?${parts.join('&')}`;
}

export class RoutingError extends Error {
  constructor(message: string, public code: 'unreachable' | 'no_route' | 'timeout' | 'profile' | 'server' = 'server', public detail = '') { super(message); }
}

/** Tekst błędu z BRouter → komunikat dla zawodnika. */
export function routingError(status: number, text: string): RoutingError {
  const t = text.toLowerCase();
  if (t.includes('profile') && (t.includes('not found') || t.includes('unknown') || t.includes('error parsing'))) return new RoutingError('Profil trasy niedostępny na serwerze.', 'profile');
  if (t.includes('not mapped') || t.includes('datafile') || t.includes('no route') || t.includes('target island') || t.includes('not found')) {
    return new RoutingError('Nie da się tam dojechać tym profilem – przesuń punkt bliżej drogi albo zmień profil.', 'no_route');
  }
  if (t.includes('timeout') || t.includes('watchdog') || t.includes('killed')) return new RoutingError('Trasa za długa dla serwera tras – podziel ją punktem pośrednim.', 'timeout');
  return new RoutingError(`Serwer tras odpowiedział błędem (${status}).`, 'server', text.slice(0, 200));
}

export interface BrouterTrack {
  coords: Raw[];                      // lat, lon, ele
  cum: number[];                      // dystans narastająco (m) po coords
  length: number;                     // m (BRouter)
  ascend: number;                     // m (BRouter, filtrowane)
  hints: { idx: number; cmd: number; exit: number; angle: number }[];
  segs: { len: number; surface: SurfaceCode; main: boolean }[];   // z „messages” (odcinki o tych samych tagach)
}

const nums = (x: unknown) => Number(x);

/** GeoJSON z BRouter → ślad, wskazówki skrętów i odcinki nawierzchni. */
export function parseBrouter(json: unknown): BrouterTrack {
  const f = (json as { features?: { properties?: Record<string, unknown>; geometry?: { coordinates?: number[][] } }[] })?.features?.[0];
  const coordsRaw = f?.geometry?.coordinates;
  if (!f || !Array.isArray(coordsRaw) || coordsRaw.length < 2) throw new RoutingError('Serwer tras nie zwrócił trasy.', 'no_route');
  const coords: Raw[] = coordsRaw.map((c) => ({ lon: c[0], lat: c[1], ele: c.length > 2 && Number.isFinite(c[2]) ? c[2] : null }));
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + dist(coords[i - 1], coords[i]));
  const pr = f.properties ?? {};
  const hints = (Array.isArray(pr.voicehints) ? pr.voicehints : []).map((h: unknown) => {
    const a = h as unknown[];
    return { idx: nums(a[0]), cmd: nums(a[1]), exit: nums(a[2]), angle: nums(a[4]) };
  }).filter((h) => Number.isFinite(h.idx) && h.idx >= 0 && h.idx < coords.length);
  const segs: BrouterTrack['segs'] = [];
  const msgs = Array.isArray(pr.messages) ? (pr.messages as unknown[][]) : [];
  if (msgs.length > 1) {
    const head = (msgs[0] as string[]).map((x) => String(x));
    const iDist = head.indexOf('Distance'), iTags = head.indexOf('WayTags');
    for (const row of msgs.slice(1)) {
      const len = Number(row[iDist]);
      if (!Number.isFinite(len) || len <= 0) continue;
      const tags = parseTags(String(row[iTags] ?? ''));
      segs.push({ len, surface: surfaceOf(tags), main: isMainRoad(tags) });
    }
  }
  return { coords, cum, length: Number(pr['track-length']) || cum[cum.length - 1], ascend: Number(pr['filtered ascend']) || 0, hints, segs };
}

/** Wskazówki BRouter → skręty VeloIQ (dystans od startu). Rondo: kierunek wyjazdu z kąta; „prosto przez rondo” pomijamy. */
export function hintsToCues(t: BrouterTrack, scale = 1): RouteCue[] {
  const out: RouteCue[] = [];
  const byCmd: Record<number, TurnDir> = { 2: 'left', 3: 'slightLeft', 4: 'sharpLeft', 5: 'right', 6: 'slightRight', 7: 'sharpRight', 8: 'slightLeft', 9: 'slightRight', 10: 'uturn', 11: 'uturn', 15: 'uturn' };
  for (const h of t.hints) {
    let dir: TurnDir | undefined = byCmd[h.cmd];
    if (h.cmd === 13 || h.cmd === 14) {
      if (h.angle <= -100) dir = 'sharpLeft';
      else if (h.angle <= -30) dir = 'left';
      else if (h.angle >= 100) dir = 'sharpRight';
      else if (h.angle >= 30) dir = 'right';
    }
    if (!dir) continue;
    const d = Math.round(t.cum[h.idx] * scale);
    if (d < 30) continue;
    out.push({ d, dir, angle: Math.round(h.angle) });
  }
  return out;
}

/** Odcinki nawierzchni → runy [od m, kod] (sąsiednie z tym samym kodem sklejone), przeskalowane do `total`. */
export function surfaceRuns(t: BrouterTrack, total: number): { runs: [number, SurfaceCode][]; meters: [number, number, number, number]; mainM: number } {
  const sum = t.segs.reduce((a, s) => a + s.len, 0);
  const meters: [number, number, number, number] = [0, 0, 0, 0];
  let mainM = 0;
  if (!sum) return { runs: [[0, 3]], meters: [0, 0, 0, total], mainM: 0 };
  const k = total / sum;
  const runs: [number, SurfaceCode][] = [];
  let d = 0;
  for (const s of t.segs) {
    const len = s.len * k;
    meters[s.surface] += len;
    if (s.main) mainM += len;
    if (!runs.length || runs[runs.length - 1][1] !== s.surface) runs.push([Math.round(d), s.surface]);
    d += len;
  }
  return { runs: mergeShort(runs, total), meters: meters.map(Math.round) as [number, number, number, number], mainM: Math.round(mainM) };
}

/** Odcinki krótsze niż 80 m (np. kawałek kostki na skrzyżowaniu) dołączamy do poprzedniego – czytelna mapa. */
function mergeShort(runs: [number, SurfaceCode][], total: number): [number, SurfaceCode][] {
  const out: [number, SurfaceCode][] = [];
  for (let i = 0; i < runs.length; i++) {
    const end = i + 1 < runs.length ? runs[i + 1][0] : total;
    if (out.length && end - runs[i][0] < 80) continue;
    if (out.length && out[out.length - 1][1] === runs[i][1]) continue;
    out.push(runs[i]);
  }
  return out.length ? out : [[0, 3]];
}
