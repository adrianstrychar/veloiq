// Czyste helpery modułów zaangażowania dashboardu (ETAP 3.5) — bez Reacta, testowalne jiti.
// Trzy niezależne obliczenia: rekordy per okres, rekordy mocy sezonu, status celu sezonu.

// ── Okresy (po dacie lokalnej activity: start_date_local) ─────────────────────
export type Period = 'week' | 'month' | 'season';

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Początek okresu (inclusive) względem `today`: tydzień = poniedziałek, miesiąc = 1., sezon = 1 stycznia.
export function periodStart(period: Period, today: Date): string {
  if (period === 'season') return `${today.getFullYear()}-01-01`;
  if (period === 'month') return iso(new Date(today.getFullYear(), today.getMonth(), 1));
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = poniedziałek
  d.setDate(d.getDate() - dow);
  return iso(d);
}

// ── Rekordy dystansu / przewyższenia / czasu w ruchu ──────────────────────────
export interface RideStatRow {
  date: string;                    // 'YYYY-MM-DD' (start_date_local)
  distance_km: number | null;
  elevation_m: number | null;
  duration_seconds: number | null;
}
export interface RecordCell { value: number; date: string | null }
export interface PeriodRecords {
  longestKm: RecordCell;
  biggestElevM: RecordCell;
  longestMovingSec: RecordCell;
}

// Max każdej metryki w oknie [periodStart, today] + data jazdy, która go trzyma. Brak jazd → value 0.
export function computeRecords(rows: RideStatRow[], period: Period, today: Date): PeriodRecords {
  const from = periodStart(period, today);
  const to = iso(today);
  const inWin = rows.filter((r) => r.date >= from && r.date <= to);
  const pick = (val: (r: RideStatRow) => number): RecordCell => {
    let best: RecordCell = { value: 0, date: null };
    for (const r of inWin) {
      const v = val(r);
      if (v > best.value) best = { value: v, date: r.date };
    }
    return best;
  };
  return {
    longestKm: pick((r) => r.distance_km ?? 0),
    biggestElevM: pick((r) => r.elevation_m ?? 0),
    longestMovingSec: pick((r) => r.duration_seconds ?? 0),
  };
}

// ── Rekordy mocy sezonu (best_efforts per aktywność) ──────────────────────────
export const POWER_DURATIONS = ['5s', '1min', '5min', '20min'] as const;
export type PowerDuration = (typeof POWER_DURATIONS)[number];
export interface PowerRideRow { date: string; best_efforts: Record<string, number | null> | null }
// Najlepsza moc każdej duracji w oknie każdego okresu (koniec = today). null = brak danych w okresie.
// seasonDate = data jazdy trzymającej rekord sezonu; recordIn* = czy rekord sezonu PADŁ w oknie okresu
// (data rekordu ∈ [start, today]) — steruje zielonym wyróżnieniem w kaflu (nie samo równe wartości).
export interface PowerPeriodRecord {
  dur: PowerDuration;
  week: number | null;
  month: number | null;
  season: number | null;
  seasonDate: string | null;
  recordInWeek: boolean;
  recordInMonth: boolean;
}

// Okna okresów są niezależne, ale wszystkie kończą się na `today` i mieszczą w sezonie → season zawsze ≥
// week/month. Zieleń "rekord sezonu" pokazujemy TYLKO gdy jazda-rekordzistka ma datę w oknie okresu
// (recordInWeek/Month), a nie gdy wartość okresu = rekord (te mogą się zrównać przy identycznych jazdach).
export function computePowerByPeriod(rows: PowerRideRow[], today: Date): PowerPeriodRecord[] {
  const to = iso(today);
  const starts: Record<Period, string> = {
    week: periodStart('week', today),
    month: periodStart('month', today),
    season: periodStart('season', today),
  };
  const bestIn = (dur: PowerDuration, from: string): number | null => {
    let best: number | null = null;
    for (const r of rows) {
      if (!r.best_efforts || r.date < from || r.date > to) continue;
      const w = r.best_efforts[dur];
      if (w != null && (best == null || w > best)) best = w;
    }
    return best;
  };
  // Najwcześniejsza data osiągająca rekord sezonu (remis → pierwsza jazda, kiedy rekord "padł").
  const seasonRecordDate = (dur: PowerDuration, seasonBest: number | null): string | null => {
    if (seasonBest == null) return null;
    let date: string | null = null;
    for (const r of rows) {
      if (!r.best_efforts || r.date < starts.season || r.date > to) continue;
      if (r.best_efforts[dur] === seasonBest && (date == null || r.date < date)) date = r.date;
    }
    return date;
  };
  return POWER_DURATIONS.map((dur) => {
    const season = bestIn(dur, starts.season);
    const seasonDate = seasonRecordDate(dur, season);
    return {
      dur,
      week: bestIn(dur, starts.week),
      month: bestIn(dur, starts.month),
      season,
      seasonDate,
      recordInWeek: seasonDate != null && seasonDate >= starts.week,   // seasonDate ≤ today z definicji
      recordInMonth: seasonDate != null && seasonDate >= starts.month,
    };
  });
}

// ── Cel sezonu (km) ───────────────────────────────────────────────────────────
export interface GoalStatus {
  kmYtd: number;
  goalKm: number;
  pct: number;             // 0..100 (może >100)
  tickPct: number;         // pozycja pionowego znacznika "dziś wg planu" 0..100
  aheadKm: number;         // + przed planem / − za planem
  projectedDate: string | null; // ISO daty osiągnięcia celu przy obecnym tempie, null gdy brak km
}

// Znacznik = (dzień roku / dni w roku) × cel. Prognoza daty = cel / (km/dzień od 1 stycznia).
export function computeGoal(kmYtd: number, goalKm: number, today: Date): GoalStatus {
  const jan1 = new Date(today.getFullYear(), 0, 1);
  const daysInYear = ((today.getFullYear() % 4 === 0 && today.getFullYear() % 100 !== 0) || today.getFullYear() % 400 === 0) ? 366 : 365;
  const daysElapsed = Math.max(1, Math.round((today.getTime() - jan1.getTime()) / 86_400_000) + 1);
  const tickPct = Math.min(100, (daysElapsed / daysInYear) * 100);
  const expectedByToday = goalKm * (daysElapsed / daysInYear);
  const aheadKm = Math.round(kmYtd - expectedByToday);
  const pct = goalKm > 0 ? (kmYtd / goalKm) * 100 : 0;
  let projectedDate: string | null = null;
  if (kmYtd > 0) {
    const perDay = kmYtd / daysElapsed;
    const daysToGoal = goalKm / perDay;
    projectedDate = iso(new Date(jan1.getTime() + Math.round(daysToGoal) * 86_400_000));
  }
  return { kmYtd, goalKm, pct, tickPct, aheadKm, projectedDate };
}
