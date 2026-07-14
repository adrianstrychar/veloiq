-- 018: Onboarding nowych userów (multi-user launch).
-- Filozofia: user wchodzi OD RAZU, onboarding POTWIERDZA (nie wypełnia), FTP z backfillu podmienia
-- tymczasowy później (ftp_source: strava_profile/manual → engine).
--
-- KOLEJNOŚĆ (jedna transakcja):
--   (1) wszystkie ADD COLUMN IF NOT EXISTS,
--   (2) UPDATE istniejących (grandfather) — PO add column,
--   (3) domknięcie onboarding_completed: DEFAULT false + NOT NULL dla PRZYSZŁYCH wierszy.
-- Wzorzec nullable→backfill→not-null: istniejące = NULL (do grandfather), nowi = false (do onboardingu).
-- Backfill WHERE IS NULL jest IDEMPOTENTNY: re-run nie ma NULL-i → no-op → nowi userzy między
-- uruchomieniami NIE zostaną błędnie oznaczeni jako onboardowani.

begin;

-- ── (1) ADD COLUMN IF NOT EXISTS ─────────────────────────────────────────────────────────────────
-- onboarding_completed: NULLOWALNY na start (bez default) → istniejące wiersze = NULL = "do grandfather".
alter table athletes add column if not exists onboarding_completed boolean;

-- Źródło wyświetlanego FTP: 'strava_profile'/'manual' = wstępny (onboarding), 'engine' = policzony silnikiem.
alter table athletes add column if not exists ftp_source text
  check (ftp_source is null or ftp_source in ('strava_profile', 'manual', 'engine'));

-- Płeć (prefill Strava + heurystyka default FTP przy braku danych). Opcjonalna.
alter table athletes add column if not exists sex text
  check (sex is null or sex in ('M', 'F'));

-- Notka "Zaktualizowaliśmy FTP: X → Y" pokazywana RAZ przy promocji silnikowej. DEFAULT true = brak
-- nieprzeczytanej notki → istniejący userzy (widzieli już swój FTP) NIE dostają retro-notki; nowi też
-- true, aż promocja silnikowa ustawi false. NOT NULL od razu (nie wymaga backfillu).
alter table athletes add column if not exists ftp_prev_value integer;
alter table athletes add column if not exists ftp_engine_note_seen boolean not null default true;

-- FORMALIZACJA DRYFU (sieroty z audytu: SELECT-owane przez dashboard/insight/plan, nietworzone przez
-- żadną migrację 001-017 → 500 na czystej bazie). training_mode zapisuje onboarding (koniec TODO w ftp.ts).
alter table athletes add column if not exists training_mode text
  check (training_mode is null or training_mode in ('power', 'hr', 'basic'));
alter table athletes add column if not exists vo2max integer;

-- ── (2) BACKFILL istniejących (grandfather) — PO add column, w tej samej transakcji ────────────────
-- Łapie WSZYSTKICH obecnych athlete: onboarding_completed IS NULL = każdy wiersz sprzed migracji,
-- z danymi czy bez (Adrian + ewentualne konta testowe). Świeża kolumna = same NULL, więc nic
-- ustawionego nie jest nadpisywane. ftp_source='engine' tylko dla mających FTP → chroni ręczny FTP
-- Adriana przed cichą promocją onboardingową (shouldPromoteToEngine pomija ftp_source='engine').
update athletes
set onboarding_completed = true,
    ftp_source = case when ftp_watts is not null then 'engine' else ftp_source end
where onboarding_completed is null;

-- ── (3) DOMKNIĘCIE: default false + NOT NULL dla PRZYSZŁYCH wierszy ────────────────────────────────
-- Nowy user (INSERT po migracji) → onboarding_completed = false → gate w layoucie → /onboarding.
alter table athletes alter column onboarding_completed set default false;
alter table athletes alter column onboarding_completed set not null;

commit;
