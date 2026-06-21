'use client';

import { useEffect, useState } from 'react';
import { C } from '@/lib/theme';

export function DailyInsight() {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/ai/daily-insight')
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (d.insight) setText(d.insight);
        else setError(true);
      })
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, []);

  if (error) return null; // cicho — nie zaśmiecamy dashboardu gdy AI niedostępne

  return (
    <div
      style={{
        background: C.card,
        borderLeft: `3px solid ${C.cyan}`,
        border: `1px solid ${C.border}`,
        borderLeftWidth: 3,
        borderLeftColor: C.cyan,
        borderRadius: 8,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ fontSize: 9, color: C.cyan, textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 600 }}>
        Trener AI · forma na dziś
      </div>
      <div style={{ fontSize: 13, color: text ? C.text : C.muted, lineHeight: 1.45 }}>
        {text ?? 'Analizuję Twoją formę…'}
      </div>
    </div>
  );
}
