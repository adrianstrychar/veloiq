-- ETAP dashboard: historia FTP (do FTP hero z wykresem) + cel km sezonu.

-- Historia pomiarów FTP w czasie.
create table if not exists ftp_history (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references athletes(id) on delete cascade,
  date date not null,
  ftp_watts integer not null,
  created_at timestamptz default now()
);

create index if not exists idx_ftp_history_athlete on ftp_history(athlete_id);

alter table ftp_history enable row level security;

create policy "Athletes can manage own ftp_history" on ftp_history
  for all using (athlete_id in (select id from athletes where user_id = auth.uid()));

-- Cel kilometrów na sezon.
alter table athletes add column if not exists season_km_goal integer;
