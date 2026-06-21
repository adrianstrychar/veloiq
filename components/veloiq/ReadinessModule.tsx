'use client';

import { useState } from 'react';
import { C } from '@/lib/theme';
import type { Readiness } from '@/lib/readiness';
import { RawMetrics, type PmcRow } from './RawMetrics';

const COLOR: Record<Readiness['color'], string> = {
  green: C.green,
  yellow: C.yellow,
  red: C.red,
};

// Pierścień postępu (komponent Ring z mockupu).
function Ring({ value, color }: { value: number; color: string }) {
  const size = 120;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - value / 100);
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" fontSize="30" fontWeight="700" fill={C.text}>
        {value}
      </text>
      <text x="50%" y="64%" textAnchor="middle" dominantBaseline="middle" fontSize="10" fill={C.muted}>
        gotowość
      </text>
    </svg>
  );
}

function Bar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span style={{ color: C.muted }}>{label}</span>
        <span style={{ color, fontWeight: 600 }}>{pct}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: C.dim, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

interface ReadinessModuleProps {
  readiness: Readiness;
  pmc: PmcRow[];
}

export function ReadinessModule({ readiness, pmc }: ReadinessModuleProps) {
  const [open, setOpen] = useState(false);
  const color = COLOR[readiness.color];
  const rampLabel = readiness.ctlRamp >= 0 ? `+${readiness.ctlRamp}` : `${readiness.ctlRamp}`;

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div style={{ fontSize: 10, color: C.cyan, textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 600 }}>
        Gotowość
      </div>

      {/* Pierścień + paski */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <Ring value={readiness.raceReady} color={color} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color }}>{readiness.state}</div>
          <Bar label="Forma" pct={readiness.fitnessPct} color={C.cyan} />
          <Bar label="Świeżość" pct={readiness.freshPct} color={C.green} />
        </div>
      </div>

      {/* Werdykt w ramce */}
      <div
        style={{
          background: color + '14',
          border: `1px solid ${color}44`,
          borderRadius: 8,
          padding: '10px 12px',
          fontSize: 13,
          color: C.text,
          lineHeight: 1.4,
        }}
      >
        {readiness.advice}
        <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
          CTL {Math.round(readiness.nowCtl)} (szczyt {Math.round(readiness.peakCtl)}) · 7 dni {rampLabel} · TSB {readiness.nowTsb >= 0 ? `+${Math.round(readiness.nowTsb)}` : Math.round(readiness.nowTsb)}
        </div>
      </div>

      {/* Rozwijane dane szczegółowe → RawMetrics */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          appearance: 'none',
          border: `1px solid ${C.border}`,
          background: 'transparent',
          color: C.muted,
          borderRadius: 8,
          padding: '8px 0',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {open ? 'Ukryj dane szczegółowe' : 'Pokaż dane szczegółowe (CTL/ATL/TSB)'}
      </button>
      {open && <RawMetrics pmc={pmc} />}
    </div>
  );
}
