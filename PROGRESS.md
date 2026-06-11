# VeloIQ — Postęp prac

Status budowy aplikacji względem [docs/AI_COACH_SPEC.md](docs/AI_COACH_SPEC.md).

## Zrobione

- **Scaffold projektu** — Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Supabase client** — `lib/supabase.ts` (klient przeglądarkowy, serwerowy z cookies, admin z service role)
- **Schemat bazy danych** — `supabase/migrations/001_initial_schema.sql`: wszystkie tabele z sekcji 9 i 27 (athletes, race_calendar, weekly_plans, weekly_checkins, chat_sessions, fitness_metrics, strava_activities, race_routes, race_plans, daily_biometrics, weight_tracking) + indeksy + Row Level Security
- **Strava OAuth** — `/api/strava/auth` (redirect) i `/api/strava/callback` (wymiana kodu, zapis tokenów do `athletes`)
- **Zmienne środowiskowe** — `.env.local.example` wg sekcji 17
- **Obliczenia CTL/ATL/TSB** — `lib/fitness.ts` (TSS z mocy/HR, EWMA, interpretacja TSB, historia fitness)
- **Sync aktywności Stravy** — `/api/strava/sync`: odświeżanie tokenu, cooldown 60 min, obliczanie TSS, zapis do `strava_activities`
- **Dashboard WHOOP-style** — `/dashboard`: dark mode, karty CTL/ATL/TSB, następna sesja, najbliższy start (priorytet A), ostatnia aktywność, bottom nav (Home/Plan/Chat/Historia/Profil)
- **Dane testowe** — `supabase/seed.sql` (profil "Adrian" z sekcji 20)

## Następne kroki

- [ ] Ekran logowania (`(auth)/login`) — logowanie przez Strava OAuth
- [ ] Onboarding — 7 kroków z sekcji 7
- [ ] `lib/anthropic.ts` — `buildSystemPrompt()` (3 warstwy z sekcji 10)
- [ ] `/api/ai/weekly-plan` — generowanie tygodniowego planu (sekcja 15)
- [ ] `/api/ai/chat` — chat z AI trenerem (streaming)
- [ ] Widok planu tygodniowego (`/plan`) — `WeeklyPlan`, `DayCard`, `WorkoutSteps`
- [ ] Formularz check-in tygodniowego
- [ ] Historia + wykres PMC (`/history`)
- [ ] Kalendarz startów (`/profile/races`)
- [ ] `/api/fitness/metrics` — przeliczanie i zapis CTL/ATL/TSB do `fitness_metrics`
- [ ] Profil i ustawienia (`/profile`)
- [ ] Trial 14 dni — logika statusu subskrypcji (bez Stripe na MVP)
- [ ] Deploy na Vercel
