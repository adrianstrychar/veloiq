// Gotowość (race-readiness): PMC (CTL/ATL/TSB) — forma + świeżość. Z WHOOP dochodzi trzecia
// składowa: poranna regeneracja (HRV, tętno spoczynkowe, sen). Bez WHOOP – jak dotąd, tylko PMC.
// Odwzorowanie computeReadiness() z mockupu veloiq-app.jsx.

export interface MetricRow {
  date: string; // 'YYYY-MM-DD'
  ctl: number;
  atl: number;
  tsb: number;
}

export interface Readiness {
  raceReady: number;   // 0–100, główny wskaźnik (pierścień)
  fitnessPct: number;  // forma: ctl_teraz / szczyt_sezonu * 100
  freshPct: number;    // świeżość: clamp((tsb+30)/45*100) — kotwice TSB −30→0%, +15→100%
  state: string;       // werdykt PL
  color: 'green' | 'yellow' | 'red';
  advice: string;      // rada PL wg progów TSB
  ctlRamp: number;     // ctl teraz − ctl sprzed 7 dni
  nowCtl: number;
  peakCtl: number;
  nowTsb: number;
  /** Regeneracja WHOOP dziś (0–100) – tylko gdy jest połączony WHOOP i dzisiejszy wynik. */
  recoveryPct: number | null;
}

/** Dane z WHOOP wpływające na gotowość (dzisiejszy poranek). */
export interface ReadinessWhoop {
  recovery: number | null;
  hrvLow?: boolean;
  sleepShort?: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// rows: pełna historia, posortowana rosnąco po dacie. Ostatni wiersz = "teraz".
export function computeReadiness(rows: MetricRow[], whoop?: ReadinessWhoop | null): Readiness | null {
  if (!rows.length) return null;

  const now = rows[rows.length - 1];
  const peakCtl = rows.reduce((mx, r) => Math.max(mx, r.ctl), 0);

  const fitnessPct = peakCtl > 0 ? clamp((now.ctl / peakCtl) * 100, 0, 100) : 0;
  const freshPct = clamp(((now.tsb + 30) / 45) * 100, 0, 100);
  const rec = whoop?.recovery != null ? clamp(whoop.recovery, 0, 100) : null;
  // z WHOOP: forma 40 % + świeżość 25 % + regeneracja 35 %; bez WHOOP: forma 55 % + świeżość 45 %
  let raceReady = rec != null
    ? Math.round(fitnessPct * 0.4 + freshPct * 0.25 + rec * 0.35)
    : Math.round(fitnessPct * 0.55 + freshPct * 0.45);
  // czerwona regeneracja WHOOP: pierścień nie może pokazywać „dobrej” gotowości (maks. 55 %)
  if (rec != null && rec < 34) raceReady = Math.min(raceReady, 55);

  // ctl sprzed 7 dni (7 pozycji wstecz; fallback do najstarszego wiersza)
  const prev = rows[Math.max(0, rows.length - 8)];
  const ctlRamp = +(now.ctl - prev.ctl).toFixed(1);

  let state: string;
  let color: Readiness['color'];
  let advice: string;
  // Kolor/etykieta z WYŚWIETLANEGO raceReady% (nie z surowych pasm TSB) — koniec
  // sytuacji "63% na czerwono", gdzie liczba i kolor czytały z różnych wejść.
  // ŚWIADOMY PRÓG OSTRZEGAWCZY (nie upraszczać): TSB < −30 = realne przetrenowanie,
  // ZAWSZE czerwony, niezależnie od raceReady% — bo wysoka forma (CTL/peak) potrafi
  // sztucznie podbić raceReady i ukryć głębokie zmęczenie. Override musi zostać.
  if (now.tsb < -30) {
    color = 'red';
    state = 'Głębokie zmęczenie';
    advice = 'Głębokie zmęczenie — odpuść dziś. Odpoczynek albo bardzo lekka jazda.';
  } else if (raceReady >= 67) {
    color = 'green';
    state = now.tsb > 15 ? 'Wypoczęty' : 'Dobra gotowość';
    advice = now.tsb > 15
      ? 'Nogi świeże i pełne energii. Świetny dzień na mocniejszy trening.'
      : 'Dobra gotowość — możesz spokojnie realizować plan.';
  } else if (raceReady >= 40) {
    color = 'yellow';
    state = 'Umiarkowana gotowość';
    advice = 'Forma w budowie — lekki trening OK, tak rośnie forma. Zadbaj o sen.';
  } else {
    color = 'red';
    state = 'Niska gotowość';
    advice = 'Niska gotowość — lepiej dziś odpocząć albo pojechać bardzo lekko.';
  }

  // WHOOP: czerwona regeneracja (< 34 %) to sygnał organizmu, którego PMC nie widzi (sen, stres,
  // infekcja) → nigdy zielono; zielona regeneracja przy zmęczeniu z PMC nie „odblokowuje” docisku.
  if (rec != null && now.tsb >= -30) {
    const why = whoop?.hrvLow && whoop?.sleepShort ? 'niskie HRV i krótki sen'
      : whoop?.hrvLow ? 'HRV niżej niż zwykle'
        : whoop?.sleepShort ? 'za mało snu' : 'organizm jeszcze się regeneruje';
    if (rec < 34) {
      color = raceReady < 40 ? 'red' : color === 'green' ? 'yellow' : color;
      state = 'Słaba regeneracja';
      advice = `WHOOP: słaba regeneracja (${why}). Dziś lżej — spokojna jazda w strefie 1–2 albo odpoczynek.`;
    } else if (rec < 67 && color === 'green') {
      advice = `Dobra gotowość, ale regeneracja WHOOP średnia (${why}) — plan tak, bez dokładania.`;
    } else if (rec >= 67 && color === 'yellow') {
      advice = 'Regeneracja WHOOP dobra — organizm gotowy, forma jeszcze w budowie. Realizuj plan.';
    }
  }

  return {
    raceReady,
    fitnessPct: Math.round(fitnessPct),
    freshPct: Math.round(freshPct),
    state,
    color,
    advice,
    ctlRamp,
    nowCtl: now.ctl,
    peakCtl,
    nowTsb: now.tsb,
    recoveryPct: rec != null ? Math.round(rec) : null,
  };
}
