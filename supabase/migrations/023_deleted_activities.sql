-- Treningi usunięte przez zawodnika w VeloIQ. Aktywność ze Stravy usunięta w aplikacji nie wraca przy
-- kolejnej synchronizacji (Strava jej nie kasuje – usuwamy tylko z VeloIQ).
-- Uruchom ręcznie w Supabase Studio (SQL Editor).
create table if not exists public.deleted_activities (
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  strava_activity_id bigint not null,
  deleted_at timestamptz not null default now(),
  primary key (athlete_id, strava_activity_id)
);
alter table public.deleted_activities enable row level security;
drop policy if exists "Athletes manage own deleted_activities" on public.deleted_activities;
create policy "Athletes manage own deleted_activities" on public.deleted_activities
  for all using (athlete_id in (select id from public.athletes where user_id = auth.uid()))
  with check (athlete_id in (select id from public.athletes where user_id = auth.uid()));

-- Cache tekstu „AI Insight” na pulpicie (bez wywołania AI przy każdym wejściu; klucz = dane wejściowe).
alter table public.athletes add column if not exists daily_insight_text text;
alter table public.athletes add column if not exists daily_insight_key text;
