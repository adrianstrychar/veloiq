-- VeloIQ initial schema
-- Source: docs/AI_COACH_SPEC.md sections 9 and 27

-- Zawodnicy
create table athletes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  strava_id bigint unique not null,
  strava_access_token text,
  strava_refresh_token text,
  strava_token_expires_at timestamptz,
  name text not null,
  email text,
  discipline text check (discipline in ('gravel', 'road', 'mtb')),
  -- Metryki
  ftp_watts integer,           -- null jeśli brak miernika mocy
  hrmax integer,
  weight_kg decimal(4,1),
  has_power_meter boolean default false,
  -- Harmonogram
  weekly_hours_min integer default 8,
  weekly_hours_max integer default 12,
  training_days integer[] default '{2,3,4,5,6,7}',  -- 1=pon
  long_ride_days integer[] default '{6,7}',
  -- Cele i profil
  current_goals text,
  weak_points text[],
  -- Plan i sprzęt
  has_garmin boolean default false,
  has_whoop boolean default false,
  has_zwift boolean default false,
  has_trainingpeaks boolean default false,
  -- Subskrypcja
  trial_ends_at timestamptz,
  subscription_status text default 'trial' check (
    subscription_status in ('trial', 'active', 'expired', 'cancelled')
  ),
  stripe_customer_id text,
  -- Meta
  language text default 'pl',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Starty w kalendarzu
create table race_calendar (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references athletes(id) on delete cascade,
  name text not null,
  date date not null,
  series text,                 -- 'GWS', 'GFWS', 'MTB', 'other'
  distance_km integer,
  elevation_m integer,
  priority text check (priority in ('A', 'B', 'C')),  -- A = główny cel
  notes text,
  created_at timestamptz default now()
);

-- Tygodniowe plany treningowe
create table weekly_plans (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references athletes(id) on delete cascade,
  week_start date not null,
  plan_json jsonb not null,
  -- Metryki w momencie generowania
  ctl_at_generation decimal(6,2),
  atl_at_generation decimal(6,2),
  tsb_at_generation decimal(6,2),
  weekly_tss_target integer,
  -- Trigger
  generated_by text check (generated_by in ('auto_monday', 'manual', 'checkin')),
  -- AI
  ai_model text,
  tokens_used integer,
  created_at timestamptz default now()
);

-- Cotygodniowy check-in zawodnika
create table weekly_checkins (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references athletes(id) on delete cascade,
  week_start date not null,
  -- WHOOP (opcjonalne)
  rhr_bpm integer,
  sleep_hours decimal(3,1),
  hrv integer,
  -- Subiektywne (wymagane)
  fatigue_score integer check (fatigue_score between 1 and 10),
  legs_feeling text check (legs_feeling in ('fresh', 'normal', 'heavy', 'dead')),
  motivation text check (motivation in ('high', 'normal', 'low')),
  notes text,
  created_at timestamptz default now(),
  unique(athlete_id, week_start)
);

-- Sesje chat
create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references athletes(id) on delete cascade,
  session_type text check (session_type in ('weekly_checkin', 'free_chat', 'race_analysis')),
  messages jsonb not null default '[]',
  tokens_used integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Historia metryk fitness (CTL/ATL/TSB)
create table fitness_metrics (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references athletes(id) on delete cascade,
  date date not null,
  ctl decimal(6,2),
  atl decimal(6,2),
  tsb decimal(6,2),
  daily_tss decimal(6,2),
  calculated_at timestamptz default now(),
  unique(athlete_id, date)
);

-- Cache aktywności Strava
create table strava_activities (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references athletes(id) on delete cascade,
  strava_activity_id bigint unique not null,
  activity_date date not null,
  name text,
  type text,
  distance_km decimal(6,2),
  duration_seconds integer,
  elevation_m integer,
  avg_watts integer,
  max_watts integer,
  avg_hr integer,
  max_hr integer,
  avg_cadence integer,
  tss decimal(6,2),
  intensity_factor decimal(4,3),
  normalized_power integer,
  raw_data jsonb,
  synced_at timestamptz default now()
);

-- Trasy wyścigowe
create table race_routes (
  id uuid primary key default gen_random_uuid(),
  race_id uuid references race_calendar(id) on delete cascade,
  source text check (source in ('manual_upload', 'auto_fetched')),
  gpx_data text,                    -- surowy GPX XML
  route_analysis jsonb,             -- wynik analizy AI (RouteAnalysis)
  total_distance_km decimal(6,2),
  total_elevation_m integer,
  surface_type text,                -- 'gravel', 'road', 'mtb', 'mixed'
  analyzed_at timestamptz,
  created_at timestamptz default now()
);

-- Plany wyścigowe (taktyka + żywienie + opony)
create table race_plans (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references athletes(id) on delete cascade,
  race_id uuid references race_calendar(id) on delete cascade,
  route_id uuid references race_routes(id),
  -- Taktyka
  tactical_plan jsonb,              -- km po km
  target_finish_time interval,
  target_avg_watts integer,
  target_if decimal(4,3),
  -- Żywienie na rowerze
  race_nutrition_plan jsonb,
  -- Żywienie poza rowerem
  carbo_loading_plan jsonb,         -- 2 dni przed
  race_day_nutrition jsonb,         -- śniadanie + godziny
  -- Opony
  tire_recommendations jsonb,
  -- AI
  ai_model text,
  tokens_used integer,
  created_at timestamptz default now(),
  unique(athlete_id, race_id)
);

-- Dane biometryczne dzienne
create table daily_biometrics (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references athletes(id) on delete cascade,
  date date not null,
  rhr_bpm integer,
  hrv_ms integer,
  sleep_hours decimal(3,1),
  sleep_quality smallint check (sleep_quality between 1 and 5),
  recovery_score integer check (recovery_score between 0 and 100),
  respiratory_rate decimal(4,1),
  energy_level smallint check (energy_level between 1 and 5),
  muscle_soreness smallint check (muscle_soreness between 1 and 5),
  stress_level smallint check (stress_level between 1 and 5),
  notes text,
  source text default 'manual' check (source in ('manual', 'whoop', 'garmin', 'oura')),
  created_at timestamptz default now(),
  unique(athlete_id, date)
);

-- Dane wagowe
create table weight_tracking (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references athletes(id) on delete cascade,
  date date not null,
  weight_kg decimal(4,1) not null,
  notes text,
  created_at timestamptz default now()
);

-- Indexes for common lookups
create index idx_race_calendar_athlete on race_calendar(athlete_id);
create index idx_weekly_plans_athlete on weekly_plans(athlete_id);
create index idx_chat_sessions_athlete on chat_sessions(athlete_id);
create index idx_fitness_metrics_athlete on fitness_metrics(athlete_id);
create index idx_strava_activities_athlete on strava_activities(athlete_id);
create index idx_race_routes_race on race_routes(race_id);
create index idx_race_plans_athlete on race_plans(athlete_id);
create index idx_daily_biometrics_athlete on daily_biometrics(athlete_id);
create index idx_weight_tracking_athlete on weight_tracking(athlete_id);

-- Row Level Security — zawodnik widzi tylko swoje dane (sekcja 16)
alter table athletes enable row level security;
alter table race_calendar enable row level security;
alter table weekly_plans enable row level security;
alter table weekly_checkins enable row level security;
alter table chat_sessions enable row level security;
alter table fitness_metrics enable row level security;
alter table strava_activities enable row level security;
alter table race_routes enable row level security;
alter table race_plans enable row level security;
alter table daily_biometrics enable row level security;
alter table weight_tracking enable row level security;

create policy "Athletes can view own row" on athletes
  for select using (auth.uid() = user_id);
create policy "Athletes can update own row" on athletes
  for update using (auth.uid() = user_id);

create policy "Athletes can manage own race_calendar" on race_calendar
  for all using (athlete_id in (select id from athletes where user_id = auth.uid()));

create policy "Athletes can manage own weekly_plans" on weekly_plans
  for all using (athlete_id in (select id from athletes where user_id = auth.uid()));

create policy "Athletes can manage own weekly_checkins" on weekly_checkins
  for all using (athlete_id in (select id from athletes where user_id = auth.uid()));

create policy "Athletes can manage own chat_sessions" on chat_sessions
  for all using (athlete_id in (select id from athletes where user_id = auth.uid()));

create policy "Athletes can manage own fitness_metrics" on fitness_metrics
  for all using (athlete_id in (select id from athletes where user_id = auth.uid()));

create policy "Athletes can manage own strava_activities" on strava_activities
  for all using (athlete_id in (select id from athletes where user_id = auth.uid()));

create policy "Athletes can manage own race_routes" on race_routes
  for all using (race_id in (
    select id from race_calendar where athlete_id in (
      select id from athletes where user_id = auth.uid()
    )
  ));

create policy "Athletes can manage own race_plans" on race_plans
  for all using (athlete_id in (select id from athletes where user_id = auth.uid()));

create policy "Athletes can manage own daily_biometrics" on daily_biometrics
  for all using (athlete_id in (select id from athletes where user_id = auth.uid()));

create policy "Athletes can manage own weight_tracking" on weight_tracking
  for all using (athlete_id in (select id from athletes where user_id = auth.uid()));
