-- Lapy jazdy (kroki planu: rozgrzewka, interwały, przerwy…) – do eksportu na Stravę jako struktura treningu.
-- Uruchom ręcznie w Supabase Studio (SQL Editor). Bez tej kolumny aplikacja zapisuje jazdę bez lapów.
alter table public.rides add column if not exists laps jsonb;
