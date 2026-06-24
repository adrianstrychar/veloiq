'use client';

import { useEffect, useState } from 'react';
import { C } from '@/lib/theme';

// Wspólny kafelek — fallback MUSI wyglądać identycznie jak AI Insight (ta sama ramka,
// padding, boczny akcent), żeby graceful degradation była niewidoczna jako degradacja.
const cardStyle: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderLeft: `3px solid ${C.cyan}`,
  borderRadius: '0 12px 12px 0',
  padding: '12px 14px',
  marginBottom: 10,
};
const headerStyle: React.CSSProperties = {
  fontSize: 9, letterSpacing: '0.12em', fontWeight: 600, marginBottom: 7,
};
const bodyStyle: React.CSSProperties = { fontSize: 13, lineHeight: 1.65, color: C.text };

export function DailyInsight({ fallback }: { fallback?: string }) {
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

  // AI niedostępne → statyczny advice jako WSKAZÓWKA (neutralny nagłówek, nie "AI INSIGHT").
  // Nigdy razem z AI Insight: albo AI, albo to — sprzeczność dwóch werdyktów niemożliwa.
  // Brak fallbacku → nic (jak wcześniej return null, nie zaśmiecamy dashboardu).
  if (error) {
    if (!fallback) return null;
    return (
      <div style={cardStyle}>
        <div style={{ ...headerStyle, color: C.muted }}>WSKAZÓWKA</div>
        <div style={bodyStyle}>{fallback}</div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={{ ...headerStyle, color: C.cyan }}>AI INSIGHT</div>
      {text ? (
        <div style={bodyStyle}>{text}</div>
      ) : (
        <div style={{ color: C.muted, fontSize: 13, fontStyle: 'italic' }}>Analizuję dane Strava...</div>
      )}
    </div>
  );
}
