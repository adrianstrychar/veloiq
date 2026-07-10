// Helpery widoku dla streams_json (PR2: mapa + wykres). Czyste funkcje, bez React —
// testowalne żywym uruchomieniem bez przeglądarki.
import { C } from '@/lib/theme';
import type { StreamsJson } from '@/lib/strava/streams';

// Średnia krocząca po oknie windowSec (domyślnie 30 s — standard wygładzania mocy).
// Null-aware: nulle w oknie pomijane; próbka null zostaje null (pauza = przerwa na
// wykresie i szary segment na mapie, nie sztuczne zero zaniżające krzywą).
export function smoothWatts(
  watts: (number | null)[],
  dt: number,
  windowSec = 30
): (number | null)[] {
  const k = Math.max(1, Math.round(windowSec / dt));
  const out = new Array<number | null>(watts.length).fill(null);
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < watts.length; i++) {
    const w = watts[i];
    if (w != null) { sum += w; cnt++; }
    const drop = watts[i - k];
    if (i >= k && drop != null) { sum -= drop; cnt--; }
    out[i] = watts[i] == null ? null : cnt > 0 ? Math.round(sum / cnt) : null;
  }
  return out;
}

// Strefy treningowe 6-stopniowe wg % FTP. Progi: Z1 <55 | Z2 55–75 | Z3 75–90 | Z4 90–105
// | Z5 105–120 | Z6 >120. Granica należy do WYŻSZEJ strefy (55→Z2, 105→Z5). null gdy brak watts/ftp.
export type PowerZone = 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5' | 'Z6';
export const ZONES: PowerZone[] = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6'];

export function powerZone(watts: number | null, ftp: number | null): PowerZone | null {
  if (watts == null || ftp == null || ftp <= 0) return null;
  const pct = (watts / ftp) * 100;
  if (pct < 55) return 'Z1';
  if (pct < 75) return 'Z2';
  if (pct < 90) return 'Z3';
  if (pct < 105) return 'Z4';
  if (pct < 120) return 'Z5';
  return 'Z6';
}

// Kolory stref: Z1 szary, Z2 niebieski, Z3 zielony, Z4 żółty, Z5 pomarańcz (motyw nie ma tokenu —
// literał lokalnie), Z6 czerwony. Jedno źródło koloru dla mapy i paska stref.
const ZONE5_ORANGE = '#D98A3D';
export function zonePowerColor(z: PowerZone): string {
  switch (z) {
    case 'Z1': return C.muted;
    case 'Z2': return C.cyan;
    case 'Z3': return C.green;
    case 'Z4': return C.yellow;
    case 'Z5': return ZONE5_ORANGE;
    case 'Z6': return C.red;
  }
}

// Kolor punktu trasy/mapy. Brak FTP → jednolity neutralny cyan (bez stref — nie zgadujemy progu).
// Punkt bez watts (pauza) → szary. W przeciwnym razie kolor strefy z powerZone.
export function zoneColor(watts: number | null, ftp: number | null): string {
  if (ftp == null || ftp <= 0) return C.cyan;
  if (watts == null) return C.muted;
  const z = powerZone(watts, ftp);
  return z ? zonePowerColor(z) : C.muted;
}

export interface RouteSegment {
  color: string;
  points: [number, number][];
}

// Trasa jako polylines pogrupowane kolorem strefy: kolejne punkty o tym samym kolorze
// sklejamy w JEDNĄ polyline (tysiące 2-punktowych segmentów zabiłyby Leafleta na telefonie).
// Kolor z mocy WYGŁADZONEJ 30 s (surowe 5-sekundówki migotałyby strefami przy każdym szumie).
// Przy zmianie koloru nowy segment zaczyna się od ostatniego punktu poprzedniego (ciągłość
// linii). Luka GPS (lat/lng null — tunel, dropout) PRZERYWA linię — nie łączymy na skróty.
export function buildRouteSegments(streams: StreamsJson, ftp: number | null): RouteSegment[] {
  const { lat, lng, watts } = streams.series;
  const smoothed = smoothWatts(watts, streams.dt);
  const segments: RouteSegment[] = [];
  let cur: RouteSegment | null = null;

  for (let i = 0; i < streams.n; i++) {
    const la = lat[i];
    const ln = lng[i];
    if (la == null || ln == null) {
      cur = null; // luka GPS → zamknij segment, następny punkt zacznie nowy
      continue;
    }
    const color = zoneColor(smoothed[i], ftp);
    const pt: [number, number] = [la, ln];
    if (cur && cur.color === color) {
      cur.points.push(pt);
    } else {
      const bridge: [number, number] | null = cur ? cur.points[cur.points.length - 1] : null;
      cur = { color, points: bridge ? [bridge, pt] : [pt] };
      segments.push(cur);
    }
  }
  // Segmenty 1-punktowe (izolowane fixy GPS) nie narysują linii — odfiltruj.
  return segments.filter((s) => s.points.length >= 2);
}

// Czy streams zawierają sensowną trasę GPS (trenażer/rolka → same nulle → sekcja mapy znika).
export function hasGps(streams: StreamsJson): boolean {
  const { lat, lng } = streams.series;
  for (let i = 0; i < streams.n; i++) {
    if (lat[i] != null && lng[i] != null) return true;
  }
  return false;
}

// Czy jest moc do wykresu (jazda na HR → brak sekcji wykresu).
export function hasWatts(streams: StreamsJson): boolean {
  return streams.series.watts.some((w) => w != null);
}

// Rozkład czasu w strefach — 6 koszy (Z1..Z6), liczba próbek per strefa. Liczony z mocy
// WYGŁADZONEJ 30 s (to samo źródło co kolor mapy → pasek i mapa zgodne). Nulle/pauzy pomijane.
// Brak FTP → same zera (pasek stref znika). Kaller liczy % z sumy (każda próbka = dt sekund).
export function zoneDistribution(streams: StreamsJson, ftp: number | null): number[] {
  const counts = [0, 0, 0, 0, 0, 0];
  if (ftp == null || ftp <= 0) return counts;
  const smoothed = smoothWatts(streams.series.watts, streams.dt);
  for (let i = 0; i < streams.n; i++) {
    const z = powerZone(smoothed[i], ftp);
    if (z) counts[ZONES.indexOf(z)]++;
  }
  return counts;
}
