// Trasa z pliku GPX → dane dla nawigacji Enzo (natywny RouteNavigator na iPhonie).
// Punkty co ~10 m z narastającym dystansem, wykryte skręty (z geometrii trasy – GPX nie ma
// skrzyżowań) i podjazdy (z wygładzonej wysokości). Wszystko liczone w aplikacji, offline.

export type TurnDir = 'left' | 'right' | 'slightLeft' | 'slightRight' | 'sharpLeft' | 'sharpRight' | 'uturn';
export interface RouteCue { d: number; dir: TurnDir; angle: number }
export interface RouteClimb { start: number; end: number; gain: number; grade: number }
export interface RideRoute {
  name: string;
  total: number;                                    // m
  gain: number;                                     // m przewyższenia
  pts: [number, number, number | null, number][];   // lat, lon, ele, dystans od startu (m)
  cues: RouteCue[];
  climbs: RouteClimb[];
}

interface Raw { lat: number; lon: number; ele: number | null }

const R = 6371000, rad = Math.PI / 180;
function dist(a: Raw, b: Raw) {
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearing(a: Raw, b: Raw) {
  const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
  return Math.atan2(y, x) / rad;
}
const wrap = (a: number) => ((a + 540) % 360) - 180;

/** GPX (trk/trkpt albo rte/rtept) → nazwa + punkty. Rzuca błąd, gdy pliku nie da się użyć. */
export function parseGpx(xml: string): { name: string; raw: Raw[] } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('To nie jest poprawny plik GPX.');
  let nodes = Array.from(doc.getElementsByTagName('trkpt'));
  if (nodes.length < 2) nodes = Array.from(doc.getElementsByTagName('rtept'));
  const raw: Raw[] = [];
  for (const n of nodes) {
    const lat = parseFloat(n.getAttribute('lat') ?? ''), lon = parseFloat(n.getAttribute('lon') ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const e = n.getElementsByTagName('ele')[0]?.textContent;
    const ele = e != null && e.trim() !== '' && Number.isFinite(parseFloat(e)) ? parseFloat(e) : null;
    const last = raw[raw.length - 1];
    if (last && last.lat === lat && last.lon === lon) continue;
    raw.push({ lat, lon, ele });
  }
  if (raw.length < 2) throw new Error('W pliku nie ma trasy (brak punktów trkpt/rtept).');
  const name = doc.querySelector('trk > name, rte > name, metadata > name')?.textContent?.trim() || 'Trasa';
  return { name, raw };
}

/** Równe odstępy (spacing m) – stabilne kąty i wysokość niezależnie od gęstości punktów w pliku. */
function resample(raw: Raw[], spacing: number): { p: Raw[]; d: number[] } {
  const p: Raw[] = [raw[0]], d: number[] = [0];
  let acc = 0, next = spacing;
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1], b = raw[i];
    const seg = dist(a, b);
    if (seg <= 0) continue;
    while (acc + seg >= next) {
      const t = (next - acc) / seg;
      p.push({
        lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t,
        ele: a.ele != null && b.ele != null ? a.ele + (b.ele - a.ele) * t : (a.ele ?? b.ele),
      });
      d.push(next);
      next += spacing;
    }
    acc += seg;
  }
  const last = raw[raw.length - 1];
  if (acc - d[d.length - 1] > 1) { p.push(last); d.push(acc); }
  return { p, d };
}

function findCues(p: Raw[], d: number[], spacing: number): RouteCue[] {
  const k = Math.max(2, Math.round(30 / spacing));      // kąt z odcinków ~30 m przed i po
  const k2 = Math.max(k + 1, Math.round(70 / spacing)); // i ~70 m – odsiewa drobne zawijasy GPS
  const cand: { i: number; a: number }[] = [];
  for (let i = k2; i < p.length - k2; i++) {
    const a = wrap(bearing(p[i], p[i + k]) - bearing(p[i - k], p[i]));
    const a2 = wrap(bearing(p[i], p[i + k2]) - bearing(p[i - k2], p[i]));
    if (Math.abs(a) >= 35 && Math.abs(a2) >= 30 && Math.sign(a) === Math.sign(a2)) cand.push({ i, a: Math.abs(a2) > Math.abs(a) ? a2 : a });
  }
  // grupy sąsiednich kandydatów → jeden skręt w miejscu największego kąta
  const cues: RouteCue[] = [];
  let g: { i: number; a: number }[] = [];
  const flush = () => {
    if (!g.length) return;
    const best = g.reduce((m, x) => (Math.abs(x.a) > Math.abs(m.a) ? x : m));
    const ab = Math.abs(best.a), left = best.a < 0;
    const dir: TurnDir = ab >= 160 ? 'uturn' : ab >= 120 ? (left ? 'sharpLeft' : 'sharpRight')
      : ab >= 55 ? (left ? 'left' : 'right') : (left ? 'slightLeft' : 'slightRight');
    cues.push({ d: Math.round(d[best.i]), dir, angle: Math.round(best.a) });
    g = [];
  };
  for (const c of cand) {
    if (g.length && c.i - g[g.length - 1].i > 2) flush();
    g.push(c);
  }
  flush();
  const total = d[d.length - 1];
  // bez skrętów na pierwszych 50 m i ostatnich 30 m; dwa skręty bliżej niż 40 m → mocniejszy
  const out: RouteCue[] = [];
  for (const c of cues) {
    if (c.d < 50 || c.d > total - 30) continue;
    const prev = out[out.length - 1];
    if (prev && c.d - prev.d < 40) { if (Math.abs(c.angle) > Math.abs(prev.angle)) out[out.length - 1] = c; continue; }
    out.push(c);
  }
  return out;
}

function findClimbs(p: Raw[], d: number[], spacing: number): { climbs: RouteClimb[]; gain: number } {
  if (p.filter((x) => x.ele != null).length < p.length * 0.8) return { climbs: [], gain: 0 };
  // uzupełnij luki i wygładź (~100 m)
  const e0 = p.map((x) => x.ele);
  let lastE = e0.find((x) => x != null) as number;
  const filled = e0.map((x) => (x == null ? lastE : (lastE = x)));
  const w = Math.max(1, Math.round(50 / spacing));
  const e = filled.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(filled.length - 1, i + w); j++) { s += filled[j]; n++; }
    return s / n;
  });
  let gain = 0;
  for (let i = 1; i < e.length; i++) if (e[i] > e[i - 1]) gain += e[i] - e[i - 1];
  const climbs: RouteClimb[] = [];
  let i = 0;
  while (i < e.length - 1) {
    let s = i, maxI = i, j = i + 1;
    while (j < e.length && e[j] > e[maxI] - 15) {        // podjazd trwa, dopóki nie zjedziemy > 15 m od szczytu
      if (e[j] > e[maxI]) maxI = j;
      if (e[j] < e[s] && maxI <= s) { s = j; maxI = j; } // niższy start przed szczytem
      j++;
    }
    // przytnij płaskie początki/końce: podjazd zaczyna się tam, gdzie robi się > 2% na 200 m
    const w2 = Math.max(1, Math.round(200 / spacing));
    while (s + w2 < maxI && e[s + w2] - e[s] < 0.02 * 200) s++;
    let top = maxI;
    while (top - w2 > s && e[top] - e[top - w2] < 0.02 * 200) top--;
    const g = e[top] - e[s], len = d[top] - d[s];
    if (g >= 40 && len >= 500 && g / len >= 0.03) {
      climbs.push({ start: Math.round(d[s]), end: Math.round(d[top]), gain: Math.round(g), grade: Math.round((g / len) * 1000) / 10 });
    }
    i = Math.max(j, maxI + 1);
  }
  return { climbs, gain: Math.round(gain) };
}

export function buildRoute(name: string, raw: Raw[]): RideRoute {
  let length = 0;
  for (let i = 1; i < raw.length; i++) length += dist(raw[i - 1], raw[i]);
  const spacing = Math.max(10, Math.ceil(length / 12000));   // maks. ~12 tys. punktów
  const { p, d } = resample(raw, spacing);
  const { climbs, gain } = findClimbs(p, d, spacing);
  return {
    name, total: Math.round(d[d.length - 1]), gain,
    pts: p.map((x, i) => [Math.round(x.lat * 1e6) / 1e6, Math.round(x.lon * 1e6) / 1e6, x.ele == null ? null : Math.round(x.ele), Math.round(d[i])]),
    cues: findCues(p, d, spacing),
    climbs,
  };
}

export function routeFromGpx(xml: string): RideRoute {
  const { name, raw } = parseGpx(xml);
  return buildRoute(name, raw);
}
