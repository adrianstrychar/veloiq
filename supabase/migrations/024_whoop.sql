-- Integracja WHOOP: połączenie (tokeny OAuth) + dzienne dane regeneracji, snu i obciążenia.
-- Uruchom ręcznie w Supabase Studio (SQL Editor).

create table if not exists public.whoop_connections (
  athlete_id uuid primary key references public.athletes (id) on delete cascade,
  whoop_user_id bigint,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  scope text,
  body jsonb,                       -- user/measurement/body: wzrost, waga, max HR z WHOOP
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  sync_error text
);
-- jedno konto WHOOP = jedno konto VeloIQ (webhook szuka zawodnika po whoop_user_id)
create unique index if not exists whoop_connections_user_uidx on public.whoop_connections (whoop_user_id);
alter table public.whoop_connections enable row level security;
drop policy if exists "Athletes manage own whoop_connections" on public.whoop_connections;
create policy "Athletes manage own whoop_connections" on public.whoop_connections
  for all using (athlete_id in (select id from public.athletes where user_id = auth.uid()))
  with check (athlete_id in (select id from public.athletes where user_id = auth.uid()));

-- Jeden wiersz = jeden dzień (cykl WHOOP): regeneracja RANO tego dnia, sen z nocy przed nim,
-- obciążenie (strain) w ciągu dnia. Data = lokalny dzień pobudki.
create table if not exists public.whoop_daily (
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  date date not null,
  cycle_id bigint,
  recovery_score int,               -- 0–100 %
  hrv_ms numeric,                   -- HRV rMSSD (ms)
  rhr int,                          -- tętno spoczynkowe
  spo2 numeric,
  skin_temp numeric,
  calibrating boolean,
  sleep_performance int,            -- % potrzeby snu
  sleep_efficiency numeric,
  sleep_consistency int,
  sleep_min int,                    -- sen właściwy (lekki + głęboki + REM)
  sleep_need_min int,
  in_bed_min int,
  light_min int,
  deep_min int,
  rem_min int,
  awake_min int,
  disturbances int,
  resp_rate numeric,
  sleep_start timestamptz,
  sleep_end timestamptz,
  day_strain numeric,               -- 0–21
  day_kj numeric,
  day_avg_hr int,
  day_max_hr int,
  workouts jsonb,                   -- aktywności z WHOOP tego dnia (sport, strain, czas, tętno)
  updated_at timestamptz not null default now(),
  primary key (athlete_id, date)
);
alter table public.whoop_daily enable row level security;
drop policy if exists "Athletes manage own whoop_daily" on public.whoop_daily;
create policy "Athletes manage own whoop_daily" on public.whoop_daily
  for all using (athlete_id in (select id from public.athletes where user_id = auth.uid()))
  with check (athlete_id in (select id from public.athletes where user_id = auth.uid()));
