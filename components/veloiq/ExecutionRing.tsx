'use client';

// Pierścień realizacji celu dnia (WHOOP-owy donut, % w środku). Renderowany TYLKO gdy
// ring.available (parent sprawdza) — tu dostaje już policzone pct/doneMin/targetMin.
import { C } from '@/lib/theme';

// Kolor wg realizacji: <75% czerwony (poniżej 3/4 celu = niedowiezione), 75–90% żółty, 90%+ zielony.
function ringColor(pct: number): string {
  if (pct < 75) return C.red;
  if (pct < 90) return C.yellow;
  return C.green;
}

const SIZE = 84;
const STROKE = 9;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

export default function ExecutionRing({ pct, doneMin, targetMin }: { pct: number; doneMin: number; targetMin: number }) {
  const color = ringColor(pct);
  const offset = CIRC * (1 - pct / 100);

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: '12px', display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <div style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={C.dim} strokeWidth={STROKE} />
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={color} strokeWidth={STROKE}
            strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={offset}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, fontWeight: 700, color,
        }}>
          {pct}%
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Realizacja celu
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: C.text }}>
          {doneMin} / {targetMin} min
        </div>
      </div>
    </div>
  );
}
