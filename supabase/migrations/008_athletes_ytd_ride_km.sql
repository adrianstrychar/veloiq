-- 008: licznik sezonu = YTD ze Stravy (ytd_ride_totals), nie suma z naszej bazy.
-- strava_activities trzyma tylko ~90 dni wstecz od podłączenia konta (DEFAULT_LOOKBACK_DAYS),
-- więc user wchodzący w środku sezonu widział licznik od zera. NULL = przed pierwszym
-- odświeżeniem po wdrożeniu → UI fallback na sumę z bazy (nic nie znika nikomu).
alter table athletes
  add column if not exists ytd_ride_km numeric,
  add column if not exists ytd_refreshed_at timestamptz;

comment on column athletes.ytd_ride_km is
  'Km od 1 stycznia wg Stravy (ytd_ride_totals.distance / 1000). Odświeżane przy każdym syncu. NULL = jeszcze nie pobrano → UI używa sumy ze strava_activities.';
comment on column athletes.ytd_refreshed_at is
  'Kiedy ostatnio odświeżono ytd_ride_km ze Stravy (best effort — błąd stats nie blokuje syncu).';
