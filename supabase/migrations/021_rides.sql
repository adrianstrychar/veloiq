-- VeloIQ: treningi nagrane w aplikacji (RideEngine). Uruchom ręcznie w Supabase Studio → SQL Editor.

create table if not exists public.rides (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null,
  duration_sec integer not null check (duration_sec >= 0),
  avg_power integer,
  normalized_power integer,
  intensity_factor numeric(4, 3),
  tss integer,
  kj integer,
  avg_hr integer,
  max_hr integer,
  compliance_pct integer,
  ftp_at_ride integer,
  outdoor boolean not null default false,
  has_gps boolean not null default false,
  workout_name text,
  workout_script jsonb,             -- plan, z którego jechano (pusty steps = jazda swobodna)
  series jsonb not null default '[]'::jsonb,   -- faktyczne serie: start, czas, moc, zgodność, przerwa przed
  efforts jsonb not null default '[]'::jsonb,  -- wysiłki wykryte w jeździe swobodnej
  samples_path text not null,       -- Storage: rides/<user_id>/<id>.jsonl (1 Hz)
  source text not null default 'veloiq-ios',
  created_at timestamptz not null default now()
);

create index if not exists rides_user_started_idx on public.rides (user_id, started_at desc);

alter table public.rides enable row level security;

drop policy if exists "rides: own select" on public.rides;
create policy "rides: own select" on public.rides for select using (auth.uid() = user_id);
drop policy if exists "rides: own insert" on public.rides;
create policy "rides: own insert" on public.rides for insert with check (auth.uid() = user_id);
drop policy if exists "rides: own update" on public.rides;
create policy "rides: own update" on public.rides for update using (auth.uid() = user_id);
drop policy if exists "rides: own delete" on public.rides;
create policy "rides: own delete" on public.rides for delete using (auth.uid() = user_id);

-- Storage: prywatny bucket na zapisy 1 Hz, każdy widzi tylko swój folder <user_id>/
insert into storage.buckets (id, name, public)
values ('rides', 'rides', false)
on conflict (id) do nothing;

drop policy if exists "rides bucket: own read" on storage.objects;
create policy "rides bucket: own read" on storage.objects for select
  using (bucket_id = 'rides' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "rides bucket: own write" on storage.objects;
create policy "rides bucket: own write" on storage.objects for insert
  with check (bucket_id = 'rides' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "rides bucket: own delete" on storage.objects;
create policy "rides bucket: own delete" on storage.objects for delete
  using (bucket_id = 'rides' and (storage.foldername(name))[1] = auth.uid()::text);
