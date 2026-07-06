# VeloIQ — AI Chat: Tools + Zakres (design kanoniczny)

**Status:** zaakceptowany · **PR:** #45 · **Właściciel:** Adrian Strychar

Ten dokument jest źródłem prawdy dla architektury chatu AI trenera: 8 narzędzi (tools),
pętli tool-use, anchora i macierzy zakresu (Core/Adjacent/Out of scope). Zapisany, żeby
design nie zginął między sesjami. Zmiana narzędzia = najpierw aktualizacja tego pliku.

Powiązania w kodzie:
- Definicje + dispatch + handlery: `lib/ai/chat-tools.ts`
- System prompt (Layer 1 + anchor): `lib/ai/prompt.ts`
- Pętla tool-use: `app/api/ai/chat/route.ts`
- Empty-state UI: `app/chat/page.tsx`

---

## 1. Kanoniczne 8 narzędzi

Wszystkie handlery są **scoped przez `athleteId` z sesji** (nigdy z inputu modelu).
Waty są pomijane, gdy `has_power_meter = false` (twarda reguła — patrz Layer 1 powerRule).

| # | Tool | Input | Zwraca (skrót) |
|---|------|-------|----------------|
| 1 | `get_athlete_profile` | — | name, discipline, ftp_watts, wkg, hrmax, weight_kg, has_power_meter, weekly_hours{min,max}, training_days, goals, weak_points |
| 2 | `get_activities` | `{from?, to?, type?, limit?=10}` (max 50) | per-ride summary; bez from/to → cap 90 dni wstecz |
| 3 | `get_activity_detail` | `{strava_activity_id?}` \| `{activity_date?}` | laps, best_efforts, NP, IF, max watts/HR; live sync gdy brak; nigdy nie rzuca |
| 4 | `get_fitness_status` | — | ctl, atl, tsb, ctl_trend_7d, readiness{raceReady, freshPct, fitnessPct, state, advice} |
| 5 | `get_fitness_history` | `{days=42}` (7..180) | seria {date, ctl, atl, tsb} |
| 6 | `get_weekly_plan` | `{week_start?}` | week_start, is_current, user_hours, insight, days[] |
| 7 | `get_races` | `{limit?=5}` (max 20) | races[{name, date, days_away, priority}] |
| 8 | `get_checkin` | — | {week: weekly_checkins bieżący tydzień \| null, latest_daily: daily_biometrics najnowszy \| null} |

### 1.1 `get_athlete_profile()`
Źródło: `athletes` (po `id = athleteId`). `wkg = round(ftp_watts / weight_kg, 1)` gdy oba znane.

### 1.2 `get_activities({from?, to?, type?, limit?=10})`
- Źródło: `strava_activities`. Daty **lokalne** (`activity_date` = `start_date_local[:10]`).
- Bez `from`/`to`: cap 90 dni wstecz od dziś. `limit` clamp do max 50.
- Per-ride: `strava_activity_id, date, name, type, distance_km, duration_min, elevation_m,
  avg_watts, normalized_power, avg_hr, tss, intensity_factor`.
- `has_power_meter=false` → pola wattowe (avg_watts, normalized_power, intensity_factor) pominięte.

### 1.3 `get_activity_detail({strava_activity_id? | activity_date?})`
- Rozwiązanie jazdy: po `strava_activity_id` **lub** po `activity_date` (lokalna).
  Gdy >1 jazda tego dnia → wybór o **najwyższym TSS**.
- Brak dopasowania → `{found:false, message}` (zaproponuj sync, NIE proś o wklejanie).
- `details_synced_at IS NULL` → **on-demand** `syncActivityDetails` (live Strava).
  - `detail_source`: `"cache"` | `"strava_live"` | `"strava_unavailable"`.
  - Cała ścieżka w `try/catch` — **nigdy nie rzuca** (fail → `strava_unavailable`).
- Zwraca: `found, detail_source, activity_date, name, type, normalized_power,
  intensity_factor, max_watts, max_hr, best_efforts{5s,1min,5min,20min,...}, laps[]` (skrócone).

### 1.4 `get_fitness_status()`
Źródło: `fitness_metrics` (pełna historia asc) + `computeReadiness` (`lib/readiness.ts`).
Zwraca ostatni wiersz + `ctl_trend_7d` (ctl teraz − ctl 7 wierszy wstecz) + readiness.
**Tool zostaje mimo skrótu w anchorze** — do głębszych pytań o gotowość.

### 1.5 `get_fitness_history({days=42})`
`days` clamp 7..180. Seria `{date, ctl, atl, tsb}`. Co dzień dla `days<=60`,
co 2. dzień dla `days>60` (ograniczenie tokenów).

### 1.6 `get_weekly_plan({week_start?})`
- Domyślnie bieżący tydzień (`mondayOfISO(localTodayISO())`).
- Źródło: `weekly_plans.plan_json` (`{days, insight}`).
- `days[]`: `{dow, date, type, label, tss, dur_min, zones, locked, outline, past, done}`.
  - `past = date < dziś` (lokalnie), `done = istnieje jazda tego dnia` (predykaty PR #44).
- `is_current`, `user_hours` (Σ dur_min / 60), `insight`. Brak planu → `{found:false}`.

### 1.7 `get_races({limit?=5})`
Źródło: `race_calendar`, `date >= dziś`, asc, `limit` max 20.
`races[{name, date, days_away, priority}]`. **Nazwa: `get_races`** (nie `get_race_calendar`).

### 1.8 `get_checkin()`
`{week: weekly_checkins bieżącego tygodnia | null, latest_daily: daily_biometrics najnowszy wiersz | null}`.
**Biometria wewnątrz tego toola** — nie ma osobnego `get_biometrics`.
Brak tabeli/wiersza `daily_biometrics` → `latest_daily: null` (graceful, bez rzucania).

---

## 2. Pętla tool-use (`app/api/ai/chat/route.ts`)

- `model: claude-sonnet-4-6`, `max_tokens: 4096`, `MAX_ROUNDS = 5`.
- `athleteId` + `has_power_meter` rozwiązane raz z sesji; przekazane do dispatch.
- Runda: `messages.create({ system, messages, tools })`.
  - `stop_reason === 'tool_use'` → wykonaj wszystkie `tool_use` bloki → dołóż `tool_result`
    **1:1 per `tool_use_id`** → kolejna runda.
  - Błąd handlera → `tool_result { is_error: true }` (NIE wywala requestu).
  - inny `stop_reason` → koniec, zwróć tekst.
- Po `MAX_ROUNDS` bez zakończenia → finalny call z `tool_choice: { type: 'none' }`
  (wymuś odpowiedź tekstową).
- Wszystkie handlery scoped przez `athleteId`. Reużycie: `computeReadiness`,
  `syncActivityDetails`, helpery z `lib/plan.ts`.

---

## 3. Anchor (zawsze wstrzykiwany, lekki)

Zastępuje ciężką Layer 2. Niesie minimum sterujące regułami bezpieczeństwa Layer 1
(TSB, tryb mocy/HR) + **DZIŚ** (żeby model liczył „wczoraj/jutro"):

```
KONTEKST ZAWODNIKA (anchor — zawsze aktualny):
[name] · [discipline] · [tryb: z miernikiem mocy / na HR]
[FTP: xW · W/kg: x · HRmax: x · Waga: x kg]   (bez FTP/W przy has_power_meter=false)
DZIŚ: [YYYY-MM-DD] ([dzień tygodnia po polsku])
Forma dziś: CTL x · ATL x · TSB x ([label], trend CTL ±x/tydz.) · Gotowość: x% ([state])
Najbliższy start: [name] za [n] dni (priorytet [x]) | "brak startów w kalendarzu"
Pełne dane (jazdy, plan, historia formy, check-in) dociągaj narzędziami.
```

---

## 4. Macierz zakresu (Layer 1)

- **CORE** (pełna odpowiedź + dane usera): trening, plan, analiza jazd, FTP/strefy,
  forma (CTL/ATL/TSB), pacing, tapering, przygotowanie do startu.
- **ADJACENT** (wiedza ekspercka):
  - **Żywienie pod wysiłek** — *półpersonalizacja*: użyj wagi, czasu/intensywności jazd,
    kalendarza startów do konkretnych wyliczeń (węgle/h, nawodnienie, śniadanie startowe,
    carbo-loading). Zastrzeżenie „ogólne wskazówki" tylko dla: dieta codzienna, alergie,
    tolerancja żołądkowa, suplementy.
  - **Sprzęt / opony / ciśnienia** — czysto ogólne (brak danych o sprzęcie); ciśnienie jako
    zakres odniesiony do wagi, z zastrzeżeniem warunków.
  - **Regeneracja** — doradztwo łączone z formą/biometrią.
- **OUT OF SCOPE** (odmowa + przekierowanie): diagnozy medyczne, leki, leczenie kontuzji,
  ból/uraz/objawy → lekarz/fizjoterapeuta (twarde: nigdy porada treningowa „przez ból”);
  tematy niekolarskie → krótkie przekierowanie.

**UCZCIWOŚĆ DANYCH:** każda liczba z anchora LUB z wyniku narzędzia; brak danych → NAJPIERW
dociągnij narzędziem; puste → powiedz wprost + zaproponuj sync/uzupełnienie profilu;
NIGDY nie proś o ręczne wklejanie danych, które są w aplikacji.

---

## 5. Przebiegi weryfikacyjne (oczekiwane)

| # | Pytanie | Toole | Rundy | Oczekiwana odpowiedź |
|---|---------|-------|-------|----------------------|
| a | „Sprawdź wczorajszą jazdę i moje FTP” | `get_activity_detail(activity_date=wczoraj)` + `get_athlete_profile` | 1–2 | analiza jazdy + FTP z profilu |
| b | „Jaki mam plan na ten tydzień?” | `get_weekly_plan` | 1 | plan bieżącego tygodnia (dni, insight) |
| c | „Ile węgli/h na jutrzejszym długim?” | `get_weekly_plan` i/lub `get_athlete_profile` | 1–2 | konkret g/h z wagi + czasu/intensywności |
| d | „Boli kolano od 2 dni, mogę interwały?” | — | 0 | przekierowanie do specjalisty, **zero porady treningowej** |
| e | „Co myślisz o nowym iPhone?” | — | 0 | krótkie przekierowanie (jestem trenerem kolarskim) |
| f | Jazda z nieistniejącej daty | `get_activity_detail` → found:false | 1 | wprost „brak danych” + sync, NIE prośba o wklejanie |
