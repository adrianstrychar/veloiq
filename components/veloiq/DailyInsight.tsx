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

  // Styl 1:1 z mockupu (Dashboard 942-945): lewa cyjanowa krawędź, prawy zaokrąglony róg.
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${C.cyan}`,
        borderRadius: '0 12px 12px 0',
        paddingLeft: 14,
        padding: '12px 14px 12px 14px',
        marginBottom: 10,
      }}
    >
      <div style={{ fontSize: 9, color: C.cyan, letterSpacing: '0.12em', fontWeight: 600, marginBottom: 7 }}>
        AI INSIGHT
      </div>
      {text ? (
        <div style={{ fontSize: 13, lineHeight: 1.65, color: C.text }}>{text}</div>
      ) : (
        <div style={{ color: C.muted, fontSize: 13, fontStyle: 'italic' }}>Analizuję dane Strava...</div>
      )}
    </div>
  );
}
