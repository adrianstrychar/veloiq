# VeloIQ

Inteligentny asystent treningowy dla kolarzy amatorów. AI analizuje dane ze Strava, buduje spersonalizowane plany treningowe oparte na CTL/ATL/TSB i prowadzi chat z zawodnikiem jak prawdziwy trener.

> Twój AI trener. Zawsze gotowy.

Pełna specyfikacja produktu: [docs/AI_COACH_SPEC.md](docs/AI_COACH_SPEC.md)

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Supabase (PostgreSQL + Auth + RLS)
- Anthropic API (Claude)
- Strava API v3 (OAuth)
- Hosting: Vercel

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.
