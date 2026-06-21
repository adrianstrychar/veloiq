'use client';

import { C } from '@/lib/theme';

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
}

interface RacesProps {
  races: RaceRow[];
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

export function Races({ races }: RacesProps) {
  // Najbliższy start = pierwsza data >= dziś (lista przychodzi posortowana rosnąco).
  const nextRace = races.find((r) => daysUntil(r.date) >= 0);
  // Cel sezonu = priority 'A' z najdalszą datą (MŚ Nannup).
  const goalRace = races
    .filter((r) => r.priority === 'A')
    .reduce<RaceRow | null>((acc, r) => (!acc || r.date > acc.date ? r : acc), null);

  if (races.length === 0) {
    return (
      <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: '32px 0' }}>
        Brak zaplanowanych startów.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Starty</span>
        <span style={{ fontSize: 12, color: C.muted }}>{races.length} w kalendarzu</span>
      </header>

      {races.map((race) => {
        const days = daysUntil(race.date);
        const isNext = nextRace?.id === race.id;
        const isGoal = goalRace?.id === race.id;
        const isPast = days < 0;
        const isPriorityA = race.priority === 'A';

        // Kolor akcentu: cel sezonu = yellow, najbliższy = cyan, A = purple, reszta = border.
        const accent = isGoal ? C.yellow : isNext ? C.cyan : isPriorityA ? C.purple : C.border;

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
                  <span style={{ fontSize: 9, fontWeight: 700, color: C.yellow, letterSpacing: '0.08em' }}>
                    🏆 CEL SEZONU
                  </span>
                )}
                {isNext && !isGoal && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: C.cyan, letterSpacing: '0.08em' }}>
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

            {/* Nazwa */}
            <div style={{ fontSize: isNext ? 18 : 14, fontWeight: 700, color: C.text }}>
              {race.name}
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
