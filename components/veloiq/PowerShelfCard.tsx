'use client';

import { useState } from 'react';
import { C, F, RADIUS } from '@/lib/theme';
import { CardLabel } from './CardLabel';
import type { Period, PowerDuration, PowerPeriodRecord } from '@/lib/dashboard-engagement';

// Rekordy mocy per okres (ETAP 3.5 v2). Segmented control Tydzień/Miesiąc/Sezon (stan lokalny, fade 180ms) —
// identyczny jak w RecordsCard. Kafle 5s/1min/5min/20min pokazują najlepszą moc w WYBRANYM okresie; podpis =
// dystans do rekordu SEZONU. Wartość == rekord sezonu → "rekord sezonu" (zielony, bold) + zielona ramka.
// Zielony akcent tylko jako informacja o rekordzie (BEZ glow). Kafle nie rosną (minmax(0,1fr)); brak danych → "—".

const PERIODS: { key: Period; label: string }[] = [
  { key: 'week', label: 'Tydzień' },
  { key: 'month', label: 'Miesiąc' },
  { key: 'season', label: 'Sezon' },
];
const DUR_LABEL: Record<PowerDuration, string> = { '5s': '5 s', '1min': '1 min', '5min': '5 min', '20min': '20 min' };

export function PowerShelfCard({ power }: { power: PowerPeriodRecord[] }) {
  const [period, setPeriod] = useState<Period>('week');
  const [fading, setFading] = useState(false);

  function switchTo(p: Period) {
    if (p === period) return;
    setFading(true);
    setTimeout(() => { setPeriod(p); setFading(false); }, 180);
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.card, padding: '1.05rem 1.15rem' }}>
      <CardLabel style={{ marginBottom: 12 }}>Rekordy mocy</CardLabel>

      {/* segmented control — identyczny komponent jak w RecordsCard */}
      <div style={{ display: 'flex', background: C.card2, borderRadius: 10, padding: 3, gap: 3 }}>
        {PERIODS.map((p) => {
          const on = p.key === period;
          return (
            <button
              key={p.key}
              onClick={() => switchTo(p.key)}
              style={{
                flex: 1, border: 'none', background: on ? C.card : 'transparent', color: on ? C.text : C.muted,
                fontFamily: F.body, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                padding: '0.4rem 0', borderRadius: 8, cursor: 'pointer', transition: 'background .2s, color .2s',
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* minmax(0,1fr) → kafle mają IDENTYCZNĄ szerokość i nie rosną od treści podpisu (nowrap). */}
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, opacity: fading ? 0 : 1, transition: 'opacity .18s ease' }}>
        {power.map((p) => {
          const val = p[period];
          const record = p.season;
          const isRecord = val != null && record != null && val >= record;
          const deficit = val != null && record != null && !isRecord ? record - val : null;
          return (
            <div
              key={p.dur}
              style={{
                textAlign: 'center', borderRadius: 12, padding: '0.7rem 0.35rem 0.56rem',
                background: C.card2,
                border: `1px solid ${isRecord ? C.green + '8C' : C.border}`, // 0x8C ≈ 0.55 alpha, bez glow
              }}
            >
              <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>{DUR_LABEL[p.dur]}</div>
              <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 700, marginTop: 4, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: isRecord ? C.green : C.text }}>
                {val != null ? val : '—'}{val != null && <span style={{ fontSize: 9, color: C.muted, fontWeight: 500 }}> W</span>}
              </div>
              {/* Podpis skrócony do "−12 W" — pełne "do rekordu" nie mieści się w 1 linii przy 4 kaflach/390px;
                  kontekst niesie nagłówek karty + stopka. Rekord: "rekord sezonu" (zielony, bold). */}
              <div style={{
                marginTop: 5, fontSize: 8.5, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden',
                fontVariantNumeric: 'tabular-nums',
                color: isRecord ? C.green : C.muted,
                fontWeight: isRecord ? 700 : 400,
              }}>
                {isRecord ? 'rekord sezonu' : deficit != null ? `−${deficit} W` : ' '}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 11, fontSize: 9.5, color: C.muted, textAlign: 'center' }}>Porównanie z najlepszym wynikiem sezonu</div>
    </div>
  );
}
