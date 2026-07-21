// Statystyki rozwoju liczone ze strava_activities (sezon = rok kalendarzowy).
// Kolumny realne: activity_date (date), distance_km (decimal), name (text).

export interface ActivityStatRow {
  activity_date: string; // 'YYYY-MM-DD'
  distance_km: number | null;
  name: string | null;
  duration_seconds?: number | null; // do sumy godzin sezonu (footer "Twój silnik")
  elevation_m?: number | null;      // do sumy przewyższenia sezonu
}

export interface ProgressStats {
  streakWeeks: number;
  longestKm: number;
  longestName: string | null;
  totalKm: number;
  totalHours: number;      // suma czasu sezonu w godzinach (footer)
  totalElevationM: number; // suma przewyższenia sezonu w metrach (footer)
  rideCount: number;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Klucz tygodnia = data poniedziałku tego tygodnia (Pn-based).
function mondayKey(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = poniedziałek
  d.setDate(d.getDate() - dow);
  return ymd(d);
}

export function computeProgressStats(rows: ActivityStatRow[], today: Date = new Date()): ProgressStats {
  // Streak: kolejne tygodnie wstecz z ≥1 jazdą.
  const weeks = new Set<string>();
  for (const r of rows) {
    weeks.add(mondayKey(new Date(r.activity_date + 'T00:00:00')));
  }

  let cursor = new Date(today);
  // Grace: jeśli bieżący tydzień jeszcze bez jazdy, zacznij od poprzedniego.
  if (!weeks.has(mondayKey(cursor))) cursor.setDate(cursor.getDate() - 7);
  let streakWeeks = 0;
  while (weeks.has(mondayKey(cursor))) {
    streakWeeks++;
    cursor.setDate(cursor.getDate() - 7);
  }

  // Najdłuższa jazda + suma km/godzin/przewyższenia.
  let longestKm = 0;
  let longestName: string | null = null;
  let totalKm = 0;
  let totalSeconds = 0;
  let totalElevationM = 0;
  for (const r of rows) {
    const km = r.distance_km ?? 0;
    totalKm += km;
    totalSeconds += r.duration_seconds ?? 0;
    totalElevationM += r.elevation_m ?? 0;
    if (km > longestKm) {
      longestKm = km;
      longestName = r.name;
    }
  }

  return {
    streakWeeks,
    longestKm: Math.round(longestKm),
    longestName,
    totalKm: Math.round(totalKm),
    totalHours: Math.round(totalSeconds / 3600),
    totalElevationM: Math.round(totalElevationM),
    rideCount: rows.length,
  };
}
