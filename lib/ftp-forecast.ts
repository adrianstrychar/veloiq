// Prognoza FTP (wykres Progress) — DETERMINISTYCZNA, czysta funkcja bez I/O, liczona w locie
// przy renderze (zero migracji, zero stanu; rekalibracja tygodniowa dzieje się sama, bo każdy
// render liczy z aktualnych danych). Model: malejące przyrosty wg W/kg × sprzężenie z planem
// (CTL ramp z weekly_tss_target) × osobista odpowiedź usera (G kalibrowane z ftp_history).
//
//   ΔFTP_tydz = G × headroom(W/kg) × rampFactor
//   headroom  = (WKG_CEIL − wkg) / (WKG_CEIL − WKG_FLOOR)   [malejące przyrosty przy sufitie]
//   ramp      = clamp(ΔCTL_tydz / RAMP_REF, 0, 1.5)          [wzrost obciążenia napędza formę]
//   taper     = tydzień w oknie taperDaysFor(priorytet startu) → ramp 0 (pas płaski — CTL
//               celowo spada, to plan, nie regres; ten sam próg co wszędzie w apce)
//
// Pas niepewności: scenariusze asymetryczne (niedowiezienie bardziej prawdopodobne niż
// nadodpowiedź): lo = 0.5·G, hi = 1.25·G — trzy niezależne trajektorie (każda z własnym W/kg,
// więc górna sama się wypłaszcza przy sufitie). Detrening (spadek FTP) świadomie poza v1.
import { taperDaysFor, type RacePriority } from '@/lib/race-taper';

export interface FtpHistoryPoint { date: string; ftp: number; source?: string | null }
export interface CtlPointF { date: string; ctl: number }
export interface PlannedWeekTss { weekStart: string; tss: number }
export interface RaceLite { date: string; priority: RacePriority }

export interface ForecastInputs {
  ftpNow: number;                 // punkt startowy (wyświetlane ftp_watts ?? ftp_estimate)
  massKg: number | null;          // null → headroom stały 0.4 (bez W/kg nie zgadujemy sufitu)
  ctlNow: number;
  plannedWeeks: PlannedWeekTss[]; // znane weekly_tss_target (posortowane; zwykle 1-2 tyg.)
  ftpHistory: FtpHistoryPoint[];  // rosnąco po dacie — do kalibracji G
  ctlSeries: CtlPointF[];         // rosnąco — do rampFactor historycznych segmentów
  races: RaceLite[];              // nadchodzące starty → okna taperu (plateau)
  today: string;                  // 'YYYY-MM-DD'
  horizonWeeks?: number;          // default 14
}

export interface ForecastPoint { t: number; lo: number; central: number; hi: number }
export interface FtpForecast {
  points: ForecastPoint[];        // [0] = dziś (lo=central=hi=ftpNow) → pas doklejony do realu
  g: number;                      // użyte G (po kalibracji/blendzie)
  gSource: 'default' | 'blended' | 'user';
  calibrationWeeks: number;       // ile tygodni historii ważyło w G
}

// ── Parametry modelu (jedyne miejsce strojenia; kalibracja 2026-07 na historii Adriana) ──
export const FORECAST_CONFIG = {
  WKG_CEIL: 5.9,        // praktyczny sufit amatora-elity
  WKG_FLOOR: 2.0,
  RAMP_REF: 1.5,        // ΔCTL/tydz dający pełny rampFactor 1.0
  RAMP_MAX: 1.5,
  G_DEFAULT: 2.2,       // W/tydz na jednostkę headroom (populacyjny start)
  G_MIN: 0.8,
  G_MAX: 4.5,
  LO_FACTOR: 0.5,       // dolny scenariusz (adherencja/choroba)
  HI_FACTOR: 1.25,      // górny (wysoka odpowiedź)
  HEADROOM_NO_MASS: 0.4,
  CAL_MIN_WEEKS: 8,     // poniżej — czysty default (user: "jeśli ≥8 tyg danych")
  CAL_FULL_WEEKS: 16,   // od tylu tygodni historia waży w pełni
  SEG_MAX_RATE: 3,      // W/tydz — szybszy segment = zmiana metody pomiaru, nie fizjologia (wyklucz)
  SEG_MIN_DAYS: 14,
  // Fallback tygodniowego TSS poza horyzontem planu: konwencja rekomendacji godzin
  // (targetWeeklyTSS = ctl·7·1.15) — zakładamy trening na poziomie rekomendowanym.
  TSS_FALLBACK_MULT: 1.15,
} as const;

const K7 = 1 - Math.exp(-7 / 42); // tygodniowy krok filtra CTL (stała 42 dni jak w PMC)
const WEEK_MS = 7 * 86_400_000;

function dayNum(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function headroom(ftp: number, massKg: number | null): number {
  const { WKG_CEIL, WKG_FLOOR, HEADROOM_NO_MASS } = FORECAST_CONFIG;
  if (massKg == null || massKg <= 0) return HEADROOM_NO_MASS;
  const wkg = ftp / massKg;
  return Math.max(0, (WKG_CEIL - wkg) / (WKG_CEIL - WKG_FLOOR));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Średni tygodniowy ΔCTL w przedziale dat (z realnej serii fitness_metrics).
function avgWeeklyDctl(ctlSeries: CtlPointF[], fromIso: string, toIso: string): number | null {
  const from = dayNum(fromIso);
  const to = dayNum(toIso);
  const inRange = ctlSeries.filter((p) => dayNum(p.date) >= from && dayNum(p.date) <= to);
  if (inRange.length < 2) return null;
  const days = dayNum(inRange[inRange.length - 1].date) - dayNum(inRange[0].date);
  if (days < 7) return null;
  return ((inRange[inRange.length - 1].ctl - inRange[0].ctl) / days) * 7;
}

export interface CalibrationResult {
  g: number;
  gSource: 'default' | 'blended' | 'user';
  weeks: number;
  segments: { from: string; to: string; ratePerWeek: number; impliedG: number; excluded: string | null }[];
}

// Kalibracja G z historii usera: implikowane G per segment (rate / (headroom·ramp)), mediana,
// blend z defaultem wagą rosnącą z długością historii. Segmenty-anomalie (skok metody pomiaru,
// za krótkie) wykluczane JAWNIE (pole excluded — do diagnostyki/testów).
export function calibrateG(
  ftpHistory: FtpHistoryPoint[],
  ctlSeries: CtlPointF[],
  massKg: number | null
): CalibrationResult {
  const C = FORECAST_CONFIG;
  const segments: CalibrationResult['segments'] = [];
  const implied: { g: number; weeks: number }[] = [];

  for (let i = 1; i < ftpHistory.length; i++) {
    const a = ftpHistory[i - 1];
    const b = ftpHistory[i];
    const days = dayNum(b.date) - dayNum(a.date);
    const rate = days > 0 ? ((b.ftp - a.ftp) / days) * 7 : 0;
    let excluded: string | null = null;
    if (days < C.SEG_MIN_DAYS) excluded = `za krótki (${days} dni)`;
    else if (Math.abs(rate) > C.SEG_MAX_RATE) excluded = `tempo ${rate.toFixed(1)} W/tydz — zmiana metody pomiaru, nie fizjologia`;
    else if (rate <= 0) excluded = 'brak przyrostu (model v1 nie uczy się z plateau/spadku)';

    let impliedG = 0;
    if (!excluded) {
      const h = headroom((a.ftp + b.ftp) / 2, massKg);
      const dctl = avgWeeklyDctl(ctlSeries, a.date, b.date);
      const ramp = dctl != null ? Math.min(Math.max(dctl / C.RAMP_REF, 0.3), C.RAMP_MAX) : 1; // floor 0.3: brak danych CTL nie zawyża G w nieskończoność
      impliedG = h > 0 ? rate / (h * ramp) : 0;
      if (impliedG > 0) implied.push({ g: impliedG, weeks: days / 7 });
    }
    segments.push({ from: a.date, to: b.date, ratePerWeek: Math.round(rate * 100) / 100, impliedG: Math.round(impliedG * 100) / 100, excluded });
  }

  const weeks = implied.reduce((s, x) => s + x.weeks, 0);
  if (weeks < C.CAL_MIN_WEEKS || implied.length === 0) {
    return { g: C.G_DEFAULT, gSource: 'default', weeks: Math.round(weeks), segments };
  }
  const gUser = median(implied.map((x) => x.g));
  const w = Math.min(1, weeks / C.CAL_FULL_WEEKS);
  const g = Math.min(C.G_MAX, Math.max(C.G_MIN, w * gUser + (1 - w) * C.G_DEFAULT));
  return { g: Math.round(g * 100) / 100, gSource: w >= 1 ? 'user' : 'blended', weeks: Math.round(weeks), segments };
}

// Czy tydzień [weekStartDay, weekStartDay+6] zahacza o okno taperu któregoś startu.
function weekInTaper(weekStartDay: number, races: RaceLite[]): boolean {
  for (const r of races) {
    const raceDay = dayNum(r.date);
    const taperFrom = raceDay - taperDaysFor(r.priority);
    if (taperFrom > raceDay) continue;
    // przecięcie [weekStartDay, weekStartDay+6] × [taperFrom, raceDay]
    if (weekStartDay <= raceDay && weekStartDay + 6 >= taperFrom) return true;
  }
  return false;
}

export function forecastFtp(inputs: ForecastInputs): FtpForecast {
  const C = FORECAST_CONFIG;
  const horizon = inputs.horizonWeeks ?? 14;
  const cal = calibrateG(inputs.ftpHistory, inputs.ctlSeries, inputs.massKg);
  const g = cal.g;

  // Plan TSS per przyszły tydzień: znany target z weekly_plans rządzi tam, gdzie istnieje.
  // Poza horyzontem planu (zwykle 1-2 tyg.) NIE uśredniamy znanych tygodni — tydzień taperowy
  // (np. 320 TSS przed startem) zaniżałby "typowy przyszły tydzień" i prognoza stawałaby w miejscu
  // (wykryte twardym testem kalibracji). Fallback = konwencja rekomendacji apki: tss = ctl·7·1.15
  // (ta sama formuła co targetWeeklyTSS suwaka godzin), licząc od SYMULOWANEGO ctl danego tygodnia
  // — założenie: user trenuje na poziomie rekomendowanym.
  const known = new Map<number, number>();
  for (const p of inputs.plannedWeeks) known.set(dayNum(p.weekStart), p.tss);
  const todayDay = dayNum(inputs.today);

  // Poniedziałek tygodnia zawierającego dziś (dayNum epoki: 1970-01-01 = czwartek → dow (d+3)%7, 0=Pn).
  const dowToday = (todayDay + 3) % 7;
  const mondayDay = todayDay - dowToday;

  let ctl = inputs.ctlNow;
  const traj = { lo: inputs.ftpNow, central: inputs.ftpNow, hi: inputs.ftpNow };
  const t0 = todayDay * 86_400_000;
  const points: ForecastPoint[] = [{ t: t0, lo: traj.lo, central: traj.central, hi: traj.hi }];

  for (let w = 0; w < horizon; w++) {
    const weekStartDay = mondayDay + w * 7;
    const tss = known.get(weekStartDay) ?? ctl * 7 * C.TSS_FALLBACK_MULT;
    const ctlNext = ctl + (tss / 7 - ctl) * K7;
    const dctl = ctlNext - ctl;
    ctl = ctlNext;

    // HONESTY: tydzień w oknie taperu → ramp 0 (pas płaski przed startem — plan, nie regres).
    const ramp = weekInTaper(weekStartDay, inputs.races)
      ? 0
      : Math.min(Math.max(dctl / C.RAMP_REF, 0), C.RAMP_MAX);

    traj.lo += g * C.LO_FACTOR * headroom(traj.lo, inputs.massKg) * ramp;
    traj.central += g * headroom(traj.central, inputs.massKg) * ramp;
    traj.hi += g * C.HI_FACTOR * headroom(traj.hi, inputs.massKg) * ramp;

    points.push({
      t: t0 + (w + 1) * WEEK_MS,
      lo: Math.round(traj.lo),
      central: Math.round(traj.central),
      hi: Math.round(traj.hi),
    });
  }

  return { points, g, gSource: cal.gSource, calibrationWeeks: cal.weeks };
}
