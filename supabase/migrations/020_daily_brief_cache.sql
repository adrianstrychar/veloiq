-- Cache briefu dnia trenera (ETAP CHAT część 3). Brief = konwersacyjny opener czatu, generowany
-- 1×/dzień modelem Haiku. Regeneracja gdy daily_brief_date != dziś (nowy dzień → nowy brief).
-- Trzymamy TYLKO bieżący dzień — historyczne briefy niepotrzebne, więc kolumny na athletes zamiast
-- osobnej tabeli (wzorzec jak 015_activity_insight_cache: ADD COLUMN, zero nowej tabeli/RLS).
--   daily_brief_text         — treść briefu (Haiku)
--   daily_brief_date         — data, dla której wygenerowano (klucz świeżości cache)
--   daily_brief_generated_at — timestamp generacji (dowód "z cache" + telemetria)
ALTER TABLE athletes
  ADD COLUMN IF NOT EXISTS daily_brief_text text,
  ADD COLUMN IF NOT EXISTS daily_brief_date date,
  ADD COLUMN IF NOT EXISTS daily_brief_generated_at timestamptz;
