'use client';

import { useState } from 'react';
import { C, F, RADIUS } from '@/lib/theme';
import { CardLabel } from './CardLabel';
import type { Period, PowerDuration, PowerPeriodRecord } from '@/lib/dashboard-engagement';

// Rekordy mocy per okres (ETAP 3.5 v3). Segmented control Tydzień/Miesiąc/Sezon (stan lokalny, fade 180ms) —
// identyczny jak w RecordsCard. Kafle 5s/1min/5min/20min = najlepsza moc w WYBRANYM okresie. Podpis:
//  · SEZON  → DATA rekordu ("14 lip"), bez zieleni (żaden kafel nie jest wyróżniony — to i tak rekordy).
//  · TYDZIEŃ/MIESIĄC → deficyt "−X W"; zieleń "rekord sezonu" TYLKO gdy jazda-rekordzistka padła w tym
//    oknie (recordIn*). Wartość==rekord, ale rekord poza oknem → zwykły deficyt "−0 W", bez zieleni.
// Zielony akcent niesie informację (rekord padł tu), bez glow. Kafle nie rosną (minmax(0,1fr)); brak → "—".

const PERIODS: { key: Period; label: string }[] = [
  { key: 'week', label: 'Tydzień' },
  { key: 'month', label: 'Miesiąc' },
  { key: 'season', label: 'Sezon' },
];
const DUR_LABEL: Record<PowerDuration, string> = { '5s': '5 s', '1min': '1 min', '5min': '5 min', '20min': '20 min' };
const MONTH_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

// "YYYY-MM-DD" → "14 lip" (małe litery, spójnie z resztą karty). null → pusty podpis.
function fmtDate(dateIso: string | null): string {
  if (!dateIso) return ' ';
  const [, m, d] = dateIso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTH_SHORT[m - 1]}`;
}

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
          // Zieleń "rekord sezonu" tylko gdy rekord PADŁ w wybranym okresie (nie w zakładce Sezon).
          const green = period === 'week' ? p.recordInWeek : period === 'month' ? p.recordInMonth : false;
          // Podpis wg zakładki: Sezon → data rekordu; inaczej → "rekord sezonu" (zieleń) albo deficyt "−X W".
          let caption: string;
          if (period === 'season') {
            caption = val != null ? fmtDate(p.seasonDate) : ' ';
          } else if (val == null) {
            caption = ' ';
          } else if (green) {
            caption = 'rekord sezonu';
          } else {
            caption = p.season != null ? `−${p.season - val} W` : ' '; // może być "−0 W" (rekord poza oknem)
          }
          return (
            <div
              key={p.dur}
              style={{
                textAlign: 'center', borderRadius: 12, padding: '0.7rem 0.35rem 0.56rem',
                background: C.card2,
                border: `1px solid ${green ? C.green + '8C' : C.border}`, // 0x8C ≈ 0.55 alpha, bez glow
              }}
            >
              <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>{DUR_LABEL[p.dur]}</div>
              <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 700, marginTop: 4, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: green ? C.green : C.text }}>
                {val != null ? val : '—'}{val != null && <span style={{ fontSize: 9, color: C.muted, fontWeight: 500 }}> W</span>}
              </div>
              {/* Podpis: data (Sezon) / "rekord sezonu" (zieleń) / deficyt "−X W". Nowrap, 1 linia @390px. */}
              <div style={{
                marginTop: 5, fontSize: 8.5, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden',
                fontVariantNumeric: 'tabular-nums',
                color: green ? C.green : C.muted,
                fontWeight: green ? 700 : 400,
              }}>
                {caption}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 11, fontSize: 9.5, color: C.muted, textAlign: 'center' }}>Porównanie z najlepszym wynikiem sezonu</div>
    </div>
  );
}
