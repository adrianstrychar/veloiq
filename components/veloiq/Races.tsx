'use client';

import { C } from '@/lib/theme';
import { computeRacePrep, type CtlPoint } from '@/lib/race-prep';
import type { RacePriority } from '@/lib/race-taper';
import { countryFlag } from '@/lib/country-flag';
import RacePrepCard from './RacePrepCard';
import RaceStrategyView from './RaceStrategy';
import type { RaceStrategy } from '@/lib/ai/race-strategy';

export interface RaceRow {
  id: string;
  date: string;
  name: string;
  location: string | null;
  series: string | null;
  distance_km: number | null;
  elevation_m: number | null;
  discipline: string | null;
  priority: string | null; // 'A' | 'B' | 'C'
  target_ctl?: number | null;          // B1: ręczne nadpisanie targetu (null → default z race-prep)
  qualification_goal?: string | null;  // B1: tekst celu kwalifikacyjnego
}

interface RacesProps {
  races: RaceRow[];
  ctlSeries: CtlPoint[]; // dzienne CTL (fitness_metrics) — do pierścienia prep + sparkline
  today: string;         // 'YYYY-MM-DD' lokalne
  nextRaceStrategy: RaceStrategy | null; // strategia AI najbliższego startu (z race_plans; null = jeszcze brak)
}

// Liczba pełnych dni od dziś (UTC-safe, bez wpływu strefy) do daty wyścigu.
function daysUntil(dateStr: string): number {
  const today = new Date();
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const d = new Date(dateStr);
  const r = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((r - t) / 86_400_000);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pl-PL', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

const PRIORITY_LABEL: Record<string, string> = { A: 'CEL', B: 'WAŻNY', C: 'TRENINGOWY' };

const RACE_PRIORITIES = new Set(['A', 'B', 'C']);

export function Races({ races, ctlSeries, today, nextRaceStrategy }: RacesProps) {
  // Najbliższy start = pierwsza data >= dziś (lista przychodzi posortowana rosnąco).
  const nextRace = races.find((r) => daysUntil(r.date) >= 0);
  // Cel sezonu = priority 'A' z najdalszą datą (MŚ Nannup).
  const goalRace = races
    .filter((r) => r.priority === 'A')
    .reduce<RaceRow | null>((acc, r) => (!acc || r.date > acc.date ? r : acc), null);

  // Karta "NAJBLIŻSZY CEL" dla najbliższego startu z priorytetem (A/B/C) i danymi CTL.
  const prep = nextRace && RACE_PRIORITIES.has(nextRace.priority ?? '') && ctlSeries.length
    ? computeRacePrep({
        ctlSeries,
        raceDate: nextRace.date,
        priority: nextRace.priority as RacePriority,
        targetOverride: nextRace.target_ctl ?? null,
        today,
      })
    : null;
  const sparkline = ctlSeries.slice(-21).map((p) => {
    const d = new Date(p.date);
    return { label: `${d.getUTCDate()}.${d.getUTCMonth() + 1}`, ctl: p.ctl };
  });

  if (races.length === 0) {
    return (
      <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: '32px 0' }}>
        Brak zaplanowanych startów.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Karta "NAJBLIŻSZY CEL" nad listą */}
      {prep && nextRace && <RacePrepCard race={nextRace} prep={prep} sparkline={sparkline} />}

      {/* Strategia wyścigu AI — pod kartą celu, dla najbliższego startu */}
      {nextRace && (
        <RaceStrategyView
          race={{ id: nextRace.id, name: nextRace.name, distance_km: nextRace.distance_km, elevation_m: nextRace.elevation_m, discipline: nextRace.discipline }}
          initialStrategy={nextRaceStrategy}
        />
      )}

      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Starty</span>
        <span style={{ fontSize: 12, color: C.muted }}>{races.length} w kalendarzu</span>
      </header>

      {races.map((race) => {
        const days = daysUntil(race.date);
        const isNext = nextRace?.id === race.id;
        const isGoal = goalRace?.id === race.id;
        const isPast = days < 0;

        // Akcenty jak w mockupie: cel sezonu = red, najbliższy = green, reszta = cyan.
        const accent = isGoal ? C.red : isNext ? C.green : C.cyan;
        const flag = countryFlag(race.location);

        return (
          <div
            key={race.id}
            style={{
              background: C.card,
              border: `1px solid ${accent}`,
              borderRadius: 10,
              padding: isNext ? '16px 16px' : '12px 14px',
              display: 'flex', flexDirection: 'column', gap: 6,
              opacity: isPast ? 0.55 : 1,
            }}
          >
            {/* Górny pasek: badge statusu + odliczanie */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {isGoal && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: C.red, letterSpacing: '0.08em' }}>
                    🏆 CEL SEZONU
                  </span>
                )}
                {isNext && !isGoal && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: C.green, letterSpacing: '0.08em' }}>
                    NAJBLIŻSZY START
                  </span>
                )}
                {!isNext && !isGoal && race.priority && (
                  <span style={{ fontSize: 9, fontWeight: 600, color: C.muted, letterSpacing: '0.08em' }}>
                    {PRIORITY_LABEL[race.priority] ?? race.priority}
                  </span>
                )}
              </div>
              <span style={{ fontSize: isNext ? 12 : 10, color: isPast ? C.muted : accent, fontWeight: 600 }}>
                {isPast ? 'zakończony' : days === 0 ? 'DZIŚ' : `za ${days} dni`}
              </span>
            </div>

            {/* Nazwa (z flagą kraju) */}
            <div style={{ fontSize: isNext ? 18 : 14, fontWeight: 700, color: C.text }}>
              {flag ? `${flag} ` : ''}{race.name}
            </div>

            {/* Meta: data · lokalizacja · seria */}
            <div style={{ fontSize: 12, color: C.muted }}>
              {formatDate(race.date)}
              {race.location ? ` · ${race.location}` : ''}
              {race.series ? ` · ${race.series}` : ''}
            </div>

            {/* Dystans / przewyższenie / dyscyplina */}
            <div style={{ fontSize: 12, color: C.muted }}>
              {race.distance_km ? `${race.distance_km} km` : ''}
              {race.distance_km && race.elevation_m ? ' · ' : ''}
              {race.elevation_m ? `${race.elevation_m} m ↑` : ''}
              {race.discipline ? `${race.distance_km || race.elevation_m ? ' · ' : ''}${race.discipline}` : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}
