# Dług techniczny — VeloIQ

Lista znanych skrótów/tymczasowych rozwiązań do uprzątnięcia przed produkcją.

## Naprawione

- [x] **Hardcoded ostatnia aktywność na dashboardzie** — `dashboard/page.tsx` wymuszał konkretne
  `strava_activity_id` (jazda interwałowa z 13.05, do testów struktury lapów 6b/6c) zamiast
  brać najnowszą jazdę. Naprawione: `order('activity_date', desc).limit(1)`. (2026-06-21)

## Otwarte

- [ ] **DEV_SECRET bypass w endpointach AI** — `app/api/activities/[id]/insight/route.ts` oraz
  `app/api/activities/[id]/sync-details/route.ts` mają nagłówek `x-dev-secret` omijający auth
  (`DEV_TEST_SECRET ?? 'veloiq-dev-2026'`) do testów lokalnych. **Usunąć przed produkcją** —
  inaczej każdy ze znanym sekretem ominie kontrolę właściciela danych.

- [ ] **Dryf schematu** — kolumny `athletes.vo2max` i `athletes.training_mode` istnieją w bazie,
  ale nie ma ich w żadnej migracji (`001`–`005`). Postawienie bazy od zera z plików migracji
  nie odtworzy produkcyjnego schematu. Dorobić migrację domykającą.
