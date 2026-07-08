-- 012: zapamiętany scope OAuth Stravy — do bramkowania write-backu opisu (Etap 1).
-- Strava zwraca przyznany scope w query callbacku; zapisujemy go, żeby UI wiedziało PRZED próbą
-- zapisu, czy jest activity:write (inaczej pokazuje CTA re-connect zamiast PUT-a, który dałby 403).
-- NULL = przed pierwszym re-connectem z nowym scope → traktujemy jak brak write (read-only).
alter table athletes
  add column if not exists strava_scope text;

comment on column athletes.strava_scope is
  'Przyznany scope OAuth Stravy z callbacku (np. "read,activity:read_all,activity:write"). Steruje pokazaniem write-backu opisu vs CTA re-connect. NULL = stary token bez activity:write.';
