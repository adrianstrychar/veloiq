-- ETAP 6a: dodaj kolumny do przechowywania szczegółów aktywności jako JSON
ALTER TABLE strava_activities
  ADD COLUMN IF NOT EXISTS laps jsonb,
  ADD COLUMN IF NOT EXISTS best_efforts jsonb,
  ADD COLUMN IF NOT EXISTS details_synced_at timestamptz;
