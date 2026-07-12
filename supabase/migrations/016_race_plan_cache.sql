-- Cache strategii wyścigu (feat/race-strategy, B2 Etap 1). Strategia AI generowana raz →
-- zapis race_plans → regeneracja tylko gdy zmienią się WEJŚCIA (parametry wyścigu + snapshot
-- profilu). Fingerprint jak insight (#87): warunek `generation_inputs_hash != <bieżący>` →
-- regeneruj; hit → zero calla do Anthropic. generated_at = dowód "z cache" + podpis.
-- Pogoda (Open-Meteo) świadomie POZA fingerprintem i poza Etapem 1 — to Etap 3 (geocoding
-- location→lat/lon, forecast ≤16 dni, świeży fetch poza cache strategii).
ALTER TABLE race_plans
  ADD COLUMN IF NOT EXISTS generation_inputs_hash text,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz;
