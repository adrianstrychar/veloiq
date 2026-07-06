# AI Chat — architecture (as-built)

Map of the AI coach chat as it currently ships. Not a tutorial, not history — a reference for future work.

Endpoint: `POST /api/ai/chat` (`app/api/ai/chat/route.ts`). Model `claude-sonnet-4-6`, `max_tokens: 4096`.
Context comes from tools, not a static snapshot. Auth via Supabase session; every tool is scoped by `athleteId`.

## Tools

### Read tools (8) — `lib/ai/chat-tools.ts`
| Tool | Args | Source | Returns |
|------|------|--------|---------|
| `get_athlete_profile` | — | `athletes` | FTP, W/kg, HRmax, weight, discipline, weekly hours, training days, goals, weak points |
| `get_activities` | `{ from?, to?, type?, limit=10 }` | `strava_activities` | ride summaries (id, date, name, type, dist, dur, NP/HR, TSS, IF). No range → last 90 days |
| `get_activity_detail` | `{ strava_activity_id? \| activity_date? }` | `strava_activities` + `syncActivityDetails` | laps, best efforts (5s/1m/5m/20m), NP, IF, HR, elevation. Fetches from Strava on demand if `details_synced_at` is null; `detail_source: cache\|strava_live\|strava_unavailable` |
| `get_fitness_status` | — | `fitness_metrics` + `computeReadiness` | CTL/ATL/TSB, 7-day CTL trend, readiness (raceReady%, freshPct, state, advice) |
| `get_fitness_history` | `{ days=42 }` | `fitness_metrics` | daily CTL/ATL/TSB series; sampled every 2nd day when `days > 60` |
| `get_weekly_plan` | `{ week_start? }` | `weekly_plans` (+ `strava_activities` for `done`) | per-day type/label/TSS/dur/zones/locked/outline/past/done, insight, user_hours |
| `get_races` | `{ limit=5, include_past? }` | `race_calendar` | `race_id`, name, date, days_away, priority, series. `include_past` also returns past races (needed to delete/clean up). `race_id` is required by the race write tools |
| `get_checkin` | — | `weekly_checkins` + `daily_biometrics` | this week's check-in (RHR, sleep, HRV, fatigue, legs, motivation) + latest daily biometrics |

### Write tools (3) + cancel — `lib/ai/chat-write-tools.ts`
All writes go through **confirm-before-write** (see below). Reuse existing mutation paths — no parallel logic.
| Tool | Args | Effect |
|------|------|--------|
| `propose_plan_change` | `{ week_start?, instruction }` | Dry-run of the plan-modify pipeline (`computePlanModification`, `lib/ai/plan-modify.ts`) — **no write**. Returns a Polish diff + `change_id`; stores pending |
| `propose_race_change` | `{ operation: add\|edit\|delete, race_id?, name?, date?, priority?, series?, distance_km?, elevation_m? }` | Builds a race mutation via `lib/races.ts` — **no write**. Returns diff (all fields, even empty → "—") + `change_id`; stores pending |
| `commit_change` | `{ change_id }` | Applies a pending change (routes by `kind`): plan → `applyPlanModification`; race → `addRace/editRace/deleteRace`. Validated, then pending is consumed |
| `cancel_change` | `{ change_id }` | Deletes the pending proposal on decline ("nie" / "zostaw" / "jednak nie") |

## Tool-use loop (`route.ts`)
`ALL_TOOLS = read + write`. Up to **5 rounds**: call model → if `stop_reason === 'tool_use'`, run each tool
(read via `dispatch`, write via `dispatchWrite`), append `tool_result`s, repeat. A handler throw becomes a
`tool_result` with `is_error: true` (the model sees it and reacts; the request never crashes). After 5 rounds,
one final call with `tool_choice: 'none'` forces a text answer so a reply is always returned.

## Confirm-before-write flow
Table `pending_changes` (migration 010): `id, athlete_id, kind ('plan'|'race'), week_start, race_id, base_hash, payload_json, created_at`. RLS scoped by `athlete_id`. No cron.

1. **propose_\*** — computes the change (no write), stores it in `pending_changes` with `base_hash` (hash of the current source: plan_json for plan; the race row for edit/delete). Old pending for the athlete is **deleted first** (dedup / invalidate abandoned proposals). Returns the diff + `change_id`; the model shows the diff and waits for an explicit "tak".
2. **commit_change** — rejected if the pending is missing, older than **15 min** (expiry validated here, no cron), or `base_hash` no longer matches the current state (**optimistic lock** — e.g. the plan/race was edited elsewhere → "changed since proposal, re-propose"). On success it applies the change and **deletes (consumes)** the pending, so a second "tak" finds nothing → "already applied".
3. **cancel_change** — deletes the pending on decline.

Robustness this buys: double "tak" (consumption), topic change / stale "tak" (prompt rule + one-pending-per-athlete), concurrent edits (base_hash).

## System prompt (`lib/ai/prompt.ts`)
Layer 1 (static) + a light always-on anchor. Section roles (contents live in code):
- **Identity + FILOZOFIA TRENINGOWA + zones** (`buildLayer1`) — coach persona per discipline, power-vs-HR rule, power/HR zone tables.
- **APLIKACJA VELOIQ** — module map (Dashboard / Plan / Starty / Chat / Strava sync) + rule "check with a tool before proposing to create something that already exists".
- **ZAKRES ODPOWIEDZI** — in-scope / adjacent (nutrition, gear, recovery) / out-of-scope, plus the hard medical rule (pain/injury → specialist, no training advice).
- **NARZĘDZIA I DANE** — data-honesty / anti-hallucination (every number from the anchor or a tool result; empty tool → say so, never ask the user to paste app data) **and** the confirm-before-write rules (always propose first, never commit without a fresh "tak" for the last diff, cancel on decline).
- **Anchor** — name, discipline, FTP/W-kg/HRmax, today's date, today's CTL/ATL/TSB + trend, readiness. Everything else is fetched via tools.

## Guards
- **Locked days (#43)** — plan modify locks only days explicitly named in the command: `lockSet = userSpecifiedDays ∩ parseCommandDows(message)`. Prior locks are preserved (immutability); over-locking is impossible by construction.
- **Past days (#44)** — `isPast(date) = date < localTodayISO()`. Past days are non-scalable/non-editable; in plan modify they are reverted to the original and reported in `skippedPastDows`.
- **Write date scope** — plan changes: current or future week only. Race add/edit: `date >= today`. Race delete: any date (calendar cleanup).
- **RLS** — every table is scoped by `athlete_id in (select id from athletes where user_id = auth.uid())`.

## Known limitations / backlog
- **No streaming** — responses return whole (separate PR).
- **No `chat_sessions` persistence** — history is sent by the client on each turn; the `chat_sessions` table exists but is unused.
- **Suggestions (chips)** — `lib/ai/chat-suggestions.ts` + `GET /api/ai/suggestions`, empty-state only; not refreshed after the first message.
- **Past-race discovery** — deleting a past race requires `get_races({ include_past: true })`; upcoming-only by default.
