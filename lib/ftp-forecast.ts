// Prognoza FTP PERIODYZOWANA (redesign) — deterministyczna, bez dipów. Fazy wyprowadzone z
// race_calendar + taperDaysFor: BUILD (wzrost wg skalibrowanego tempa × headroom), TAPER (plateau
// w oknie taperu), REGEN (plateau ~7 dni po starcie). Tempo buildu = nachylenie envelope
// rekonstrukcji przy dzisiejszym W/kg → real i prognoza mają to samo tempo w porównywalnych fazach.
// Milestone'y ADAPTACYJNE: starty z kalendarza jeśli są; inaczej progi W/kg (WKG_LEVELS) powyżej
// obecnego + koniec horyzontu. Liczone w locie (zero migracji).
import { taperDaysFor, type RacePriority } from '@/lib/race-taper';
import { nextWkgLevel, WKG_LEVELS } from '@/lib/level';

export interface RaceLite { name: string; date: string; priority: RacePriority }
export type Phase = 'BUILD' | 'TAPER' | 'REGEN';
export interface ForecastPoint { t: number; ftp: number; phase: Phase }
export interface Milestone { t: number; label: string; ftp: number; kind: 'race' | 'level' }
export interface Forecast { points: ForecastPoint[]; milestones: Milestone[]; buildRatePerWeek: number }

export const FORECAST_CONFIG = {
  WKG_CEIL: 5.9,
  WKG_FLOOR: 2.0,
  REGEN_DAYS: 7,          // plateau regeneracji po starcie
  HORIZON_DAYS: 365,      // brak startów → horyzont roczny (cel poziomowy bywa >4 mies. przy wolnym buildzie)
  DEFAULT_RATE_WPW: 0.6,  // W/tydz build gdy brak historii do kalibracji (nowy user)
  MASSLESS_HEADROOM: 0.4, // brak wagi → stały headroom (nie zgadujemy sufitu)
  BAND_LOWER_FRAC: 0.35,  // dolna krawędź pasma = ostrożny wzrost (frakcja projektowanego wzrostu środka)
  BAND_UPPER_FRAC: 1.75,  // górna = optymistyczny wzrost (frakcja), przycięty do sufitu W/kg
} as const;

const DAY = 86_400_000;
function dayMs(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function headroom(ftp: number, massKg: number | null): number {
  const { WKG_CEIL, WKG_FLOOR, MASSLESS_HEADROOM } = FORECAST_CONFIG;
  if (massKg == null || massKg <= 0) return MASSLESS_HEADROOM;
  return Math.max(0, (WKG_CEIL - ftp / massKg) / (WKG_CEIL - WKG_FLOOR));
}

export interface ForecastInputs {
  ftpNow: number;
  massKg: number | null;
  today: string;
  buildRatePerWeek: number | null; // z envelope rekonstrukcji; null → DEFAULT (nowy user)
  races: RaceLite[];               // nadchodzące starty (date >= today) — mogą być puste
  horizonDays?: number;
}

export function forecastFtpPeriodized(inp: ForecastInputs): Forecast {
  const C = FORECAST_CONFIG;
  const massKg = inp.massKg;
  const todayMs = dayMs(inp.today);
  const upcoming = [...inp.races].filter((r) => dayMs(r.date) >= todayMs).sort((a, b) => dayMs(a.date) - dayMs(b.date));

  // G tak dobrane, że build przy dzisiejszym W/kg = buildRatePerWeek (envelope-recent); dalej maleje z headroom.
  const rate = inp.buildRatePerWeek != null && inp.buildRatePerWeek > 0 ? inp.buildRatePerWeek : C.DEFAULT_RATE_WPW;
  const g = rate / Math.max(0.05, headroom(inp.ftpNow, massKg));

  // Horyzont: ostatni start (+regen) jeśli są; inaczej dziś + HORIZON_DAYS (do progów poziomowych).
  const horizonEnd = upcoming.length
    ? dayMs(upcoming[upcoming.length - 1].date) + C.REGEN_DAYS * DAY
    : todayMs + (inp.horizonDays ?? C.HORIZON_DAYS) * DAY;

  const phaseOf = (ws: number): Phase => {
    for (const r of upcoming) {
      const rd = dayMs(r.date);
      if (ws <= rd && ws + 6 * DAY >= rd - taperDaysFor(r.priority) * DAY) return 'TAPER';
      if (ws <= rd + C.REGEN_DAYS * DAY && ws + 6 * DAY >= rd + DAY) return 'REGEN';
    }
    return 'BUILD';
  };

  const points: ForecastPoint[] = [{ t: todayMs, ftp: inp.ftpNow, phase: phaseOf(todayMs) }];
  let ftp = inp.ftpNow;
  for (let ws = todayMs; ws <= horizonEnd; ws += 7 * DAY) {
    const phase = phaseOf(ws);
    if (phase === 'BUILD') ftp += g * headroom(ftp, massKg);
    points.push({ t: ws + 7 * DAY, ftp: Math.round(ftp), phase });
  }

  // Milestone'y adaptacyjne.
  const milestones: Milestone[] = [];
  const ftpAt = (t: number) => {
    let best = points[0];
    for (const p of points) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    return best.ftp;
  };
  if (upcoming.length) {
    for (const r of upcoming) {
      const t = dayMs(r.date);
      milestones.push({ t, label: r.name, ftp: ftpAt(t), kind: 'race' });
    }
  } else if (massKg && massKg > 0) {
    // Bez startów: progi W/kg powyżej obecnego — data przekroczenia w prognozie.
    const startWkg = inp.ftpNow / massKg;
    for (const lv of WKG_LEVELS) {
      if (lv.wkg <= startWkg) continue;
      const hit = points.find((p) => p.ftp / massKg >= lv.wkg);
      if (hit) milestones.push({ t: hit.t, label: lv.name, ftp: Math.round(lv.wkg * massKg), kind: 'level' });
    }
    void nextWkgLevel; // (nextWkgLevel dostępne dla UI; tu iterujemy pełną tablicę)
  }

  return { points, milestones, buildRatePerWeek: rate };
}

// Pasmo prognozy jako FRAKCJE skumulowanego wzrostu środka od dziś (anchor = wartość "dziś", węzeł
// styku real↔forecast). REGUŁA PRODUKTOWA: prognoza ZAKŁADA trzymanie planu, więc pasmo pokazuje
// "od małego wzrostu do dużego wzrostu", nie "od spadku do wzrostu" — to nie neutralna statystyka.
// - dolna = anchor + BAND_LOWER_FRAC × wzrost środka → zawsze ≥ start i rosnąca w BUILD (frakcja
//   nieujemnego, rosnącego wzrostu); najgorszy scenariusz przy trzymaniu planu = mały wzrost.
// - górna = anchor + BAND_UPPER_FRAC × wzrost, PRZYCIĘTA do sufitu W/kg (WKG_CEIL × masa) — ambitna,
//   ale nie fantazja: to wielokrotność WŁASNEGO tempa zawodnika i nie przekracza fizjologicznego
//   sufitu (tego samego, którym forecast tłumi środek). Bez wagi → brak sufitu (tryb massless).
// Względne (frakcje), więc skaluje się z każdym poziomem FTP; nie hardkodowane pod konkretne waty.
export function forecastBand(
  centerMonthly: { t: number; fc: number }[],
  anchor: number,
  massKg: number | null
): { t: number; fc: number; band: [number, number] }[] {
  const { BAND_LOWER_FRAC, BAND_UPPER_FRAC, WKG_CEIL } = FORECAST_CONFIG;
  const ceilFtp = massKg != null && massKg > 0 ? WKG_CEIL * massKg : Infinity;
  return centerMonthly.map((p) => {
    const gain = Math.max(0, p.fc - anchor); // skumulowany wzrost środka od dziś (≥0 — prognoza nie schodzi)
    const lo = anchor + BAND_LOWER_FRAC * gain;
    const hi = Math.max(lo, Math.min(anchor + BAND_UPPER_FRAC * gain, ceilFtp)); // hi≥lo (guard nad-sufitowego FTP)
    return { t: p.t, fc: p.fc, band: [Math.round(lo), Math.round(hi)] as [number, number] };
  });
}

// Tempo buildu z envelope rekonstrukcji: nachylenie ostatnich `weeks` punktów envelope (tylko wzrost;
// plateau/spadek → 0, bo to nie tempo buildu). null gdy za mało punktów.
export function buildRateFromEnvelope(envelope: { date: string; ftp: number }[], weeks = 6): number | null {
  if (envelope.length < 3) return null;
  const n = Math.min(weeks, envelope.length - 1);
  const a = envelope[envelope.length - 1 - n];
  const b = envelope[envelope.length - 1];
  const dWeeks = (dayMs(b.date) - dayMs(a.date)) / (7 * DAY);
  if (dWeeks <= 0) return null;
  return Math.max(0, (b.ftp - a.ftp) / dWeeks);
}
