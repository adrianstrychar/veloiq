-- 011: estymata VO2max z 5-min mocy (silnik vo2-engine, bliźniak ftp_estimate).
-- Liczona z best_efforts okna 28 dni (ACSM: 7 + 10.8 × 5-min-power / masa). ESTYMATA, nie pomiar —
-- kafel oznacza ją "szacunek". OSOBNA kolumna: statyczny athletes.vo2max (seed) NIE jest ruszany.
-- NULL = brak 5-min w oknie / brak wagi → kafel VO2 ukryty (fallback jak dotąd).
alter table athletes
  add column if not exists vo2_estimate numeric,
  add column if not exists vo2_estimated_at timestamptz;

comment on column athletes.vo2_estimate is
  'Estymata VO2max (mL/kg/min) z 5-min mocy wg ACSM (7 + 10.8×W/kg). Liczona przy syncu z best_efforts. NULL = brak danych → kafel ukryty. NIE myl ze statycznym vo2max (seed).';
comment on column athletes.vo2_estimated_at is
  'Kiedy ostatnio przeliczono vo2_estimate ze Stravy (best effort — błąd nie blokuje syncu).';
