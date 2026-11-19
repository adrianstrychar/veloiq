-- Raport poranny (WHOOP): jeden wiersz na zawodnika i dzień. Silnik (lib/morning) po nocnej
-- regeneracji ocenia dzisiejszy trening; odciążenia zapisuje sam (z możliwością „Przywróć plan”),
-- dokładanie zostawia jako propozycję. Uruchom ręcznie w Supabase Studio (SQL Editor).

create table if not exists public.morning_reports (
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  date date not null,
  verdict text not null,              -- keep | trim | easy | rest | boost | race | off | done | taper | none
  level text,                         -- green | yellow | red
  recovery int,
  headline text not null,
  title text not null,
  reason text not null,
  tips jsonb not null default '[]',
  signals jsonb,
  -- zmiana planu: tryb (auto | proposal), status (applied | proposed | reverted | accepted | dismissed | stale),
  -- tydzień, plan przed i po (pełne plan_json) + ich skróty do bezpiecznego cofania/zatwierdzania
  change_mode text,
  change_status text,
  week_start date,
  plan_before jsonb,
  plan_after jsonb,
  hash_before text,
  hash_after text,
  inputs_key text,                    -- skrót danych wejściowych (ponowne przeliczenie tylko przy zmianie)
  push text,                          -- zdanie do powiadomienia
  notified_at timestamptz,
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (athlete_id, date)
);
alter table public.morning_reports enable row level security;
drop policy if exists "Athletes manage own morning_reports" on public.morning_reports;
create policy "Athletes manage own morning_reports" on public.morning_reports
  for all using (athlete_id in (select id from public.athletes where user_id = auth.uid()))
  with check (athlete_id in (select id from public.athletes where user_id = auth.uid()));
