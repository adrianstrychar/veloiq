-- ETAP 5.1: unikalność tygodnia per atleta — umożliwia czysty upsert planu
-- (endpoint robi ręczny upsert i nie wymaga tego constraintu, ale dla integralności
--  danych chcemy go mieć: jeden plan na (atleta, tydzień)).
alter table weekly_plans
  add constraint weekly_plans_athlete_week_unique unique (athlete_id, week_start);
