-- 010: pending_changes — bufor "propose przed commit" dla write tooli czatu AI.
-- Model NIGDY nie zapisuje od razu: propose_* liczy zmianę i zapisuje ją tutaj (bez dotknięcia
-- weekly_plans/race_calendar); commit_change aplikuje po jawnym potwierdzeniu usera.
-- BEZ crona: expiry (15 min) walidowane przy commit; stare pending atlety czyszczone przy każdym propose.
create table pending_changes (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references athletes(id) on delete cascade not null,
  kind text not null check (kind in ('plan', 'race')),
  week_start date,            -- dla kind='plan'
  race_id uuid,              -- dla kind='race' (edit/delete) — PR 3
  base_hash text not null,   -- hash stanu źródłowego w chwili propose (optimistic lock)
  payload_json jsonb not null, -- zamrożony wynik zmiany do zaaplikowania
  created_at timestamptz default now()
);

alter table pending_changes enable row level security;

-- RLS scoped po athlete_id — wzorzec 1:1 z pozostałych tabel.
create policy "Athletes can manage own pending_changes" on pending_changes
  for all using (athlete_id in (select id from athletes where user_id = auth.uid()));

create index idx_pending_changes_athlete on pending_changes(athlete_id);
