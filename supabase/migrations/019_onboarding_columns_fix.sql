-- 019: Domknięcie NIEKOMPLETNEGO 018 na produkcji.
-- Diagnoza (żywa baza): 018 zastosowane częściowo — onboarding_completed/ftp_source/
-- ftp_engine_note_seen/training_mode/vo2max ISTNIEJĄ, ale sex i ftp_prev_value BRAK.
-- Skutek: dashboard SELECT padał 400 na ftp_prev_value, /onboarding SELECT na sex →
-- athlete=null → pętla redirectów /dashboard↔/onboarding (nowy user nie wchodził do apki).
-- Idempotentne (if not exists) — bezpieczne niezależnie od stanu środowiska (prod/preview).
alter table athletes add column if not exists sex text
  check (sex is null or sex in ('M', 'F'));
alter table athletes add column if not exists ftp_prev_value integer;
