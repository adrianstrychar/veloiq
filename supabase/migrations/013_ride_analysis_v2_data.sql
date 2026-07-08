-- RideAnalysis v2 (PR1: DANE). Trzy kolumny:
--  streams_json — zdownsamplowane serie do wykresu/mapy/stref (1 pkt/5 s), on-demand+persist.
--  calories     — z detail endpointu Stravy (lista go nie zwraca).
--  pr_efforts   — TYLKO rekordy (segment_efforts z pr_rank≠null), nie pełne 43 efforty.
ALTER TABLE strava_activities
  ADD COLUMN IF NOT EXISTS streams_json jsonb,
  ADD COLUMN IF NOT EXISTS calories integer,
  ADD COLUMN IF NOT EXISTS pr_efforts jsonb;
