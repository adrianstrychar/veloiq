-- Przykładowe dane testowe (sekcja 20 specyfikacji — profil "Adrian")
-- Użycie:
-- 1. Zaloguj się raz w aplikacji (Supabase Auth), żeby powstał wiersz w auth.users
-- 2. Znajdź i zamień (find & replace) '00000000-0000-0000-0000-000000000000'
--    poniżej na swoje auth.users.id (Supabase Dashboard -> Authentication -> Users)
-- 3. Wklej całość w Supabase SQL Editor i uruchom

insert into athletes (
  user_id, strava_id, name, discipline,
  ftp_watts, hrmax, weight_kg, has_power_meter,
  weekly_hours_min, weekly_hours_max,
  current_goals, weak_points,
  trial_ends_at, subscription_status
) values (
  '00000000-0000-0000-0000-000000000000', 999999999, 'Adrian', 'gravel',
  289, 189, 67.0, true,
  10, 12,
  'Kwalifikacja UCI GWS M19-34, luka 29 minut', array['moc progowa 20-60min', 'taktyka wyścigowa'],
  now() + interval '14 days', 'trial'
)
on conflict (strava_id) do nothing;

-- Forma dziś: CTL 87 / ATL 62 / TSB +25
insert into fitness_metrics (athlete_id, date, ctl, atl, tsb, daily_tss)
select id, current_date, 87, 62, 25, 35
from athletes where user_id = '00000000-0000-0000-0000-000000000000'
on conflict (athlete_id, date) do update set ctl = excluded.ctl, atl = excluded.atl, tsb = excluded.tsb;

-- Najbliższy start: GT3 Lavaredo za 10 dni, priorytet A
insert into race_calendar (athlete_id, name, date, series, priority)
select id, 'GT3 Lavaredo', current_date + interval '10 days', 'GFWS', 'A'
from athletes where user_id = '00000000-0000-0000-0000-000000000000';

-- Ostatnia aktywność: wtorek, 42km, HR avg 120, TSS 35, regeneracja Z1
insert into strava_activities (
  athlete_id, strava_activity_id, activity_date, name, type,
  distance_km, duration_seconds, avg_hr, tss
)
select id, 888888888, current_date - 1, 'Regeneracja Z1', 'Ride',
  42, 5400, 120, 35
from athletes where user_id = '00000000-0000-0000-0000-000000000000'
on conflict (strava_activity_id) do nothing;

-- Plan tygodniowy z sesją na dziś (Threshold 2x20min)
insert into weekly_plans (athlete_id, week_start, plan_json, ctl_at_generation, atl_at_generation, tsb_at_generation, weekly_tss_target, generated_by)
select
  id,
  date_trunc('week', current_date)::date,
  jsonb_build_object(
    'days', jsonb_build_array(
      jsonb_build_object(
        'day', lower(to_char(current_date, 'FMDay')),
        'date', current_date,
        'type', 'threshold',
        'title', 'Threshold 2×20min @270-285W',
        'duration_minutes', 90,
        'tss_target', 95
      )
    )
  ),
  87, 62, 25, 450, 'manual'
from athletes where user_id = '00000000-0000-0000-0000-000000000000';
