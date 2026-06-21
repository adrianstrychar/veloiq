-- Brakująca policy INSERT na athletes blokowała upsert w /api/strava/callback (sekcja 14)
create policy "Athletes can insert own row" on athletes
  for insert with check (auth.uid() = user_id);
