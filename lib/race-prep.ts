// Przygotowanie do startu (karta "NAJBLIŻSZY CEL"). Czysta logika, testowalna bez React.
// race-taper daje FAZĘ (taperDaysFor) i cel TSB, ale NIE target CTL — target liczymy tu.
import { taperDaysFor, type RacePriority } from '@/lib/race-taper';
import { C } from '@/lib/theme';

export interface CtlPoint { date: string; ctl: number } // date 'YYYY-MM-DD', rosnąco
export type RacePhase = 'Budowanie' | 'Peak' | 'Taper';

export interface RacePrep {
  daysOut: number;
  startCtl: number;   // CTL na starcie bloku (raceDate − 35 dni)
  targetCtl: number;  // cel formy na dzień startu (override lub default ≈ szczyt sezonu)
  nowCtl: number;
  peakCtl: number;    // max CTL w bloku = wartość "zamrożona" na taper
  prep: number;       // 0–100, droga od startCtl do targetCtl
  phase: RacePhase;
  phaseColor: string;
  blockPos: number;   // 0–100, pozycja markera TERAZ na osi bloku
}

const BLOCK_WINDOW_DAYS = 35;
const PEAK_WINDOW_DAYS = 7;

// 'YYYY-MM-DD' → numer dnia (UTC, bez wpływu strefy).
function dayNum(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function computeRacePrep(input: {
  ctlSeries: CtlPoint[];
  raceDate: string;
  priority: RacePriority;
  targetOverride?: number | null;
  today: string;
}): RacePrep | null {
  const { ctlSeries, raceDate, priority, targetOverride, today } = input;
  if (!ctlSeries.length) return null;

  const raceD = dayNum(raceDate);
  const todayD = dayNum(today);
  const daysOut = raceD - todayD;

  const nowCtl = ctlSeries[ctlSeries.length - 1].ctl;
  const seasonPeak = ctlSeries.reduce((mx, p) => Math.max(mx, p.ctl), 0);

  // startCtl = CTL na (raceDate − 35 dni): ostatni punkt o dacie ≤ progu; brak → najstarszy.
  const blockStartD = raceD - BLOCK_WINDOW_DAYS;
  let startCtl = ctlSeries[0].ctl;
  for (const p of ctlSeries) { if (dayNum(p.date) <= blockStartD) startCtl = p.ctl; else break; }

  // TAPER-FREEZE: licznik postępu = MAX CTL osiągnięte w bloku [blockStart..today], nie samo now.
  // CTL celowo spada w taperze (to plan) — pierścień nie może karać za zaplanowany spadek.
  // Idealne wykonanie = 100% (ta sama zasada co pierścień realizacji). W budowaniu max≈now.
  let peakCtl = nowCtl;
  for (const p of ctlSeries) {
    const d = dayNum(p.date);
    if (d >= blockStartD && d <= todayD) peakCtl = Math.max(peakCtl, p.ctl);
  }
  const progressCtl = Math.max(nowCtl, peakCtl);

  const targetCtl = targetOverride != null ? Math.round(targetOverride) : Math.round(Math.max(seasonPeak, nowCtl));

  const prep = targetCtl > startCtl
    ? Math.round(Math.min(100, Math.max(0, ((progressCtl - startCtl) / (targetCtl - startCtl)) * 100)))
    : 100; // brak przestrzeni wzrostu (target ≤ start) → jesteś na miejscu

  // Faza z race-taper: Taper = w oknie taperDaysFor; Peak = 7 dni przed oknem; wcześniej Budowanie.
  const taperDays = taperDaysFor(priority);
  let phase: RacePhase;
  let phaseColor: string;
  if (daysOut <= taperDays) { phase = 'Taper'; phaseColor = C.green; }
  else if (daysOut <= taperDays + PEAK_WINDOW_DAYS) { phase = 'Peak'; phaseColor = C.yellow; }
  else { phase = 'Budowanie'; phaseColor = C.cyan; }

  const blockPos = Math.round(Math.min(100, Math.max(0, ((BLOCK_WINDOW_DAYS - daysOut) / BLOCK_WINDOW_DAYS) * 100)));

  return {
    daysOut,
    startCtl: Math.round(startCtl),
    targetCtl,
    nowCtl: Math.round(nowCtl),
    peakCtl: Math.round(peakCtl),
    prep,
    phase,
    phaseColor,
    blockPos,
  };
}
