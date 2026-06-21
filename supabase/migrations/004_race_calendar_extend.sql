-- ETAP 4a: rozszerz istniejącą race_calendar o realnie brakujące pola.
-- Reuse race_calendar (athlete_id + RLS już są z 001). Status liczymy z priority + date,
-- dystans z distance_km — nie dublujemy kolumn. Brakuje tylko: location, discipline.

ALTER TABLE race_calendar
  ADD COLUMN IF NOT EXISTS location   text,
  ADD COLUMN IF NOT EXISTS discipline text
    CHECK (discipline IN ('gravel', 'road', 'mtb'));
