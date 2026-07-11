'use client';

// Pierścień realizacji celu dnia (WHOOP-owy donut, % w środku). Renderowany TYLKO gdy
// ring.available (parent sprawdza) — tu dostaje policzone pct + zaplanowany dzień (do nazwy).
import { useId } from 'react';
import { C } from '@/lib/theme';
import { isOU, ouBlockMin } from '@/lib/structure';
import { ringHeadline } from '@/lib/execution-ring';
import type { PlannedWorkout } from '@/lib/ai/insight';

// Paleta progów (własna, WHOOP-owa: light→deep na łuku, deep na tekście). Nie z motywu — świadomie.
type Tone = { deep: string; light: string; glow: string };
function toneFor(pct: number): Tone {
  if (pct >= 90) return { deep: '#4bbf7d', light: '#8fe6b0', glow: 'rgba(75,191,125,0.55)' };
  if (pct >= 75) return { deep: '#d9ab3a', light: '#f0d478', glow: 'rgba(217,171,58,0.5)' };
  return { deep: '#d64f4f', light: '#ec8585', glow: 'rgba(214,79,79,0.5)' };
}

// Główny status słowem: współdzielony ringHeadline z lib/execution-ring (to samo źródło
// co naklejka share — % i status IDENTYCZNE między kartą a stickerem).

// Status w podpisie (przy nazwie treningu).
function subStatus(pct: number): string {
  if (pct >= 90) return 'cel zrealizowany';
  if (pct >= 75) return 'trochę zabrakło';
  return 'sesja niedowieziona';
}

// Nazwa treningu z planu: strukturalne → "THR 3×20" / "OU 3×12"; jednolite → po polsku.
function planName(p: PlannedWorkout): string {
  const s = p.structure;
  if (s) {
    if (isOU(s)) return `OU ${s.reps}×${ouBlockMin(s)}`;
    return `${p.type} ${s.reps}×${s.work_min}`;
  }
  if (p.type === 'Z1') return 'Regeneracja';
  if (p.type === 'LONG') return 'Baza';
  if (p.type === 'Z2') return `Z2 ${p.dur_min}min`;
  return p.label || p.type;
}

const SIZE = 84;
const STROKE = 9;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

export default function ExecutionRing({ pct, planned }: { pct: number; planned: PlannedWorkout }) {
  const t = toneFor(pct);
  const gradId = useId();
  const offset = CIRC * (1 - pct / 100);

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: '12px', display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <div style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={t.light} />
              <stop offset="100%" stopColor={t.deep} />
            </linearGradient>
          </defs>
          {/* Track tła */}
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={STROKE} />
          {/* Łuk wyniku — gradient + delikatny glow w kolorze progu */}
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={`url(#${gradId})`} strokeWidth={STROKE}
            strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={offset}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            style={{ filter: `drop-shadow(0 0 5px ${t.glow})` }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, fontWeight: 700, color: t.deep,
        }}>
          {pct}%
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <div style={{ fontSize: 21, fontWeight: 700, color: t.deep, lineHeight: 1.1 }}>
          {ringHeadline(pct)}
        </div>
        <div style={{ fontSize: 12.5, color: C.muted }}>
          {planName(planned)} · {subStatus(pct)}
        </div>
      </div>
    </div>
  );
}
