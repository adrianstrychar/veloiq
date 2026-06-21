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
  freshPct: number;    // świeżość: clamp((tsb+30)/55*100)
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
  const freshPct = clamp(((now.tsb + 30) / 55) * 100, 0, 100);
  const raceReady = Math.round(fitnessPct * 0.55 + freshPct * 0.45);

  // ctl sprzed 7 dni (7 pozycji wstecz; fallback do najstarszego wiersza)
  const prev = rows[Math.max(0, rows.length - 8)];
  const ctlRamp = +(now.ctl - prev.ctl).toFixed(1);

  let state: string;
  let color: Readiness['color'];
  let advice: string;
  // Teksty 1:1 z mockupu (docs/veloiq-mockup.jsx, computeReadiness 270-273).
  if (now.tsb > 15) {
    state = 'Wypoczęty';
    color = 'green';
    advice = 'Nogi świeże i pełne energii. Świetny dzień na mocniejszy trening.';
  } else if (now.tsb >= 5) {
    state = 'Gotowy';
    color = 'green';
    advice = 'Forma w równowadze — możesz spokojnie realizować plan.';
  } else if (now.tsb >= -10) {
    state = 'Lekko zmęczony';
    color = 'yellow';
    advice = 'Nogi trochę zmęczone po treningach — to normalne, tak rośnie forma. Zadbaj o sen.';
  } else {
    state = 'Mocno zmęczony';
    color = 'red';
    advice = 'Duże zmęczenie. Lepiej dziś odpocząć albo pojechać lekko, zanim przesadzisz.';
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
