# VeloIQ — Postęp prac

## Status na 2026-06-13

### Zrobione
- Supabase client (browser + server), schema + RLS (migracje 001, 002)
- Strava OAuth (`/api/strava/auth`, `/api/strava/callback`) + sync (`/api/strava/sync`)
- CTL/ATL/TSB (`lib/fitness.ts`, `lib/sync.ts`)
- Dashboard WHOOP-style (dark mode) z realnymi danymi
- Login (`/login`) — Supabase Auth: email+hasło (sign in/sign up) oraz magic link
- `middleware.ts` — chroni `(app)` routes, przekierowuje niezalogowanych na `/login`
- End-to-end flow: login → Strava connect → sync → dashboard z prawdziwym CTL/ATL/TSB działa
  (zweryfikowane na koncie Adriana: CTL≈56, ATL≈56, TSB≈0.6, 59 aktywności z ostatnich 90 dni)

### Naprawione bugi
- PR #13 — sesja Supabase nie synchronizowała się do cookies (`createBrowserClient` zamiast `createClient`)
  → `/api/strava/callback` widział `not_authenticated`
- PR #15 — brakująca RLS policy INSERT na `athletes` blokowała upsert po Strava OAuth (silent `save_failed`,
  middleware odbijał `/login?error=...` z powrotem na `/dashboard`)
- PR #15 — `computeTSS` zwracał 0 gdy `athlete.hrmax` jest `null`; teraz fallback na `max_heartrate`
  z danej aktywności Strava
- PR #16 — `/api/strava/sync` teraz zawsze pobiera pełne okno 90 dni (`after = now - 90d`),
  nie tylko przyrostowo od ostatniej synchronizacji, więc CTL/ATL liczą się z pełnego okresu

### Zmergowane PR
PR #11, #12, #13, #14, #15, #16

## Następna sesja: silnik AI trenera (sekcja 10 i 15 specyfikacji)

Cel: `POST /api/ai/chat` używający Anthropic API (`claude-sonnet-4-20250514`).

Kluczowe elementy do zbudowania:
- `buildSystemPrompt(athleteId)` w `lib/ai/prompt.ts` — składa system prompt z 3 warstw
  (sekcja 10 `docs/AI_COACH_SPEC.md`):
  1. **Tożsamość i filozofia** — statyczna, per dyscyplina (gravel/szosa/MTB), zawiera strefy
     mocy/HR i uniwersalne zasady (TSB przed intensywnością, konkretne liczby W/HR, język PL)
  2. **Profil zawodnika** — dynamiczna, z Supabase: `athletes` (name, discipline, ftp_watts,
     hrmax, weight_kg, weekly_hours_min/max, training_days, weak_points, current_goals),
     `fitness_metrics` (najnowsze CTL/ATL/TSB + trend), `strava_activities` (ostatnie 14 dni),
     `race_calendar` (nadchodzące starty), `weekly_checkins` (jeśli istnieje na ten tydzień)
  3. **Notatka trenera** — faza 2, pomijamy w MVP
- `/api/ai/chat` — route handler, streaming response z Anthropic API, autoryzacja przez
  `createServerSupabaseClient()` + `getUser()`, system prompt z `buildSystemPrompt`
- Środowisko: `ANTHROPIC_API_KEY` już jest w `.env.local.example`

Referencje: `docs/AI_COACH_SPEC.md` sekcje 9 (schema), 10 (system prompt), 11 (CTL/ATL/TSB), 15 (API endpoints).
