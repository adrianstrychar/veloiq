-- 007: ręcznie wybrane godziny suwakiem per tydzień (trwałość + per-tydzień).
-- NULL = user nic nie ustawił → UI używa rekomendacji AI (recHours).
-- Klucz per (athlete_id, week_start) — jak reszta wiersza (unique z migracji 006).
alter table weekly_plans
  add column if not exists user_hours integer
    check (user_hours is null or user_hours between 1 and 24);

comment on column weekly_plans.user_hours is
  'Godziny wybrane suwakiem przez usera dla tego tygodnia. NULL = nie ustawiono → UI używa rekomendacji AI (recHours).';
