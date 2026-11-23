-- VeloIQ na Garmin Edge (aplikacja Connect IQ): parowanie licznika z kontem, wysyłka jazd z licznika.
-- Uruchom ręcznie w Supabase Studio → SQL Editor. Idempotentne.
--
-- Wszystkie tabele obsługuje wyłącznie serwer (service role) po sprawdzeniu tokenu urządzenia;
-- RLS jest włączone, a jedyna polityka pozwala zawodnikowi zobaczyć i odłączyć własne liczniki.

-- Sparowane liczniki. Token znamy tylko jako skrót SHA-256 – pełny token ma wyłącznie urządzenie.
create table if not exists public.garmin_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,
  model text,                         -- numer części Garmina (np. 006-B2713-00 = Edge 1030)
  app_version text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
create index if not exists garmin_devices_user_idx on public.garmin_devices (user_id);

alter table public.garmin_devices enable row level security;
drop policy if exists "garmin_devices: own select" on public.garmin_devices;
create policy "garmin_devices: own select" on public.garmin_devices for select using (auth.uid() = user_id);

-- Parowanie w toku: licznik pokazuje 6-cyfrowy kod, zawodnik wpisuje go w aplikacji (ważny 10 minut).
create table if not exists public.garmin_pairings (
  device uuid primary key default gen_random_uuid(),   -- identyfikator, którym licznik pyta o wynik
  code text not null,
  secret_hash text not null,                           -- sekret licznika do odpytywania (skrót)
  model text,
  app_version text,
  user_id uuid references auth.users (id) on delete cascade,
  token text,                                          -- token do odebrania przez licznik (do wygaśnięcia kodu)
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists garmin_pairings_code_idx on public.garmin_pairings (code);
alter table public.garmin_pairings enable row level security;

-- Próby wpisania kodu (ochrona przed zgadywaniem).
create table if not exists public.garmin_pair_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists garmin_pair_attempts_user_idx on public.garmin_pair_attempts (user_id, at desc);
alter table public.garmin_pair_attempts enable row level security;

-- Jazda w trakcie wysyłki z licznika (podsumowanie + paczki próbek), do czasu złożenia w `rides`.
create table if not exists public.garmin_uploads (
  user_id uuid not null references auth.users (id) on delete cascade,
  ride_key bigint not null,                            -- początek jazdy (epoch s) – klucz idempotencji
  summary jsonb not null,
  extra jsonb,
  ns integer not null default 0,
  ng integer not null default 0,
  ride_id uuid,                                        -- ustawione po złożeniu jazdy
  created_at timestamptz not null default now(),
  primary key (user_id, ride_key)
);
alter table public.garmin_uploads enable row level security;

create table if not exists public.garmin_upload_chunks (
  user_id uuid not null,
  ride_key bigint not null,
  kind text not null check (kind in ('s', 'g')),       -- s = próbki 5 s (moc, tętno, kadencja), g = ślad GPS co 10 s
  seq integer not null,
  data text not null,                                  -- base64
  primary key (user_id, ride_key, kind, seq),
  foreign key (user_id, ride_key) references public.garmin_uploads (user_id, ride_key) on delete cascade
);
alter table public.garmin_upload_chunks enable row level security;

-- Dane z licznika, których nie ma w kolumnach `rides`: dystans, przewyższenie, krzywa mocy, strefy, W'bal.
alter table public.rides add column if not exists extra jsonb;
