// Prognoza FTP PERIODYZOWANA (redesign) — deterministyczna, bez dipów. Fazy wyprowadzone z
// race_calendar + taperDaysFor: BUILD (pełne tempo), TAPER (ułamek tempa — objętość ścięta, ostrość
// utrzymana, na końcu tygodnia start), REGEN (ułamek tempa — superkompensacja po starcie). Fazy
// SPOWALNIAJĄ wzrost, nie zatrzymują go: zerowanie kosztowało ~2 tygodnie na każdy start i przy
// gęstym kalendarzu dawało +2 W na kwartał niezależnie od jakości treningu. Tempo buildu = nachylenie envelope
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
  DEFAULT_RATE_WPW: 0.6,  // W/tydz build gdy BRAK historii do kalibracji (nowy user)
  // Podłoga tempa dla zawodnika Z historią, u którego pomiar wyszedł 0. Prognoza jest WARUNKOWA
  // ("przy realizacji planu"), więc zero na stałe byłoby sprzeczne z jej własnym założeniem —
  // ale plateau to realny sygnał, więc podłoga jest NIŻSZA niż default nowego usera.
  MIN_RATE_WPW: 0.25,
  // Sufit tempa — zabezpieczenie przed ekstrapolacją jednorazowego skoku envelope (np. pierwszy
  // pomiar mocą po latach na HR) na kwartały do przodu.
  MAX_RATE_WPW: 1.5,
  RATE_SHORT_WEEKS: 6,    // okno "co robię teraz"
  RATE_LONG_WEEKS: 16,    // okno "co udowodniłem w sezonie" — przeżywa blok startowy i taper
  // Ile z tempa buildu zostaje w tygodniu taperu i w tygodniu po starcie. NIE ZERO — patrz
  // uzasadnienie przy pętli w forecastFtpPeriodized. Suma ≈ 1.0 → blok startowy (taper + regen)
  // wart jest mniej więcej JEDEN tydzień buildu, a nie zero i nie dwa.
  TAPER_BUILD_FRAC: 0.35, // objętość w dół, ale ostrość utrzymana, a sam start to maksymalny bodziec
  REGEN_BUILD_FRAC: 0.65, // superkompensacja — tu adaptacja z wyścigu się realizuje
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
  // ROZRÓŻNIENIE null vs 0: null = brak historii → default nowego usera. 0 = ZMIERZONE plateau →
  // podłoga MIN_RATE_WPW. Poprzednio oba wpadały w ten sam warunek `> 0` i zmierzone plateau po cichu
  // stawało się tempem nowego usera (0.6) — pomiar był podmieniany na założenie, bez śladu.
  const rate = inp.buildRatePerWeek == null
    ? C.DEFAULT_RATE_WPW
    : Math.min(C.MAX_RATE_WPW, Math.max(C.MIN_RATE_WPW, inp.buildRatePerWeek));
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

  // TAPER i REGEN NIE są zerem. Poprzednio rosły wyłącznie tygodnie BUILD, więc każdy start
  // kosztował ~2 tygodnie zerowego postępu (tydzień taperu + tydzień regeneracji), a przy gęstym
  // kalendarzu zostawało 15% tygodni budujących i prognoza pokazywała +2 W na kwartał NIEZALEŻNIE
  // od tego, jak dobrze zawodnik trenuje. To była też WEWNĘTRZNA SPRZECZNOŚĆ aplikacji:
  // rekonstrukcja (lib/ftp-reconstruct) liczy FTP z best_efforts KAŻDEJ jazdy, więc wyścig może
  // ustanowić nowy rekord i podnieść zmierzone FTP — a prognoza w tym samym tygodniu zakładała
  // zerowy postęp. Jedna warstwa uznaje start za dowód formy, druga za stracony czas.
  // Fizjologicznie: tydzień taperu ma ściętą objętość, ale utrzymaną ostrość, a na jego końcu stoi
  // wyścig — najmocniejszy bodziec progowy w całym bloku. Tydzień po starcie to superkompensacja.
  const fracOf = (phase: Phase) =>
    phase === 'BUILD' ? 1 : phase === 'TAPER' ? C.TAPER_BUILD_FRAC : C.REGEN_BUILD_FRAC;

  const points: ForecastPoint[] = [{ t: todayMs, ftp: inp.ftpNow, phase: phaseOf(todayMs) }];
  let ftp = inp.ftpNow;
  for (let ws = todayMs; ws <= horizonEnd; ws += 7 * DAY) {
    const phase = phaseOf(ws);
    ftp += fracOf(phase) * g * headroom(ftp, massKg);
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

// Nachylenie envelope w oknie ostatnich `weeks` TYGODNI (tylko wzrost; plateau/spadek → 0).
// Okno liczone po DATACH, nie po indeksach tablicy: poprzednio `weeks` było używane jako liczba
// PUNKTÓW, co jest tym samym tylko dopóki rekonstrukcja emituje dokładnie jeden punkt na tydzień.
// Ukryte sprzężenie z cadencją innego modułu — okno po datach jest odporne na jej zmianę.
function slopeOverWindow(envelope: { date: string; ftp: number }[], weeks: number): number | null {
  const b = envelope[envelope.length - 1];
  const cutoff = dayMs(b.date) - weeks * 7 * DAY;
  const a = envelope.find((p) => dayMs(p.date) >= cutoff);
  if (!a || a === b) return null;
  const dWeeks = (dayMs(b.date) - dayMs(a.date)) / (7 * DAY);
  if (dWeeks <= 0) return null;
  return Math.max(0, (b.ftp - a.ftp) / dWeeks);
}

/**
 * Tempo buildu z envelope rekonstrukcji — MOCNIEJSZE z dwóch okien: krótkiego ("co robię teraz")
 * i długiego ("co udowodniłem w sezonie"). null tylko przy braku historii.
 *
 * DLACZEGO MAX, A NIE SAMO KRÓTKIE OKNO: envelope to seria REKORDOWA (narastające maksimum
 * odtworzonego FTP), więc jej płaski odcinek NIE znaczy "utrata formy", tylko "nie padł nowy
 * rekord". W bloku startowym zawodnik ściga się i taperuje zamiast testować — envelope stoi,
 * choć zdolność do budowania nie zniknęła. Mierzenie tempa wyłącznie na ostatnich 6 punktach
 * systematycznie zaniżało je do zera u każdego, kto właśnie miał starty, a zero spadało do
 * defaultu nowego usera. Długie okno przeżywa blok startowy i pokazuje realną trajektorię sezonu.
 */
export function buildRateFromEnvelope(
  envelope: { date: string; ftp: number }[],
  shortWeeks = FORECAST_CONFIG.RATE_SHORT_WEEKS,
  longWeeks = FORECAST_CONFIG.RATE_LONG_WEEKS
): number | null {
  if (envelope.length < 3) return null;
  const s = slopeOverWindow(envelope, shortWeeks);
  const l = slopeOverWindow(envelope, longWeeks);
  if (s == null && l == null) return null;
  return Math.max(s ?? 0, l ?? 0);
}
