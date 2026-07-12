-- Cache AI Insight per jazda (feat/insight-coach). Insight generowany rzadko: regeneracja
-- tylko gdy zmienią się WEJŚCIA (details-resync, zmiana planu dnia, zmiana ring%). Plan nie
-- ma updated_at, więc "zmiana planu" jest niewykrywalna timestampem — stąd fingerprint wejść
-- (insight_inputs_hash): jeden warunek `insight_text IS NULL OR insight_inputs_hash != <bieżący>`
-- subsumuje wszystkie przypadki inwalidacji. insight_generated_at = dowód "z cache" + podpis.
ALTER TABLE strava_activities
  ADD COLUMN IF NOT EXISTS insight_text text,
  ADD COLUMN IF NOT EXISTS insight_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS insight_inputs_hash text;
