// Planer tras VeloIQ: trasa do celu (z punktami pośrednimi) albo pętla na zadany dystans, w kilku wariantach
// do porównania (jak „Route Options” w Edge 1060): dystans, przewyższenie, czas z mocy zawodnika, nawierzchnia,
// kilometry po drogach z ruchem. Wynik to RideRoute – ta sama trasa idzie do nawigacji w telefonie i na licznik.
import { buildRoute, type RideRoute, type SurfaceCode } from '@/lib/ride/gpx';
import {
  brouterProfile, brouterUrl, hintsToCues, parseBrouter, PROFILE_LABEL, routingError, RoutingError, surfaceRuns,
  type BrouterTrack, type LatLon, type RouteOptions, type RouteProfile,
} from './brouter';
import { estimateSeconds, type Rider } from './estimate';

export interface PlanRequest {
  mode: 'ab' | 'loop';
  start: LatLon;
  end?: LatLon;
  vias?: LatLon[];
  loopKm?: number;
  heading?: number | null;     // pętla: kierunek (° od północy); brak = trzy różne kierunki
  seed?: number;               // pętla: „inne warianty” – obrót kierunków
  profile: RouteProfile;
  opts?: RouteOptions;
  name?: string;
}

export interface RouteStats {
  total: number; gain: number; estSec: number;
  surface: [number, number, number, number];   // m: asfalt, szuter, teren, nieznana
  mainRoad: number;                             // m po drogach krajowych / wojewódzkich
}
export interface PlannedRoute { route: RideRoute; stats: RouteStats; tag: string; heading?: number }

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const R = 6371000, rad = Math.PI / 180;
/** Punkt w odległości `m` od `p` w kierunku `brg` (° od północy). */
export function destination(p: LatLon, m: number, brg: number): LatLon {
  const d = m / R, b = brg * rad, la = p.lat * rad, lo = p.lon * rad;
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return { lat: la2 / rad, lon: ((lo2 / rad + 540) % 360) - 180 };
}

/** Pętla przez start: okrąg o promieniu r, którego środek leży w kierunku `heading`; `n` punktów po obwodzie. */
export function loopWaypoints(start: LatLon, r: number, heading: number, n = 3): LatLon[] {
  const c = destination(start, r, heading);
  const back = (heading + 180) % 360;
  const pts: LatLon[] = [start];
  for (let k = 1; k <= n; k++) pts.push(destination(c, r, back + (k * 360) / (n + 1)));
  pts.push(start);
  return pts;
}

/** Drogi są kręte: obwód okręgu × ~1,3 ≈ dystans po drogach. Promień dla pętli na `km`. */
export const loopRadius = (km: number) => (km * 1000) / (2 * Math.PI * 1.3);

async function fetchTrack(fetcher: Fetcher, pts: LatLon[], profile: RouteProfile, opts: RouteOptions, alt: number, timeoutMs: number): Promise<BrouterTrack> {
  const prof = brouterProfile(profile, opts);
  const run = async (name: string) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetcher(brouterUrl(pts, name, prof.params, alt), { signal: ctl.signal, headers: { 'User-Agent': 'VeloIQ/1.0 (+https://veloiq-three.vercel.app)' } });
      const text = await r.text();
      if (!r.ok || !text.trim().startsWith('{')) throw routingError(r.status, text.slice(0, 300));
      return parseBrouter(JSON.parse(text));
    } catch (e) {
      if (e instanceof RoutingError) throw e;
      if ((e as Error)?.name === 'AbortError') throw new RoutingError('Serwer tras nie odpowiedział na czas.', 'timeout');
      throw new RoutingError('Brak połączenia z serwerem tras.', 'unreachable');
    } finally { clearTimeout(timer); }
  };
  try { return await run(prof.name); } catch (e) {
    if (e instanceof RoutingError && e.code === 'profile' && prof.fallback) return run(prof.fallback);
    throw e;
  }
}

/** Ślad BRouter → RideRoute (punkty co ~10 m, podjazdy, skręty z wskazówek BRouter) + statystyki. */
export function toPlanned(t: BrouterTrack, name: string, profile: RouteProfile, rider: Rider): { route: RideRoute; stats: RouteStats } {
  const base = buildRoute(name, t.coords);
  const scale = base.total / Math.max(1, t.cum[t.cum.length - 1]);
  const hintCues = hintsToCues(t, scale);
  const { runs, meters, mainM } = surfaceRuns(t, base.total);
  const estSec = estimateSeconds(base.pts, runs, rider, profile);
  const gain = Math.round(t.ascend) || base.gain;
  const route: RideRoute = {
    ...base, gain,
    cues: hintCues.length >= Math.min(3, base.cues.length) ? hintCues : base.cues,
    profile, surface: runs, estSec,
  };
  return { route, stats: { total: base.total, gain, estSec, surface: meters, mainRoad: mainM } };
}

/** Podobieństwo tras (wspólne kratki ~150 m) – odsiewa warianty, które BRouter zwrócił prawie identyczne. */
export function similarity(a: RideRoute, b: RideRoute): number {
  const cells = (r: RideRoute) => new Set(r.pts.filter((_, i) => i % 3 === 0).map((p) => `${Math.round(p[0] * 700)}:${Math.round(p[1] * 450)}`));
  const A = cells(a), B = cells(b);
  let common = 0;
  A.forEach((c) => { if (B.has(c)) common++; });
  return common / Math.max(1, Math.min(A.size, B.size));
}

/** Krótki opis, czym wariant wyróżnia się na tle pozostałych. */
export function tagRoutes(list: PlannedRoute[], profile: RouteProfile): void {
  if (!list.length) return;
  const by = (f: (x: PlannedRoute) => number) => list.reduce((m, x) => (f(x) < f(m) ? x : m));
  const used = new Set<PlannedRoute>();
  const put = (x: PlannedRoute, tag: string) => { if (!used.has(x)) { x.tag = tag; used.add(x); } };
  put(by((x) => x.stats.estSec), 'Najszybsza');
  if (list.length > 1) put(by((x) => x.stats.gain), 'Najmniej podjazdów');
  if (list.length > 2) {
    if (profile === 'road' || profile === 'calm') put(by((x) => x.stats.mainRoad), 'Najmniej ruchu');
    else put(by((x) => -(x.stats.surface[1] + x.stats.surface[2])), profile === 'mtb' ? 'Najwięcej terenu' : 'Najwięcej szutru');
  }
  list.forEach((x, i) => { if (!used.has(x)) x.tag = `Wariant ${i + 1}`; });
}

const pl = (n: number) => Math.round(n);

/** Główne wejście: 1–3 warianty trasy. */
export async function planRoutes(req: PlanRequest, rider: Rider, fetcher: Fetcher = fetch, timeoutMs = 25000): Promise<PlannedRoute[]> {
  const opts = req.opts ?? {};
  const prof = req.profile;
  const label = PROFILE_LABEL[prof];
  const out: PlannedRoute[] = [];

  if (req.mode === 'ab') {
    if (!req.end) throw new RoutingError('Wybierz cel trasy.', 'no_route');
    const pts = [req.start, ...(req.vias ?? []), req.end];
    const name = req.name?.trim() || `${label}: trasa do celu`;
    const res = await Promise.allSettled([0, 1, 2].map((alt) => fetchTrack(fetcher, pts, prof, opts, alt, timeoutMs)));
    const firstErr = res.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    for (const r of res) if (r.status === 'fulfilled') out.push({ ...toPlanned(r.value, name, prof, rider), tag: '' });
    if (!out.length) throw firstErr?.reason instanceof RoutingError ? firstErr.reason : new RoutingError('Nie udało się wyznaczyć trasy.');
  } else {
    const km = Math.max(5, Math.min(300, req.loopKm ?? 50));
    const base = req.heading ?? (((req.seed ?? 0) * 53 + 20) % 360);
    const heads = req.heading != null ? [base, (base + 330) % 360, (base + 30) % 360] : [base, (base + 120) % 360, (base + 240) % 360];
    const name = req.name?.trim() || `${label}: pętla ${pl(km)} km`;
    const one = async (h: number): Promise<PlannedRoute> => {
      let r = loopRadius(km);
      let t = await fetchTrack(fetcher, loopWaypoints(req.start, r, h), prof, opts, 0, timeoutMs);
      // drugie podejście z poprawionym promieniem, gdy dystans odbiega o > 12%
      const got = t.cum[t.cum.length - 1] / 1000;
      if (Math.abs(got - km) / km > 0.12) {
        r *= Math.max(0.5, Math.min(1.8, km / Math.max(1, got)));
        try { t = await fetchTrack(fetcher, loopWaypoints(req.start, r, h), prof, opts, 0, timeoutMs); } catch { /* zostaje pierwszy wynik */ }
      }
      return { ...toPlanned(t, name, prof, rider), tag: '', heading: h };
    };
    const res = await Promise.allSettled(heads.map(one));
    const firstErr = res.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    for (const r of res) if (r.status === 'fulfilled') out.push(r.value);
    if (!out.length) throw firstErr?.reason instanceof RoutingError ? firstErr.reason : new RoutingError('Nie udało się wyznaczyć pętli.');
  }

  // bez prawie identycznych wariantów
  const uniq: PlannedRoute[] = [];
  for (const x of out) if (!uniq.some((u) => similarity(u.route, x.route) > 0.85)) uniq.push(x);
  tagRoutes(uniq, prof);
  return uniq;
}

/** Podsumowanie nawierzchni w procentach (do kart wariantów i odpowiedzi Enzo). */
export function surfacePct(s: RouteStats): Record<'paved' | 'gravel' | 'trail', number> {
  const all = Math.max(1, s.surface[0] + s.surface[1] + s.surface[2] + s.surface[3]);
  const gravel = Math.round((s.surface[1] / all) * 100), trail = Math.round((s.surface[2] / all) * 100);
  return { paved: Math.max(0, 100 - gravel - trail), gravel, trail };
}

export type { SurfaceCode };
