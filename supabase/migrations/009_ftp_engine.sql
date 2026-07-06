-- 009: silnik estymaty FTP (28-dniowa krzywa mocy, profile-aware).
-- Cicha estymata żyje OBOK ręcznego ftp_watts — silnik nie nadpisuje ręcznej wartości
-- bez jawnej akceptacji usera (ftp_updated_at ustawia się pierwszą akceptacją; od tego
-- momentu działa hybryda: aktualizacja po ≥14 dniach lub progu +5/−8 W).
alter table athletes
  add column if not exists ftp_estimate numeric,
  add column if not exists ftp_estimated_at timestamptz,
  add column if not exists ftp_updated_at timestamptz;

comment on column athletes.ftp_estimate is
  'Cicha estymata FTP z 28-dniowej krzywej mocy (silnik, po każdym syncu). Wyświetlana jako "~X szac." dopóki user nie zaakceptuje.';
comment on column athletes.ftp_estimated_at is
  'Kiedy silnik ostatnio przeliczył ftp_estimate.';
comment on column athletes.ftp_updated_at is
  'Data ostatniej zmiany WYŚWIETLANEGO ftp_watts ("FTP 295W · od 28.06"). NULL = wartość ręczna sprzed silnika — silnik nie rusza ftp_watts.';

-- Historia FTP: skąd pochodzi punkt. Istniejące wiersze (seed SQL-em) dostają 'seed' defaultem.
alter table ftp_history
  add column if not exists source text not null default 'seed'
    check (source in ('manual', 'estimate', 'seed'));

comment on column ftp_history.source is
  'manual = wpis usera, estimate = silnik FTP (akceptacja lub hybryda), seed = punkt startowy z SQL.';
