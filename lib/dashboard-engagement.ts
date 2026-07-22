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
export interface PowerRecord { dur: PowerDuration; watts: number | null; date: string | null; isNew: boolean }

// Dla każdej duracji: max sezonu + data jazdy trzymającej rekord. isNew = ta jazda w ostatnich `newDays`.
export function computePowerRecords(rows: PowerRideRow[], today: Date, newDays = 7): PowerRecord[] {
  const from = `${today.getFullYear()}-01-01`;
  const to = iso(today);
  const newFrom = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - newDays));
  const inSeason = rows.filter((r) => r.date >= from && r.date <= to && r.best_efforts);
  return POWER_DURATIONS.map((dur) => {
    let watts: number | null = null;
    let date: string | null = null;
    for (const r of inSeason) {
      const w = r.best_efforts?.[dur];
      if (w != null && (watts == null || w > watts)) { watts = w; date = r.date; }
    }
    return { dur, watts, date, isNew: date != null && date >= newFrom };
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
