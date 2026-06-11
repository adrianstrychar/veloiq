# VeloIQ — Specyfikacja Produktu v2.0
### Dokument startowy dla Claude Code
**Wersja:** 2.0 | **Data:** Czerwiec 2026 | **Właściciel:** Adrian Strychar

---

## 1. Wizja produktu

**VeloIQ** to inteligentny asystent treningowy dla kolarzy amatorów startujących w zawodach (UCI GWS, GFWS, MTB/XCO i inne). AI analizuje dane ze Strava, buduje spersonalizowane plany treningowe oparte na CTL/ATL/TSB i prowadzi chat z zawodnikiem jak prawdziwy trener.

**Tagline:** *Twój AI trener. Zawsze gotowy.*

**Nazwa:** VeloIQ (velo = rower, IQ = inteligencja)
**Domena docelowa:** veloiq.app
**Język MVP:** Polski (angielski w wersji 2)
**Motyw:** Dark mode — inspiracja WHOOP (duże liczby, minimalistyczne karty, sportowy klimat)

---

## 2. Model biznesowy

### Plany
| Plan | Cena | Status |
|------|------|--------|
| **Pro** | €59/miesiąc | MVP — jedyny plan |
| Basic | €19/miesiąc | Faza 2 — po dopracowaniu zakresu |

### Trial
- **14 dni bezpłatnie** — bez karty kredytowej
- Po 14 dniach: płatność Stripe lub konto nieaktywne
- Dane zachowane przez 30 dni po wygaśnięciu

### Co zawiera Pro (MVP)
- Pełna analiza danych Strava (moc lub HR)
- Cotygodniowy plan AI (auto poniedziałek + ręczny trigger)
- Chat z AI trenerem bez limitu
- Dashboard CTL/ATL/TSB + wykresy
- Kalendarz startów z periodyzacją
- Eksport planu (PDF + tekst, FIT w fazie 2)
- Obsługa miernika mocy (waty) i bez miernika (HR)

---

## 3. Stack techniczny

```
Frontend:     Next.js 14 (App Router) + TypeScript + Tailwind CSS
Backend:      Next.js API Routes (serverless)
Baza danych:  Supabase (PostgreSQL + Auth + RLS)
AI:           Anthropic API — claude-sonnet-4-20250514
Auth:         Supabase Auth + Strava OAuth 2.0
Dane sport:   Strava API v3
Hosting:      Vercel
Płatności:    Stripe (faza 2)
i18n:         next-intl — MVP tylko PL
```

---

## 4. Role użytkowników (MVP)

### Zawodnik (jedyna rola w MVP)
- Loguje się przez Strava OAuth
- Przechodzi onboarding (7 kroków)
- Widzi dashboard w stylu WHOOP
- Prowadzi chat z AI trenerem
- Otrzymuje cotygodniowy plan
- Zarządza kalendarzem startów

### Trener-Specjalista (faza 2)
- Osobny panel logowania
- Dodaje notatki tekstowe dla AI
- Specjalizacje: gravel / szosa / MTB
- Widzi tylko zawodników swojej dyscypliny

### Admin (faza 2)
- Zarządza kontami trenerów
- Modyfikuje system prompty per dyscyplina
- Statystyki użycia

---

## 5. Ekran główny — design WHOOP-inspired

Ekran główny po zalogowaniu: **prosty, graficzny, kluczowe wskaźniki na pierwszy rzut oka.**

### Layout (dark mode, inspiracja WHOOP)
```
┌─────────────────────────────────────────────┐
│  VeloIQ          Cześć, Adrian 👋    [⚙️]   │
├─────────────────────────────────────────────┤
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  FORMA   │  │ ZMĘCZEN. │  │ ŚWIEŻOŚĆ │  │
│  │          │  │          │  │          │  │
│  │   87     │  │   62     │  │   +25    │  │
│  │  CTL     │  │  ATL     │  │  TSB     │  │
│  │ ████░░   │  │ ████░░   │  │  DOBRA   │  │
│  └──────────┘  └──────────┘  └──────────┘  │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  NASTĘPNA SESJA — DZIŚ             │    │
│  │  Threshold 2×20min @270-285W       │    │
│  │  Wtorek · 1:30h · TSS ~95          │    │
│  │  [Zobacz szczegóły] [Pobierz FIT]  │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  NAJBLIŻSZY START                  │    │
│  │  🇮🇹 GT3 Lavaredo — za 10 dni      │    │
│  │  Forma startowa: ██████░░  DOBRA   │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  OSTATNIA AKTYWNOŚĆ                │    │
│  │  Wt 09.06 · 42km · HR avg 120      │    │
│  │  TSS 35 · Regeneracja Z1           │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  [💬 Chat z trenerem]  [📅 Plan tygodnia]  │
└─────────────────────────────────────────────┘
```

### Paleta kolorów (dark mode)
```
Tło główne:       #0A0A0F  (prawie czarne)
Tło kart:         #13131A  (ciemnoszare)
Tło kart hover:   #1A1A24
Akcent główny:    #00E5A0  (neonowa zieleń — jak WHOOP Recovery)
Akcent ostrzegaw: #FF8C42  (pomarańcz — zmęczenie/ATL)
Akcent danger:    #FF4757  (czerwony — przetrenowanie)
Akcent info:      #4ECDC4  (turkus — CTL/forma)
Tekst główny:     #FFFFFF
Tekst secondary:  #8B8B9E
Obramowania:      #1E1E2E
```

### Typografia
```
Display (duże liczby CTL/ATL/TSB):  font-size: 48px, font-weight: 700
Card title:                          font-size: 11px, uppercase, letter-spacing: 0.1em
Body:                                font-size: 14px
Małe etykiety:                       font-size: 11px, color: secondary
```

---

## 6. Nawigacja

```
Bottom navigation (mobile-first):
[🏠 Home] [📅 Plan] [💬 Chat] [📊 Historia] [👤 Profil]
```

---

## 7. Onboarding (7 kroków — nowy użytkownik)

Po pierwszym logowaniu Strava, przed dashboardem:

```
Krok 1 — Dyscyplina
  Wybierz co trenujesz: [🚵 Gravel] [🚴 Szosa] [🏔️ MTB]
  (wpływa na system prompt AI i filozofię treningu)

Krok 2 — Cel sezonu
  Do czego dążysz? (wolny tekst, przykłady podpowiedzi)
  + Czy startujesz w zawodach? [Tak — dodaj starty] [Nie — trenuję rekreacyjnie]

Krok 3 — Miernik mocy
  Czy masz miernik mocy? [Tak] [Nie]
  → TAK: Podaj FTP (W) lub "Nie wiem — oblicz z moich danych Strava"
  → NIE: Podaj HRmax lub "Nie wiem — oblicz z moich danych Strava"

Krok 4 — Dane fizyczne
  Waga (kg): ___
  HRmax (bpm): ___ lub [Oblicz z danych Strava]

Krok 5 — Harmonogram treningowy
  Ile godzin tygodniowo możesz trenować? [suwak 4-20h]
  Które dni treningowe? [checkboxy pon-nie]
  Które dni na długie jazdy? (sobota/niedziela domyślnie)

Krok 6 — Słabe punkty (multi-select)
  Co chcesz poprawić?
  [Moc progowa 20-60min] [Sprint i ataki] [Góry i podjazdy]
  [Wytrzymałość długodystansowa] [Taktyka wyścigowa] [Regeneracja]

Krok 7 — Sprzęt (opcjonalne)
  Co masz? [Garmin] [Wahoo] [WHOOP] [Zwift] [TrainingPeaks]
  (informacja dla AI — jak opisywać trening)

→ GOTOWE: AI generuje pierwszy plan i przekierowuje na dashboard
```

---

## 8. Obsługa zawodników bez miernika mocy

**Model hybrydowy:**
- Miernik mocy → plan w watach (W) + strefy mocy
- Bez miernika → plan w strefach HR (bpm) + RPE (skala 1-10)

### System stref HR (bez mocy)
```
Z1 Aktywna regeneracja:  <70% HRmax
Z2 Endurance:            71-80% HRmax
Z3 Tempo:                81-87% HRmax
Z4 Próg mleczanowy:      88-93% HRmax
Z5 VO2max:               94-100% HRmax
```

### Przykład sesji bez mocy
```
Zamiast: "2×20min @270-285W (Z4)"
AI pisze: "2×20min w strefie Z4 (HR 166-175 bpm) — czujesz że możesz mówić
           tylko pojedynczymi słowami. RPE 7-8/10."
```

### Szacowanie FTP z danych Strava
Jeśli użytkownik powie "nie wiem" przy FTP — AI analizuje ostatnie 90 dni aktywności ze Stravy i szacuje FTP na podstawie najwyższej mocy 20-minutowej (× 0.95). Jeśli brak danych mocy — pozostaje przy HR.

---

## 9. Baza danych (Supabase)

```sql
-- Zawodnicy
athletes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users ON DELETE CASCADE,
  strava_id bigint UNIQUE NOT NULL,
  strava_access_token text,
  strava_refresh_token text,
  strava_token_expires_at timestamptz,
  name text NOT NULL,
  email text,
  discipline text CHECK (discipline IN ('gravel', 'road', 'mtb')),
  -- Metryki
  ftp_watts integer,           -- null jeśli brak miernika mocy
  hrmax integer,
  weight_kg decimal(4,1),
  has_power_meter boolean DEFAULT false,
  -- Harmonogram
  weekly_hours_min integer DEFAULT 8,
  weekly_hours_max integer DEFAULT 12,
  training_days integer[] DEFAULT '{2,3,4,5,6,7}',  -- 1=pon
  long_ride_days integer[] DEFAULT '{6,7}',
  -- Cele i profil
  current_goals text,
  weak_points text[],
  -- Plan i sprzęt
  has_garmin boolean DEFAULT false,
  has_whoop boolean DEFAULT false,
  has_zwift boolean DEFAULT false,
  has_trainingpeaks boolean DEFAULT false,
  -- Subskrypcja
  trial_ends_at timestamptz,
  subscription_status text DEFAULT 'trial' CHECK (
    subscription_status IN ('trial', 'active', 'expired', 'cancelled')
  ),
  stripe_customer_id text,
  -- Meta
  language text DEFAULT 'pl',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)

-- Starty w kalendarzu
race_calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  name text NOT NULL,
  date date NOT NULL,
  series text,                 -- 'GWS', 'GFWS', 'MTB', 'other'
  distance_km integer,
  elevation_m integer,
  priority text CHECK (priority IN ('A', 'B', 'C')),  -- A = główny cel
  notes text,
  created_at timestamptz DEFAULT now()
)

-- Tygodniowe plany treningowe
weekly_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  plan_json jsonb NOT NULL,
  -- Metryki w momencie generowania
  ctl_at_generation decimal(6,2),
  atl_at_generation decimal(6,2),
  tsb_at_generation decimal(6,2),
  weekly_tss_target integer,
  -- Trigger
  generated_by text CHECK (generated_by IN ('auto_monday', 'manual', 'checkin')),
  -- AI
  ai_model text,
  tokens_used integer,
  created_at timestamptz DEFAULT now()
)

-- Cotygodniowy check-in zawodnika
weekly_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  -- WHOOP (opcjonalne)
  rhr_bpm integer,
  sleep_hours decimal(3,1),
  hrv integer,
  -- Subiektywne (wymagane)
  fatigue_score integer CHECK (fatigue_score BETWEEN 1 AND 10),
  legs_feeling text CHECK (legs_feeling IN ('fresh', 'normal', 'heavy', 'dead')),
  motivation text CHECK (motivation IN ('high', 'normal', 'low')),
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(athlete_id, week_start)
)

-- Sesje chat
chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  session_type text CHECK (session_type IN ('weekly_checkin', 'free_chat', 'race_analysis')),
  messages jsonb NOT NULL DEFAULT '[]',
  tokens_used integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)

-- Historia metryk fitness (CTL/ATL/TSB)
fitness_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  date date NOT NULL,
  ctl decimal(6,2),
  atl decimal(6,2),
  tsb decimal(6,2),
  daily_tss decimal(6,2),
  calculated_at timestamptz DEFAULT now(),
  UNIQUE(athlete_id, date)
)

-- Cache aktywności Strava
strava_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  strava_activity_id bigint UNIQUE NOT NULL,
  activity_date date NOT NULL,
  name text,
  type text,
  distance_km decimal(6,2),
  duration_seconds integer,
  elevation_m integer,
  avg_watts integer,
  max_watts integer,
  avg_hr integer,
  max_hr integer,
  avg_cadence integer,
  tss decimal(6,2),
  intensity_factor decimal(4,3),
  normalized_power integer,
  raw_data jsonb,
  synced_at timestamptz DEFAULT now()
)
```

---

## 10. System Prompt AI Trenera

Dynamicznie składany z 3 warstw przed każdym wywołaniem Claude API.

### Warstwa 1 — Tożsamość i filozofia (statyczna per dyscyplina)

```
Jesteś doświadczonym trenerem kolarskim specjalizującym się w [DYSCYPLINA].
Pracujesz w aplikacji VeloIQ. Pomagasz amatorom osiągać lepsze wyniki w zawodach.

FILOZOFIA TRENINGOWA — [GRAVEL/SZOSA/MTB]:

GRAVEL/SZOSA:
- Priorytet: moc progowa 20-60min ponad krótkie interwały 4min
- Struktura: 80% Z1/Z2 (baza tlenowa), 20% Z4/Z5 (intensywność)
- Kluczowe sesje: 2×20min threshold, over-under 3×16min, sweet spot górski
- Nigdy nie buduj planu opartego głównie na interwałach 4min dla zawodnika endurance
- Przed wyścigiem: TSB +25 do +40, tapering 5-7 dni

MTB:
- Priorytet: moc eksplozywna 30s-2min + baza tlenowa
- Więcej powtórzeń krótkich, ale interwały Z5-Z6 są tutaj uzasadnione
- Technika i kadencja pod różnym nachyleniem ważniejsza niż na szosie

UNIWERSALNE ZASADY:
- CTL/ATL/TSB to świętość — zawsze sprawdź TSB przed intensywnością
- Jeśli RHR +4 bpm powyżej bazy lub fatigue_score ≥ 8 → redukuj intensywność
- Zawsze tłumacz DLACZEGO dana sesja jest w planie
- Podawaj KONKRETNE liczby: "270-285W" lub "HR 164-172 bpm", nie "jedź na progu"
- Mów po ludzku — jesteś trenerem, nie robotem
- Odpowiadaj zawsze po polsku (MVP)

STREFY MOCY (FTP = 100%):
Z1 <55% | Z2 56-75% | Z3 76-90% | Z4 91-104% | Z5 105-120% | Z6 121-150% | Z7 >150%

STREFY HR (HRmax = 100%):
Z1 <70% | Z2 71-80% | Z3 81-87% | Z4 88-93% | Z5 94-100%
```

### Warstwa 2 — Profil zawodnika (dynamiczna)

```
ZAWODNIK: [name]
Dyscyplina: [discipline] | Kategoria wiekowa: [wiek]
[JEŚLI ma moc:] FTP: [ftp]W | W/kg: [ftp/weight] | HRmax: [hrmax] bpm | Waga: [weight]kg
[JEŚLI brak mocy:] HRmax: [hrmax] bpm | Waga: [weight]kg | TRENUJE NA HR (bez miernika mocy)
Tygodniowe godziny: [min]-[max]h | Dni: [dni] | Długie jazdy: [dni]

FORMA DZIŚ:
CTL: [ctl] | ATL: [atl] | TSB: [tsb] | Trend CTL: [+/-X/tydzień]

OSTATNIE 14 DNI:
[lista: data | typ | km | avg_W lub avg_HR | IF | TSS]

KALENDARZ STARTÓW:
[lista: nazwa | data | za X dni | priorytet A/B/C]

S�ABE PUNKTY: [weak_points]
CEL SEZONU: [goals]

[JEŚLI checkin istnieje dla tego tygodnia:]
CHECK-IN TEGO TYGODNIA:
RHR: [rhr] bpm | Sen: [sleep]h | HRV: [hrv]
Zmęczenie: [fatigue]/10 | Nogi: [legs] | Motywacja: [motivation]
Notatka zawodnika: "[notes]"
```

### Warstwa 3 — Notatka trenera (opcjonalna, faza 2)

```
[JEŚLI coach_note istnieje i < 14 dni:]
NOTATKA TRENERA ([coach_name], [specialization]):
"[coach_note]"
Uwzględnij tę wskazówkę w planie na ten tydzień.
```

---

## 11. Obliczanie CTL/ATL/TSB

```typescript
// lib/fitness.ts

// TSS dla aktywności z miernikiem mocy
export function calculateTSSfromPower(
  durationSeconds: number,
  normalizedPower: number,
  ftp: number
): number {
  const hours = durationSeconds / 3600;
  const intensityFactor = normalizedPower / ftp;
  return (durationSeconds * normalizedPower * intensityFactor) / (ftp * 3600) * 100;
}

// TSS z HR (gdy brak mocy) — metoda Banister
export function calculateTSSfromHR(
  durationSeconds: number,
  avgHR: number,
  hrmax: number,
  hrrest: number = 45  // typowe RHR dla kolarza
): number {
  const hours = durationSeconds / 3600;
  const hrReserve = (avgHR - hrrest) / (hrmax - hrrest);
  const estimatedIF = hrReserve * 0.89;
  return hours * Math.pow(estimatedIF, 2) * 100;
}

// CTL — 42-dniowa wykładnicza średnia krocząca
export function updateCTL(previousCTL: number, todayTSS: number): number {
  return previousCTL + (todayTSS - previousCTL) / 42;
}

// ATL — 7-dniowa wykładnicza średnia krocząca
export function updateATL(previousATL: number, todayTSS: number): number {
  return previousATL + (todayTSS - previousATL) / 7;
}

// TSB — forma/świeżość
export function calculateTSB(ctl: number, atl: number): number {
  return ctl - atl;
}

// Interpretacja TSB dla UI
export function interpretTSB(tsb: number): {
  label: string;
  color: string;
  emoji: string;
} {
  if (tsb > 25) return { label: 'Bardzo świeży', color: '#00E5A0', emoji: '🟢' };
  if (tsb > 5)  return { label: 'Świeży', color: '#00E5A0', emoji: '🟢' };
  if (tsb > -10) return { label: 'Normalny', color: '#4ECDC4', emoji: '🔵' };
  if (tsb > -20) return { label: 'Zmęczony', color: '#FF8C42', emoji: '🟡' };
  return { label: 'Przetrenowany', color: '#FF4757', emoji: '🔴' };
}

// Pełne przeliczenie historii CTL/ATL/TSB z listy aktywności
export function calculateFitnessHistory(
  activities: Array<{ date: string; tss: number }>,
  startCTL: number = 0,
  startATL: number = 0
): Array<{ date: string; ctl: number; atl: number; tsb: number }> {
  let ctl = startCTL;
  let atl = startATL;
  const result = [];

  // Generuj wszystkie dni (włącznie z dnями bez aktywności)
  // ...implementacja iteracji po dniach

  return result;
}
```

---

## 12. Struktura JSON planu tygodniowego

```json
{
  "week_start": "2026-06-15",
  "athlete_name": "Adrian",
  "ctl": 87, "atl": 62, "tsb": 25,
  "weekly_tss_target": 450,
  "weekly_hours_target": "11-12",
  "phase": "build",
  "summary": "Tydzień budujący — fokus na sesje progowe i długa górska w sobotę.",
  "days": [
    {
      "day": "monday",
      "date": "2026-06-15",
      "type": "rest",
      "title": "Odpoczynek",
      "description": "Dzień wolny lub 45 min bardzo spokojnie Z1 po płaskim.",
      "duration_minutes": 0,
      "tss_target": 0,
      "workout": null
    },
    {
      "day": "tuesday",
      "date": "2026-06-16",
      "type": "threshold",
      "title": "Threshold 2×20min",
      "description": "Kluczowa sesja tygodnia.",
      "duration_minutes": 90,
      "tss_target": 95,
      "intensity_factor": 0.82,
      "workout": {
        "has_power": true,
        "steps": [
          {
            "name": "Rozgrzewka",
            "duration_seconds": 900,
            "power_low": 150, "power_high": 200,
            "hr_low": 120, "hr_high": 145,
            "zone": "Z2", "rpe": 3
          },
          {
            "name": "Blok 1 — Próg",
            "duration_seconds": 1200,
            "power_low": 270, "power_high": 285,
            "hr_low": 164, "hr_high": 172,
            "zone": "Z4", "rpe": 7,
            "coaching_note": "Stabilna moc. Nie startuj za mocno."
          },
          {
            "name": "Przerwa aktywna",
            "duration_seconds": 300,
            "power_low": 130, "power_high": 160,
            "hr_low": 120, "hr_high": 145,
            "zone": "Z1", "rpe": 2
          },
          {
            "name": "Blok 2 — Próg",
            "duration_seconds": 1200,
            "power_low": 270, "power_high": 285,
            "hr_low": 164, "hr_high": 172,
            "zone": "Z4", "rpe": 7,
            "coaching_note": "Jeśli nie dajesz rady — zejdź do 260W. Lepiej skończyć mocno niż siłować się."
          },
          {
            "name": "Chłodzenie",
            "duration_seconds": 600,
            "power_low": 120, "power_high": 155,
            "hr_low": 110, "hr_high": 135,
            "zone": "Z1", "rpe": 2
          }
        ],
        "coaching_note": "To jest Twoja najważniejsza sesja tygodnia. Wszystko inne jest podporządkowane tej jeździe."
      }
    }
  ],
  "week_summary": {
    "total_tss": 450,
    "total_hours": "11h 30min",
    "intensity_distribution": {
      "z1_z2_percent": 78,
      "z3_percent": 8,
      "z4_z5_percent": 14
    },
    "key_sessions": ["Threshold 2×20min (wt)", "Sweet spot górski (sob)"],
    "coaching_summary": "Solidny tydzień budujący. Kluczowe to nie odpuszczać wtorku.",
    "next_week_preview": "Szczyt obciążenia — TSS ~520, dochodzi over-under w czwartek."
  }
}
```

---

## 13. Cotygodniowy check-in

Zawodnik wypełnia opcjonalnie przed poniedziałkowym planem (lub kiedy chce):

```
┌─────────────────────────────────────┐
│  CHECK-IN — TYDZIEŃ 23 CZERWCA      │
├─────────────────────────────────────┤
│  Jak się czujesz? (1-10)            │
│  ○ 1  ○ 2  ○ 3  ● 4  ○ 5 ... ○ 10 │
│                                     │
│  Nogi?                              │
│  [Świeże] [Normalne] [Ciężkie] ...  │
│                                     │
│  Motywacja?                         │
│  [Wysoka] [Normalna] [Niska]        │
│                                     │
│  Dane z WHOOP (opcjonalne):         │
│  RHR: [___] bpm  Sen: [___] h       │
│                                     │
│  Coś ważnego? (max 300 znaków)      │
│  [________________________]         │
│                                     │
│  [Wyślij i generuj plan]            │
└─────────────────────────────────────┘
```

---

## 14. Struktura projektu

```
veloiq/
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx           # Logowanie przez Strava
│   ├── (onboarding)/
│   │   └── setup/
│   │       └── [step]/page.tsx      # 7 kroków onboardingu
│   ├── (app)/
│   │   ├── layout.tsx               # Shell z bottom nav
│   │   ├── dashboard/page.tsx       # Ekran główny WHOOP-style
│   │   ├── plan/page.tsx            # Tygodniowy plan treningowy
│   │   ├── chat/page.tsx            # Chat z AI trenerem
│   │   ├── history/page.tsx         # Historia + wykresy PMC
│   │   └── profile/
│   │       ├── page.tsx             # Profil i ustawienia
│   │       └── races/page.tsx       # Kalendarz startów
│   └── api/
│       ├── strava/
│       │   ├── auth/route.ts        # Inicjacja OAuth
│       │   ├── callback/route.ts    # OAuth callback
│       │   └── sync/route.ts        # Sync aktywności (cron + manual)
│       ├── ai/
│       │   ├── chat/route.ts        # Free chat (streaming)
│       │   └── weekly-plan/route.ts # Generowanie planu (JSON)
│       ├── fitness/
│       │   └── metrics/route.ts     # CTL/ATL/TSB obliczenia
│       └── cron/
│           └── monday-plan/route.ts # Auto-plan poniedziałek 7:00
├── components/
│   ├── dashboard/
│   │   ├── FitnessRing.tsx          # Kółka CTL/ATL/TSB (WHOOP-style)
│   │   ├── MetricCard.tsx           # Karta pojedynczej metryki
│   │   ├── NextSession.tsx          # Karta następnej sesji
│   │   ├── RaceCountdown.tsx        # Odliczanie do startu
│   │   └── LastActivity.tsx         # Ostatnia aktywność
│   ├── plan/
│   │   ├── WeeklyPlan.tsx           # 7-dniowy plan
│   │   ├── DayCard.tsx              # Karta dnia
│   │   └── WorkoutSteps.tsx         # Kroki sesji z watami/HR
│   ├── chat/
│   │   ├── ChatInterface.tsx        # Główny chat (streaming)
│   │   ├── MessageBubble.tsx        # Wiadomość user/AI
│   │   └── CheckinForm.tsx          # Formularz check-in
│   ├── history/
│   │   ├── PMCChart.tsx             # Performance Management Chart
│   │   └── WeeklyLoadBars.tsx       # Słupki TSS tygodniowego
│   └── ui/                          # Komponenty bazowe (Button, Card, Input...)
├── lib/
│   ├── anthropic.ts                 # Client + buildSystemPrompt()
│   ├── strava.ts                    # Strava API wrapper + OAuth
│   ├── fitness.ts                   # CTL/ATL/TSB kalkulacje
│   └── supabase.ts                  # Supabase client (server + browser)
├── types/
│   ├── athlete.ts
│   ├── workout.ts
│   └── fitness.ts
└── messages/
    └── pl.json                      # Tłumaczenia PL (MVP)
```

---

## 15. API Endpoints

### POST /api/ai/weekly-plan
Generuje tygodniowy plan. Zwraca JSON planu.

**Kolejność operacji:**
1. Autoryzuj zawodnika (Supabase session)
2. Sprawdź status subskrypcji (trial/active)
3. Sync ostatnich 14 dni ze Strava (jeśli ostatni sync > 1h temu)
4. Oblicz CTL/ATL/TSB
5. Pobierz profil + starty + check-in tygodnia
6. Zbuduj system prompt (3 warstwy)
7. Wywołaj Claude API z prośbą o JSON planu
8. Waliduj JSON odpowiedzi
9. Zapisz do `weekly_plans`
10. Zaktualizuj `fitness_metrics`
11. Zwróć plan do frontendu

### POST /api/ai/chat (streaming)
Free chat. Używa `streamText` z Anthropic SDK.

**Limit:** 20 wiadomości/dzień na zawodnika (sprawdź w middleware).

### GET /api/strava/sync
Syncuje aktywności ze Strava. Cache w `strava_activities`.

**Strava rate limits:** 100 req/15min, 1000/dzień. Zawsze sprawdzaj `synced_at` przed synciem.

### POST /api/cron/monday-plan
Uruchamiany automatycznie w poniedziałek 07:00 CET przez Vercel Cron.
Generuje plany dla wszystkich aktywnych zawodników.
Zabezpieczony `CRON_SECRET` w headerze.

---

## 16. Bezpieczeństwo

```typescript
// Rate limiting
const LIMITS = {
  chat_messages_per_day: 20,
  plan_regenerations_per_week: 3,
  strava_sync_cooldown_minutes: 60,
  max_chat_history_messages: 15,  // wysyłane do Claude
}

// Supabase RLS — kluczowe zasady:
// - Zawodnik widzi TYLKO swoje dane (athlete_id = auth.uid())
// - Brak wyjątków — RLS od pierwszego dnia
// - Service role key TYLKO po stronie serwera (API routes)
// - Nigdy nie używaj service role key po stronie klienta
```

---

## 17. Zmienne środowiskowe

```bash
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Strava OAuth
STRAVA_CLIENT_ID=12345
STRAVA_CLIENT_SECRET=abc123
NEXT_PUBLIC_STRAVA_REDIRECT_URI=https://veloiq.app/api/strava/callback

# Cron
CRON_SECRET=losowy-tajny-string-min-32-znaki

# App
NEXT_PUBLIC_APP_URL=https://veloiq.app
NEXT_PUBLIC_APP_NAME=VeloIQ
```

---

## 18. Fazy wdrożenia

### FAZA 1 — MVP (priorytet)
- [ ] Inicjalizacja projektu Next.js 14 + TypeScript + Tailwind
- [ ] Supabase: tabele + RLS + Auth
- [ ] Strava OAuth — login i sync aktywności
- [ ] Obliczanie CTL/ATL/TSB z historii Strava
- [ ] Onboarding 7 kroków
- [ ] Dashboard w stylu WHOOP (dark mode)
- [ ] Cotygodniowy plan AI (manual trigger)
- [ ] Chat z AI trenerem (streaming)
- [ ] Formularz check-in tygodniowego
- [ ] Widok planu tygodniowego z sesjami
- [ ] Historia + wykres PMC
- [ ] Kalendarz startów
- [ ] Trial 14 dni (bez Stripe — ręczna aktywacja)
- [ ] Deploy na Vercel

### FAZA 2
- [ ] Stripe — płatności subskrypcyjne
- [ ] Cron auto-plan poniedziałek 7:00
- [ ] Eksport FIT dla Garmina
- [ ] Integracja intervals.icu (auto-sync Garmin)
- [ ] Panel trenera + notatki dla AI
- [ ] Powiadomienia email (nowy plan)
- [ ] Angielska wersja językowa

### FAZA 3
- [ ] Plan Basic €19 (zakres do ustalenia)
- [ ] TrainingPeaks API (oficjalne partnerstwo)
- [ ] Analiza wyścigu po fakcie (upload FIT/GPX)
- [ ] PWA (aplikacja mobilna)

---

## 19. Uwagi dla Claude Code — jak budować

1. **Zacznij od fundamentów:** `supabase init` → tabele SQL → RLS → Strava OAuth. Bez tego nic nie działa.

2. **`buildSystemPrompt()` to serce aplikacji** — napisz ją starannie w `/lib/anthropic.ts`. Zły prompt = złe plany = niezadowoleni klienci.

3. **Dark mode od początku** — Tailwind `dark:` klasy, kolory z palety VeloIQ (#0A0A0F tło, #00E5A0 akcent).

4. **Streaming chatu** — użyj `streamText` z `@anthropic-ai/sdk`, nie czekaj na pełną odpowiedź.

5. **Strava cache** — NIGDY nie odpytuj Strava przy każdym requescie. Zawsze zapisuj do `strava_activities` i używaj cache.

6. **CTL/ATL/TSB po stronie serwera** — obliczaj w API route, wyniki zapisuj do `fitness_metrics`. Frontend tylko wyświetla.

7. **Mobile-first** — bottom navigation, karty na pełną szerokość, duże cyfry jak w WHOOP.

8. **Walidacja JSON planów** — Claude czasem zwraca niepoprawny JSON. Zawsze owijaj parse w try/catch i miej fallback.

9. **Testuj system prompt na prawdziwych danych** przed wdrożeniem — użyj danych Adriana z tej specyfikacji jako test case.

10. **RLS od pierwszego commita** — nie "dodamy później". Naruszenie RLS w produkcji = katastrofa.

---

## 20. Test case — dane do testowania systemu promptu

Użyj tych danych aby przetestować czy AI generuje sensowne plany:

```
Zawodnik: Adrian, gravel, M19-34
FTP: 289W | HRmax: 189 bpm | Waga: 67kg (4.31 W/kg)
Godziny: 10-12h/tydzień | Długie jazdy: sob + nie
CTL: 87 | ATL: 62 | TSB: +25
S�abe punkty: moc progowa 20-60min, taktyka wyścigowa (za konserwatywny)
Cel: kwalifikacja UCI GWS M19-34, luka 29 minut
Najbliższy start: GT3 Lavaredo za 10 dni (PRIORYTET A)
Check-in: zmęczenie 4/10, nogi normalne, motywacja wysoka

OCZEKIWANY PLAN:
- Poniedziałek: odpoczynek (przed wyścigiem)
- Wtorek: krótka aktywacja Z2 + 4×30s sprint (tapering)
- Środa: Z2 górska 2h HR max 160
- Czwartek: aktywacja FTP 3×5min @285W
- Piątek: OFF + wyjazd do Włoch
- Sobota: rekonesans trasy 60min Z1
- Niedziela: WYŚCIG GT3 Lavaredo
```

---

## 21. Moduł Race Intelligence — analiza trasy i taktyka wyścigowa

### Kluczowa przewaga konkurencyjna VeloIQ
Żaden TrainingPeaks, Garmin Coach ani Wahoo nie oferuje: analizy GPX + taktyki km po km + żywienia + opon w jednym miejscu. To jest rdzeń produktu.

### 21.1 Źródło trasy
- **Ręczne wgrywanie:** zawodnik uploaduje plik GPX lub FIT trasy
- **Automatyczne pobieranie:** AI próbuje pobrać trasę z publicznych źródeł (Strava Route, Komoot, strona organizatora) na podstawie nazwy wyścigu z kalendarza startów
- Trasa przypisana do konkretnego wyścigu w `race_calendar`

### 21.2 Co AI analizuje z GPX
```typescript
interface RouteAnalysis {
  // Podstawowe dane
  total_distance_km: number;
  total_elevation_m: number;
  estimated_duration_minutes: number; // na podstawie FTP zawodnika

  // Profile podjazdów
  climbs: Array<{
    start_km: number;
    end_km: number;
    length_km: number;
    elevation_m: number;
    avg_gradient_percent: number;
    max_gradient_percent: number;
    difficulty: 'easy' | 'medium' | 'hard' | 'brutal';
    tactical_note: string; // np. "Kluczowy podjazd — tu rozstrzygnie się wyścig"
  }>;

  // Nawierzchnia (gravel/szosa/MTB)
  surface_segments: Array<{
    start_km: number;
    end_km: number;
    surface: 'asphalt' | 'gravel' | 'dirt' | 'technical' | 'cobbles';
  }>;

  // Taktyka
  tactical_plan: Array<{
    km_from: number;
    km_to: number;
    phase: 'warmup' | 'conservative' | 'attack' | 'recover' | 'final_push';
    target_if: number;       // np. 0.72
    target_watts?: number;   // jeśli ma power meter
    target_hr?: number;      // jeśli brak power metera
    note: string;            // np. "Oszczędzaj — długi płaski przed finałowym podjazdem"
  }>;

  // Porównanie z celem
  target_finish_time: string;     // np. "4:22:00" dla top 25% M19-34
  required_avg_watts: number;     // co musisz utrzymać
  required_if: number;            // np. 0.77
  gap_to_target_minutes: number;  // ile minut do celu
}
```

### 21.3 Jak analiza wpływa na plan treningowy
Gdy zawodnik ma wyścig w kalendarzu z załączoną trasą, AI automatycznie:
- Identyfikuje kluczowe podjazdy i dostosowuje sesje sweet spot do ich długości i nachylenia
- Jeśli trasa ma dużo krótkich stromych podejść → więcej over-under i mocy 3-5min
- Jeśli trasa ma długie podjazdy → więcej bloków 20-30min progowych
- Tworzy symulacyjną sesję "race rehearsal" 2 tygodnie przed startem

### 21.4 Pro tipy oponowe

**GRAVEL:**
```
Nawierzchnia mieszana (asfalt + gravel):
- Rozmiar: 38-42mm
- Opona: semi-slick (np. Pirelli Cinturato Gravel S, Vittoria Terreno Dry)
- Ciśnienie: [waga_kg × 0.065] bar przód / [waga_kg × 0.070] bar tył
- Tubeless: TAK — obowiązkowo

Pełny gravel / dirt:
- Rozmiar: 40-45mm
- Opona: agresywny bieżnik (np. Pirelli Cinturato Gravel M, Schwalbe G-One Bite)
- Ciśnienie: [waga_kg × 0.055] bar przód / [waga_kg × 0.060] bar tył

Mokro / błoto:
- Ciśnienie -0.2 bar od standardowego
- Opona: max agresja (Vittoria Terreno Wet, WTB Raddler)
```

**SZOSA:**
```
Sucho / asfalt:
- Rozmiar: 25-28mm
- Opona: slick/semi-slick (Pirelli P Zero Race, Continental GP5000)
- Ciśnienie: [waga_kg × 0.085] bar przód / [waga_kg × 0.090] bar tył

Mokro:
- Ciśnienie -0.3 bar
- Opona: Continental GP5000 All Season, Pirelli P Zero Race 4S
```

**MTB (XCO/XCM):**
```
Sucho / twarde:
- Rozmiar: 2.25-2.35"
- Opona: Maxxis Ikon / XR2, Schwalbe Racing Ralph
- Ciśnienie: przód 1.6-1.8 bar / tył 1.8-2.0 bar (waga zależna)

Mokro / miękkie:
- Opona: Maxxis Minion DHF/DHR, Schwalbe Magic Mary
- Ciśnienie: przód 1.4-1.6 bar / tył 1.6-1.8 bar
```

Ciśnienia zawsze przeliczane na wagę zawodnika z `athletes.weight_kg`.

---

## 22. Moduł Nutrition — Na rowerze podczas wyścigu

### Plan żywieniowy generowany per wyścig

Na podstawie: waga zawodnika, szacowany czas wyścigu, IF trasy, temperatura.

```typescript
interface RaceNutritionPlan {
  athlete_weight_kg: number;
  race_duration_hours: number;
  estimated_calories_burned: number;

  // Cele żywieniowe
  carbs_per_hour_g: number;      // np. 80-90g/h dla wyścigu >3h
  fluids_per_hour_ml: number;    // np. 500-750ml/h
  sodium_per_hour_mg: number;    // np. 500-700mg/h

  // Plan godzinowy
  hourly_plan: Array<{
    hour: number;               // 1, 2, 3...
    km_approx: number;
    carbs_g: number;
    products: Array<{
      type: 'gel' | 'bar' | 'drink' | 'real_food' | 'chew';
      name: string;             // np. "Maurten Gel 100"
      brand: string;            // np. "Maurten"
      quantity: number;
      carbs_g: number;
      calories: number;
      note: string;             // np. "Przed długim podjazdem — +10 min wcześniej"
    }>;
    fluids_ml: number;
    note: string;
  }>;

  // Rekomendowane produkty (marki)
  recommended_products: {
    gels: string[];      // ["Maurten Gel 100", "SiS GO Isotonic", "Namedsport Total Energy"]
    bars: string[];      // ["Clif Bar", "Chimpanzee Bar", "Trek Bar"]
    drinks: string[];    // ["Maurten Drink Mix 160", "SiS GO Electrolyte", "4Endurance Pro"]
    real_food: string[]; // ["ryżowe kulki", "bananowe ciastka", "daktyle"]
  };

  // Specjalne wskazówki
  warnings: string[];   // np. "Wysoka temperatura — zwiększ sód o 20%"
  pro_tips: string[];   // np. "Zjedz żel 5min przed każdym kluczowym podjazdem"
}
```

---

## 23. Moduł Nutrition — Poza rowerem

### 23.1 Żywienie codzienne (dopasowane do dnia treningowego)

AI generuje propozycje posiłków per dzień tygodnia na podstawie TSS planowanego dnia:

```
DZIEŃ LEKKI (TSS < 50, Z1/Z2):
Kalorie: masa_ciała × 33 kcal
Węgle: 4-5g/kg | Białko: 1.6g/kg | Tłuszcze: 1.2g/kg

Przykład (70kg):
Śniadanie: Owsianka z bananem i miodem (450 kcal, 72g węgli)
Lunch: Ryż z kurczakiem i warzywami (550 kcal, 65g węgli)
Kolacja: Łosoś z batatami i brokułami (480 kcal, 45g węgli)
Przekąski: Garść orzechów + jabłko (200 kcal)

DZIEŃ CIĘŻKI (TSS > 100, Z4/Z5):
Kalorie: masa_ciała × 42 kcal
Węgle: 7-8g/kg | Białko: 1.8g/kg | Tłuszcze: 1.0g/kg

DZIEŃ WYŚCIGOWY:
→ patrz protokół startowy poniżej
```

### 23.2 Protokół ładowania węglami (2 dni przed wyścigiem)

```
DZIEŃ -2 (48h przed startem):
Cel: Wypełnienie glikogenu mięśniowego
Węgle: 8-10g/kg masy ciała
Białko: 1.4g/kg (zredukowane — mniej mięsa)
Tłuszcze: 0.8g/kg (zredukowane)
Trening: TYLKO Z1 lub odpoczynek
Unikać: błonnik, surowe warzywa, produkty ciężkostrawne

Przykładowy jadłospis (67kg = ~600g węgli):
07:00 Śniadanie: Owsianka 100g + banan + miód + sok pomarańczowy (120g węgli)
10:00 Przekąska: 2× tosty z dżemem + izotonik (60g węgli)
13:00 Lunch: Makaron 200g (suchy) z lekkim sosem pomidorowym (160g węgli)
16:00 Przekąska: Ryżowe wafle × 4 + banan (70g węgli)
19:00 Kolacja: Ryż 200g (suchy) z kurczakiem (bez skóry) (160g węgli)
21:00 Wieczór: Bułka z miodem + sok (30g węgli)

DZIEŃ -1 (24h przed startem):
Węgle: 10-12g/kg — szczyt ładowania
Posiłki: jak wyżej + zwiększone porcje makaronu/ryżu
Nawodnienie: 35-40ml/kg wody + elektrolity
Kawa: TAK ale max 1-2 (nie odwadnia przy małych ilościach)
Alkohol: NIE
```

### 23.3 Protokół startowy — dzień wyścigu

Generowany na podstawie godziny startu z kalendarza zawodów:

```
[START: 09:00]

DZIEŃ -1 wieczór (21:00):
Ostatni duży posiłek: makaron/ryż + źródło białka
Cel: 150-200g węgli, lekkostrawne

DZIEŃ STARTU:
06:00 (3h przed) — ŚNIADANIE GŁÓWNE:
  Owsianka 80g + banan + 2 łyżki miodu + mleko roślinne
  Opcja 2: Ryż 150g (ugotowany) + dżem + sok
  Kalorie: 600-700 kcal | Węgle: 100-120g
  UNIKAĆ: błonnik, tłuste mięso, nabiał, jajka na twardo

07:30 (1.5h przed) — PRZEKĄSKA:
  Banan + żel energetyczny (np. Maurten Gel 100)
  lub ryżowe wafle × 3 + izotonik
  Węgle: 50-60g

08:30 (30min przed) — AKTYWACJA:
  Żel kofeinowy (np. SiS GO + Caffeine 75mg)
  lub kawa espresso + data bar
  Węgle: 25-30g | Kofeina: 75-150mg

08:45 (15min przed) — Rozgrzewka + ostatni łyk izotonika

09:00 — START
  Pierwsze żywienie: już po 30-40 minutach (nie czekaj na głód)
```

### 23.4 Cel wagowy (opcjonalne)

```typescript
interface WeightGoal {
  current_weight_kg: number;
  target_weight_kg: number;
  target_date: string;          // np. data głównego wyścigu
  mode: 'reduce' | 'maintain' | 'performance_only';
}
```

- `reduce`: AI obniża kalorie o max 200-300 kcal/dzień — nigdy nie schodzi poniżej BMR
- `maintain`: kalorie = wydatek energetyczny
- `performance_only`: kalorie pod wydolność, waga wtórna
- **Ważne:** AI nigdy nie zaleca <1600 kcal/dzień. Bezpieczeństwo > wyniki.

---

## 24. Moduł Biometria — dane zdrowotne

### 24.1 Ręczne wprowadzanie danych (MVP)

Formularz dostępny z dashboardu — zawodnik wpisuje rano przed treningiem:

```typescript
interface DailyBiometrics {
  athlete_id: string;
  date: string;
  // Dane urządzenia (WHOOP / Garmin / ręczne)
  rhr_bpm?: number;             // Tętno spoczynkowe
  hrv_ms?: number;              // HRV (np. 45ms)
  sleep_hours?: number;         // Całkowity sen
  sleep_quality?: 1|2|3|4|5;   // Subiektywna jakość 1-5
  recovery_score?: number;      // WHOOP recovery 0-100 lub Garmin Body Battery
  respiratory_rate?: number;    // Częstość oddechu (WHOOP)
  // Subiektywne
  energy_level?: 1|2|3|4|5;    // Poziom energii
  muscle_soreness?: 1|2|3|4|5; // Zakwasy/ból mięśni
  stress_level?: 1|2|3|4|5;    // Stres życiowy
  notes?: string;               // Wolny tekst
}
```

### 24.2 Jak AI reaguje na dane biometryczne

```
SYGNAŁ                          REAKCJA AI
─────────────────────────────────────────────────────
RHR ≤ baseline (norma)          Plan bez zmian
RHR +2-3 bpm powyżej normy      Obniż intensywność o 1 strefę
RHR +4+ bpm powyżej normy       Zamień na Z1 lub OFF
HRV < -20% od 7-dniowej avg     Obniż intensywność o 1 strefę
Recovery score < 33% (WHOOP)    Zamień na Z1 lub OFF
Recovery score 34-66%           Plan bez zmian lub lekkszy
Recovery score > 66%            Plan bez zmian, opcjonalnie mocniej
Sen < 6h noc przed intensywną   Przesuń sesję lub zamień na Z2
Zakwasy 4-5/5                   Usuń sesję nóg, dodaj recovery ride
Stres 5/5 przez 3+ dni          Zredukuj TSS tygodnia o 20%
```

### 24.3 Automatyczny import (Faza 2)
- WHOOP API → automatyczny import RHR, HRV, sen, recovery score
- Garmin Health API → Body Battery, stress, sen
- Zawodnik łączy konto raz → dane spływają automatycznie każdego ranka

---

## 25. Moduł Obciążenie — suwak tygodniowy

### UI — suwak na ekranie planu

```
┌─────────────────────────────────────────────┐
│  PLAN TYGODNIA — 16-22 CZERWCA              │
│                                             │
│  Obciążenie tygodnia:                       │
│  Lżejszy ◄────────●──────────► Cięższy     │
│           8h      11h          15h          │
│                                             │
│  Aktualnie: 11h | TSS cel: ~450             │
│                                             │
│  [Regeneruj plan]                           │
└─────────────────────────────────────────────┘
```

### Logika suwaka

```typescript
interface LoadAdjustment {
  current_hours: number;    // aktualne ustawienie suwaka
  min_hours: number;        // 8h — minimum
  max_hours: number;        // 15h — maksimum (z profilu)
  tss_target: number;       // obliczony z godzin i CTL/ATL

  // AI bierze pod uwagę przy regeneracji planu:
  // 1. Nowe godziny z suwaka
  // 2. Aktualny CTL/ATL/TSB
  // 3. Dni do najbliższego wyścigu
  // 4. Ostatnie dane biometryczne
  // 5. Poprzedni tydzień (nie przeciążaj po ciężkim)
}
```

Zmiana suwaka → przycisk "Regeneruj plan" → nowe wywołanie Claude API z zaktualizowanym kontekstem → nowy plan zastępuje stary (stary archiwizowany).

---

## 26. Aktualizacja onboardingu — nowe pola

Dodaj do Kroku 2 (Cel sezonu):
```
Cel wagowy (opcjonalne):
[ ] Chcę schudnąć — cel: ___ kg do ___ (data)
[ ] Utrzymać wagę
[ ] Skupiam się tylko na wydolności
```

Dodaj do Kroku 4 (Dane fizyczne):
```
Baseline RHR (opcjonalne): ___ bpm
(znajdziesz w WHOOP lub Garmin po 7 dniach noszenia)
```

Dodaj do Kroku 7 (Sprzęt):
```
Czy masz: [WHOOP] [Garmin z Body Battery] [Oura Ring] [inne HRV]
```

---

## 27. Aktualizacja bazy danych — nowe tabele

```sql
-- Trasy wyścigowe
race_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid REFERENCES race_calendar(id) ON DELETE CASCADE,
  source text CHECK (source IN ('manual_upload', 'auto_fetched')),
  gpx_data text,                    -- surowy GPX XML
  route_analysis jsonb,             -- wynik analizy AI (RouteAnalysis)
  total_distance_km decimal(6,2),
  total_elevation_m integer,
  surface_type text,                -- 'gravel', 'road', 'mtb', 'mixed'
  analyzed_at timestamptz,
  created_at timestamptz DEFAULT now()
)

-- Plany wyścigowe (taktyka + żywienie + opony)
race_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  race_id uuid REFERENCES race_calendar(id) ON DELETE CASCADE,
  route_id uuid REFERENCES race_routes(id),
  -- Taktyka
  tactical_plan jsonb,              -- km po km
  target_finish_time interval,
  target_avg_watts integer,
  target_if decimal(4,3),
  -- Żywienie na rowerze
  race_nutrition_plan jsonb,
  -- Żywienie poza rowerem
  carbo_loading_plan jsonb,         -- 2 dni przed
  race_day_nutrition jsonb,         -- śniadanie + godziny
  -- Opony
  tire_recommendations jsonb,
  -- AI
  ai_model text,
  tokens_used integer,
  created_at timestamptz DEFAULT now(),
  UNIQUE(athlete_id, race_id)
)

-- Dane biometryczne dzienne
daily_biometrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  date date NOT NULL,
  rhr_bpm integer,
  hrv_ms integer,
  sleep_hours decimal(3,1),
  sleep_quality smallint CHECK (sleep_quality BETWEEN 1 AND 5),
  recovery_score integer CHECK (recovery_score BETWEEN 0 AND 100),
  respiratory_rate decimal(4,1),
  energy_level smallint CHECK (energy_level BETWEEN 1 AND 5),
  muscle_soreness smallint CHECK (muscle_soreness BETWEEN 1 AND 5),
  stress_level smallint CHECK (stress_level BETWEEN 1 AND 5),
  notes text,
  source text DEFAULT 'manual' CHECK (source IN ('manual', 'whoop', 'garmin', 'oura')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(athlete_id, date)
)

-- Dane wagowe
weight_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  date date NOT NULL,
  weight_kg decimal(4,1) NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now()
)
```

---

## 28. Aktualizacja limitów i parametrów

```typescript
const LIMITS = {
  // Chat
  chat_messages_per_day: 30,          // zaktualizowane z 20
  max_chat_history_messages: 15,

  // Plany
  plan_regenerations_per_week: 3,     // + regeneracje przez suwak
  load_slider_regenerations_per_day: 5, // max zmian suwaka/dzień

  // Trial
  trial_days: 14,
  trial_requires_card: false,         // bez karty kredytowej
  data_retention_after_expiry_days: 30,

  // Dane biometryczne
  biometrics_history_days: 365,

  // GPX
  max_gpx_file_size_mb: 10,
  max_routes_per_race: 3,             // różne wersje trasy
}
```

---

## 29. Podsumowanie wszystkich modułów VeloIQ (MVP)

| Moduł | Status | Unikalność |
|-------|--------|------------|
| Dashboard WHOOP-style | MVP | ★★★ |
| Plan treningowy AI (CTL/ATL/TSB) | MVP | ★★★ |
| Chat z AI trenerem | MVP | ★★ |
| Analiza trasy GPX + taktyka km po km | MVP | ★★★★★ |
| Pro tipy oponowe per dyscyplina | MVP | ★★★★ |
| Żywienie na rowerze (produkty + marki) | MVP | ★★★★ |
| Carbo loading 2 dni przed startem | MVP | ★★★★★ |
| Protokół śniadania startowego | MVP | ★★★★ |
| Żywienie codzienne per dzień treningowy | MVP | ★★★ |
| Cel wagowy + kalorie | MVP | ★★ |
| Biometria ręczna (RHR/HRV/sen) | MVP | ★★★ |
| Suwak obciążenia tygodniowego | MVP | ★★★ |
| Panel trenera + notatki AI | Faza 2 | ★★★★ |
| Auto-import WHOOP/Garmin | Faza 2 | ★★★ |
| Eksport FIT na Garmin | Faza 2 | ★★★ |
| Stripe płatności | Faza 2 | — |
