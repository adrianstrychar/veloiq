# Dług techniczny — VeloIQ

Lista znanych skrótów/tymczasowych rozwiązań do uprzątnięcia przed produkcją.

## Naprawione

- [x] **Hardcoded ostatnia aktywność na dashboardzie** — `dashboard/page.tsx` wymuszał konkretne
  `strava_activity_id` (jazda interwałowa z 13.05, do testów struktury lapów 6b/6c) zamiast
  brać najnowszą jazdę. Naprawione: `order('activity_date', desc).limit(1)`. (2026-06-21)

- [x] **DEV_SECRET bypass w endpointach AI** — `insight/route.ts` i `sync-details/route.ts` miały
  nagłówek `x-dev-secret` omijający auth (`DEV_TEST_SECRET ?? 'veloiq-dev-2026'`). Usunięte
  commitem `ad69c29` („Bezpieczeństwo: usunięcie DEV_SECRET bypass przed produkcją"); oba
  endpointy wymagają sesji (`auth.getUser` → 401) + ownership check. Zweryfikowane grepem
  po całym repo (2026-07-11) — zero śladów.

## Otwarte

- [ ] **Dryf schematu** — kolumny `athletes.vo2max` i `athletes.training_mode` istnieją w bazie,
  ale nie ma ich w żadnej migracji. Postawienie bazy od zera z plików migracji nie odtworzy
  produkcyjnego schematu. Dorobić migrację domykającą.
  *(zweryfikowane 2026-07-11 przy migracjach 001–014: nadal brak obu kolumn w plikach —
  wpis AKTUALNY)*
