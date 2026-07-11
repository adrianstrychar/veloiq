-- Races B1: cel przygotowania per wyścig.
--  target_ctl         — ręczne nadpisanie docelowej formy na start (null → default z race-prep:
--                       max(szczyt sezonu, obecne CTL)). Pierścień PRZYGOTOWANIE liczy drogę do tego.
--  qualification_goal — tekst celu kwalifikacyjnego per wyścig (np. "top 25% w M19-34 → MŚ Nannup").
ALTER TABLE race_calendar
  ADD COLUMN IF NOT EXISTS target_ctl integer,
  ADD COLUMN IF NOT EXISTS qualification_goal text;
