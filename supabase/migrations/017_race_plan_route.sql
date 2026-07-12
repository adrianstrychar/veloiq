-- B2 Etap 2 (GPX) — trasa wyścigu na race_plans. NIE używamy race_routes (to segmenty treningowe
-- Strava, inne pojęcie). Parse-and-discard: trzymamy TYLKO wynik analizy, nie surowy XML.
--   route_analysis    — profil wysokości (downsampled ~250 pkt) + lista podjazdów (start_km, dł.,
--                       przewyższenie, grade śr/max, która trzecia). Wchodzi do fingerprintu cache
--                       strategii → wgranie/zmiana GPX regeneruje strategię.
--   route_name        — nazwa pliku/trasy do UI ("trasa: {nazwa}").
--   route_uploaded_at — znacznik wgrania.
ALTER TABLE race_plans
  ADD COLUMN IF NOT EXISTS route_analysis jsonb,
  ADD COLUMN IF NOT EXISTS route_name text,
  ADD COLUMN IF NOT EXISTS route_uploaded_at timestamptz;
