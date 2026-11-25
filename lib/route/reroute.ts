// Powrót na trasę i do startu z licznika (jak „Back on Track” w Wahoo / przeliczanie w Garminie):
// licznik wysyła pozycję, serwer wyznacza dojazd profilem trasy i – przy powrocie na trasę – dokleja resztę
// oryginalnego śladu (skręty, podjazdy, nawierzchnia i punkty „Przed tobą” przesunięte o nowy początek).
import { buildRoute, dist, type RideRoute, type RouteCue, type SurfaceCode, type RoutePoi, type PoiKind } from '@/lib/ride/gpx';
import { decodeParts, DIR_CODES, POI_CODES, TIER_CODES, type CoursePoint, type StoredCourse } from '@/lib/garmin/course';
import type { LatLon } from './brouter';

/** Punkt powrotu: najbliższy (w linii prostej) punkt trasy między 300 m a 6 km przed ostatnim postępem.
 *  Gdy jesteśmy blisko mety – meta. Zwraca indeks punktu w `pts`. */
export function rejoinIndex(pts: CoursePoint[], pos: LatLon, prog: number): number {
  let best = -1, bestD = Infinity;
  const from = prog + 300, to = prog + 6000;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.d < from) continue;
    if (p.d > to) break;
    const x = dist({ lat: pos.lat, lon: pos.lon, ele: null }, { lat: p.lat, lon: p.lon, ele: null });
    if (x < bestD) { bestD = x; best = i; }
  }
  return best >= 0 ? best : pts.length - 1;
}

const near = (a: number, b: number, m: number) => Math.abs(a - b) <= m;

/** Dojazd (RideRoute z planera) + reszta zapisanej trasy od punktu `idx` → jedna trasa dla licznika. */
export function spliceCourse(approach: RideRoute, stored: StoredCourse, idx: number): RideRoute {
  const orig = decodeParts(stored.parts);
  const join = orig[Math.max(0, Math.min(idx, orig.length - 1))];
  const off = approach.total - join.d;                 // przesunięcie dystansów oryginału
  const rest = orig.slice(idx + 1);
  const pts: RideRoute['pts'] = [
    ...approach.pts,
    ...rest.map((p) => [p.lat, p.lon, p.ele, Math.round(p.d + off)] as [number, number, number | null, number]),
  ];
  const total = pts.length ? pts[pts.length - 1][3] : approach.total;

  // skręt na połączeniu dojazdu z trasą – z geometrii całości (± 150 m od punktu powrotu)
  const geo = buildRoute(approach.name, pts.map((p) => ({ lat: p[0], lon: p[1], ele: p[2] })));
  const k = geo.total / Math.max(1, total);
  const joinCues = geo.cues.filter((c) => near(c.d / k, approach.total, 150)).map((c) => ({ ...c, d: Math.round(c.d / k) }));
  const restCues: RouteCue[] = stored.cues.filter((c) => c[0] > join.d + 20).map((c) => ({ d: Math.round(c[0] + off), dir: DIR_CODES[c[1]] ?? 'left', angle: 0 }));
  const cues = [...approach.cues.filter((c) => c.d < approach.total - 60), ...joinCues, ...restCues].sort((a, b) => a.d - b.d);

  const climbs = [
    ...approach.climbs,
    ...stored.climbs.filter((c) => c[1] > join.d + 200).map((c) => ({
      start: Math.round(Math.max(c[0], join.d) + off), end: Math.round(c[1] + off), gain: c[2], grade: c[3] / 10,
      ...(c[4] > 0 ? { low: c[4], high: c[5] } : {}), ...(c[6] > 0 ? { tier: TIER_CODES[c[6]] as 'oszczedz' | 'atak' | 'full' } : {}),
    })),
  ];

  const surface: [number, SurfaceCode][] = [...(approach.surface ?? [[0, 3]])];
  if (stored.surf?.length) {
    let cur = stored.surf[0][1];
    for (const s of stored.surf) if (s[0] <= join.d) cur = s[1];
    surface.push([Math.round(approach.total), cur as SurfaceCode]);
    for (const s of stored.surf) if (s[0] > join.d) surface.push([Math.round(s[0] + off), s[1] as SurfaceCode]);
  }

  const pois: RoutePoi[] = (stored.pois ?? []).filter((p) => (p[0] as number) > join.d).map((p) => ({
    d: Math.round((p[0] as number) + off), kind: (POI_CODES[p[1] as number] ?? 'cafe') as PoiKind, name: String(p[2] ?? ''),
  }));

  return {
    name: stored.name, total, gain: approach.gain + Math.max(0, stored.gain - Math.round(stored.gain * (join.d / Math.max(1, stored.total)))),
    pts, cues, climbs, surface, pois, profile: stored.prof ?? approach.profile,
  };
}
