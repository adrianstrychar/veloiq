// Gotowość (race-readiness) liczona WYŁĄCZNIE z PMC (CTL/ATL/TSB) — zero danych WHOOP.
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
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// rows: pełna historia, posortowana rosnąco po dacie. Ostatni wiersz = "teraz".
export function computeReadiness(rows: MetricRow[]): Readiness | null {
  if (!rows.length) return null;

  const now = rows[rows.length - 1];
  const peakCtl = rows.reduce((mx, r) => Math.max(mx, r.ctl), 0);

  const fitnessPct = peakCtl > 0 ? clamp((now.ctl / peakCtl) * 100, 0, 100) : 0;
  const freshPct = clamp(((now.tsb + 30) / 45) * 100, 0, 100);
  const raceReady = Math.round(fitnessPct * 0.55 + freshPct * 0.45);

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
  };
}
