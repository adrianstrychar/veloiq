// Wykrywanie podjazdów z profilu GPX — histereza na PEŁNEJ rozdzielczości.
// Progi skalibrowane na 5 realnych plikach gravel (patrz rozpoznanie Etapu 2): pasmo ~9-19
// podjazdów taktycznych zamiast dziesiątek mikro-garbów.
//   enter>4% / exit<1% / merge luk <300m / min przewyższenie ≥40m  (skalibrowane: 13/8/15 na
//   3 realnych plikach — pasmo podjazdów taktycznych, nie garbów; 4/1.5/200/20 dawało 18-21).
//   grade_max liczony z OKNA 60m (nie między sąsiednimi punktami — inaczej dzielenie przez ~0
//   daje absurdalne setki %). Profil do wykresu downsamplowany osobno (~250 pkt).
import type { TrackPoint } from './parse-gpx';

export interface Climb {
  start_km: number;
  length_km: number;
  gain_m: number;
  grade_avg: number; // %
  grade_max: number; // % (z okna 60m)
  third: 1 | 2 | 3;  // która trzecia wyścigu (pozycja startu podjazdu)
}

export interface RouteAnalysis {
  distance_km: number;
  elevation_m: number;                    // suma podjazdów (wygładzona)
  profile: { km: number; ele: number }[]; // ~250 pkt do mini-wykresu
  climbs: Climb[];                         // pełna lista (top-N do promptu wybiera się osobno)
}

const ENTER = 4;      // % — wejście w podjazd
const EXIT = 1;       // % — wyjście z podjazdu
const MERGE_GAP = 300; // m — scal sąsiednie podjazdy jeśli przerwa krótsza
const MIN_GAIN = 40;  // m — odrzuć mikro-garby i garby taktycznie nieistotne
const MAX_WIN = 60;   // m — okno do grade_max
const SMOOTH = 3;     // ± punkty wygładzenia ele (surowe GPS ele skacze ±kilka m)
const PROFILE_PTS = 250;

// Grade w oknie ≥WIN metrów od punktu i (patrzy w przód aż uzbiera dystans).
function gradeWindow(S: { m: number; ele: number }[], i: number, win: number): number {
  let j = i;
  while (j < S.length - 1 && S[j].m - S[i].m < win) j++;
  const dm = S[j].m - S[i].m;
  return dm > 0 ? (S[j].ele - S[i].ele) / dm : 0;
}

export function analyzeRoute(points: TrackPoint[]): RouteAnalysis {
  const totalM = points[points.length - 1]?.distM ?? 0;

  // Wygładzenie ele oknem ±SMOOTH — bez tego histereza i gain reagują na szum GPS.
  const S = points.map((p, i) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - SMOOTH); j <= Math.min(points.length - 1, i + SMOOTH); j++) { sum += points[j].ele; n++; }
    return { m: p.distM, ele: sum / n };
  });

  // Suma podjazdów (wygładzona).
  let gain = 0;
  for (let i = 1; i < S.length; i++) { const d = S[i].ele - S[i - 1].ele; if (d > 0) gain += d; }

  // ── Histereza ──
  type Cur = { sM: number; eM: number; sE: number; eE: number; lastUp: number; mi: number };
  const rawClimbs: Cur[] = [];
  let cur: Cur | null = null;
  for (let i = 1; i < S.length; i++) {
    const seg = S[i].m - S[i - 1].m;
    if (seg <= 0) continue;
    const g = (S[i].ele - S[i - 1].ele) / seg;
    if (!cur) {
      if (g > ENTER / 100) cur = { sM: S[i - 1].m, eM: S[i].m, sE: S[i - 1].ele, eE: S[i].ele, lastUp: S[i].m, mi: i };
    } else if (g > EXIT / 100) {
      cur.eM = S[i].m; cur.eE = S[i].ele; if (g > 0) cur.lastUp = S[i].m;
    } else if (S[i].m - cur.lastUp > MERGE_GAP) {
      rawClimbs.push(cur); cur = null;
    } else {
      cur.eM = S[i].m; cur.eE = S[i].ele;
    }
  }
  if (cur) rawClimbs.push(cur);

  const climbs: Climb[] = rawClimbs
    .map((c) => {
      const len = c.lastUp - c.sM;
      const g = c.eE - c.sE;
      let max = 0;
      for (let k = c.mi; k < S.length && S[k].m <= c.lastUp; k++) { const gg = gradeWindow(S, k, MAX_WIN); if (gg > max) max = gg; }
      const third: 1 | 2 | 3 = c.sM / totalM < 1 / 3 ? 1 : c.sM / totalM < 2 / 3 ? 2 : 3;
      return {
        start_km: round1(c.sM / 1000),
        length_km: round2(len / 1000),
        gain_m: Math.round(g),
        grade_avg: round1(len > 0 ? (g / len) * 100 : 0),
        grade_max: round1(max * 100),
        third,
      };
    })
    .filter((c) => c.gain_m >= MIN_GAIN && c.length_km > 0);

  // ── Profil downsampled do ~PROFILE_PTS (równomiernie po dystansie) ──
  const step = Math.max(1, Math.floor(S.length / PROFILE_PTS));
  const profile: { km: number; ele: number }[] = [];
  for (let i = 0; i < S.length; i += step) profile.push({ km: round2(S[i].m / 1000), ele: Math.round(S[i].ele) });
  if (profile.length && profile[profile.length - 1].km !== round2(totalM / 1000)) {
    profile.push({ km: round2(totalM / 1000), ele: Math.round(S[S.length - 1].ele) });
  }

  return { distance_km: round1(totalM / 1000), elevation_m: Math.round(gain), profile, climbs };
}

// Top-N podjazdów wg trudności (gain × grade_avg) — do promptu, żeby model nie tonął w liście.
export function topClimbs(climbs: Climb[], n: number): Climb[] {
  return [...climbs].sort((a, b) => b.gain_m * b.grade_avg - a.gain_m * a.grade_avg).slice(0, n);
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;
