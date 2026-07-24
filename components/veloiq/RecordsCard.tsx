'use client';

import { useState } from 'react';
import { Route, Mountain, Clock } from 'lucide-react';
import { C, F, RADIUS } from '@/lib/theme';
import { CardLabel } from './CardLabel';
import type { Period, PeriodRecords } from '@/lib/dashboard-engagement';

// Rekordy per okres (ETAP 3.5). Segmented control Tydzień/Miesiąc/Sezon (stan lokalny, fade 160ms).
// Wszystkie 3 okresy policzone server-side (props) — klient tylko przełącza. Akcent kolorowy niesie
// informację (ikona metryki), reszta stonowana. Bez glow.

const PERIODS: { key: Period; label: string }[] = [
  { key: 'week', label: 'Tydzień' },
  { key: 'month', label: 'Miesiąc' },
  { key: 'season', label: 'Sezon' },
];

const DOW_PL = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const MONTH_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

// Data rekordu: w widoku tygodnia dzień tygodnia, w miesiącu/sezonie "D miesiąca".
function fmtDate(dateIso: string | null, period: Period): string {
  if (!dateIso) return '—';
  const [y, m, d] = dateIso.slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return period === 'week' ? DOW_PL[dt.getDay()] : `${d} ${MONTH_GEN[m - 1]}`;
}

const nf1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });

function hoursLabel(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function RecordsCard({ records }: { records: Record<Period, PeriodRecords> }) {
  const [period, setPeriod] = useState<Period>('week');
  const [fading, setFading] = useState(false);
  const r = records[period];

  function switchTo(p: Period) {
    if (p === period) return;
    setFading(true);
    setTimeout(() => { setPeriod(p); setFading(false); }, 160);
  }

  const rows: { icon: React.ReactNode; tint: string; title: string; value: string; unit: string; date: string | null }[] = [
    { icon: <Route size={15} color={C.cyan} strokeWidth={2} />, tint: C.cyan, title: 'Najdłuższa jazda', value: nf1.format(r.longestKm.value), unit: 'km', date: r.longestKm.date },
    { icon: <Mountain size={15} color={C.yellow} strokeWidth={2} />, tint: C.yellow, title: 'Największe przewyższenie', value: nf0.format(Math.round(r.biggestElevM.value)), unit: 'm', date: r.biggestElevM.date },
    { icon: <Clock size={15} color={C.green} strokeWidth={2} />, tint: C.green, title: 'Najdłuższy czas w ruchu', value: hoursLabel(r.longestMovingSec.value), unit: 'h', date: r.longestMovingSec.date },
  ];

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.card, padding: '1.05rem 1.15rem' }}>
      <CardLabel style={{ marginBottom: 12 }}>Twoje rekordy</CardLabel>

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

      <div style={{ marginTop: 10, opacity: fading ? 0 : 1, transition: 'opacity .16s ease' }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.6rem 0', borderBottom: i < 2 ? `1px solid ${C.border}` : 'none' }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: row.tint + '20' }}>
              {row.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: C.muted }}>{row.title}</div>
              <div style={{ fontFamily: F.display, fontSize: 15, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums' }}>
                {row.value}<span style={{ fontSize: 9.5, color: C.muted, fontFamily: F.body, marginLeft: 5, fontWeight: 500 }}>{row.unit} · {fmtDate(row.date, period)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
