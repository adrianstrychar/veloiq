'use client';

import { useState } from 'react';
import { C } from '@/lib/theme';
import { Races, type RaceRow } from './Races';
import { Calendar, type CalActivity } from './Calendar';

interface RacesViewProps {
  races: RaceRow[];
  activities: CalActivity[];
  ftp: number | null;
}

type View = 'list' | 'calendar';

export function RacesView({ races, activities, ftp }: RacesViewProps) {
  const [view, setView] = useState<View>('list'); // domyślnie Lista (Etap 4a)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Segmented control [Lista | Kalendarz] */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 4,
          background: C.dim,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: 4,
        }}
      >
        {(['list', 'calendar'] as View[]).map((v) => {
          const active = view === v;
          return (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                appearance: 'none',
                border: 'none',
                cursor: 'pointer',
                borderRadius: 7,
                padding: '8px 0',
                fontSize: 13,
                fontWeight: 600,
                color: active ? C.text : C.muted,
                background: active ? C.card : 'transparent',
                transition: 'background 120ms, color 120ms',
              }}
            >
              {v === 'list' ? 'Lista' : 'Kalendarz'}
            </button>
          );
        })}
      </div>

      {view === 'list' ? (
        <Races races={races} />
      ) : (
        <Calendar
          activities={activities}
          races={races}
          ftp={ftp}
          onRaceClick={() => setView('list')}
        />
      )}
    </div>
  );
}
