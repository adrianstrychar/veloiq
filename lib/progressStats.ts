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
  streakWeeks: number;     // streak → nagłówek karty "Ten tydzień"
  totalKm: number;         // suma km sezonu (fallback celu, gdy brak ytd_ride_km)
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

  // Suma km sezonu (fallback celu, gdy brak ytd_ride_km ze Stravy). Rekordy per okres liczy
  // osobno lib/dashboard-engagement (RecordsCard) — tu tylko streak + suma km.
  let totalKm = 0;
  for (const r of rows) totalKm += r.distance_km ?? 0;

  return {
    streakWeeks,
    totalKm: Math.round(totalKm),
  };
}
