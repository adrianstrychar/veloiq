'use client';

import { useState } from 'react';
import { C, RADIUS } from '@/lib/theme';
import type { Readiness } from '@/lib/readiness';
import { RawMetrics, type PmcRow } from './RawMetrics';

const COLOR: Record<Readiness['color'], string> = {
  green: C.green,
  yellow: C.yellow,
  red: C.red,
};

// Pierścień gotowości (mockup Ring 278-293): size 132, sw 11, wartość + "%".
function Ring({ value, color }: { value: number; color: string }) {
  const size = 104;
  const sw = 9;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - value / 100);
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.dim} strokeWidth={sw} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off}
          style={{ transition: 'stroke-dashoffset 1s ease' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 34, fontWeight: 600, color, lineHeight: 1 }}>
          {value}<span style={{ fontSize: 16 }}>%</span>
        </div>
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

  // Podpisy pasków DYNAMICZNE — czytane z wartości, nie statyczne (żaden nie kłamie).
  // Świeżość: progi 67/40 spójne z kolorem pierścienia (jedna skala na karcie).
  const freshLabel =
    readiness.freshPct >= 67 ? 'nogi wypoczęte i gotowe do wysiłku'
      : readiness.freshPct >= 40 ? 'umiarkowane zmęczenie — forma w budowie'
        : 'nogi zmęczone po bloku treningowym';
  // Forma: kierunek z ctlRamp, martwa strefa ±1.0 CTL (poniżej = "stoi", żeby szum
  // nie migał rośnie/spada). TODO (przyszłość, gdy dojdą fazy treningowe): ↘ podczas
  // taperingu jest celowy → wtedy inny ton ("↘ tapering"); bez fazy "↘ spada" wystarcza.
  const formaTrend =
    readiness.ctlRamp > 1 ? '↗ rośnie'
      : readiness.ctlRamp < -1 ? '↘ spada'
        : '→ stabilna';

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.card,
      marginBottom: 10, padding: '18px 18px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        {/* Pierścień + label + pill stanu */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.12em', fontWeight: 600 }}>GOTOWOŚĆ DZIŚ</div>
          <Ring value={readiness.raceReady} color={color} />
          <div style={{
            background: color + '1E', color, border: `1px solid ${color}44`,
            borderRadius: 20, padding: '4px 14px', fontSize: 12, fontWeight: 600,
          }}>
            {readiness.state}
          </div>
        </div>

        {/* Prawa kolumna: dwa paski (advice usunięty — patrz DailyInsight fallback) */}
        <div style={{ flex: 1, minWidth: 130 }}>
          {/* Forma */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>Forma</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.cyan }}>{readiness.fitnessPct}%</span>
            </div>
            <div style={{ background: C.dim, borderRadius: 5, height: 9, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${readiness.fitnessPct}%`, background: C.cyan, borderRadius: 5, transition: 'width 1s ease' }} />
            </div>
            <div style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>
              {formaTrend} · względem szczytu sezonu
            </div>
          </div>
          {/* Świeżość */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>Świeżość</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>{readiness.freshPct}%</span>
            </div>
            <div style={{ background: C.dim, borderRadius: 5, height: 9, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${readiness.freshPct}%`, background: C.muted, borderRadius: 5, transition: 'width 1s ease' }} />
            </div>
            <div style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>{freshLabel}</div>
          </div>
        </div>
      </div>

      {/* Rozwijane dane szczegółowe → RawMetrics */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', marginTop: 14, background: 'none', border: 'none',
          borderTop: `1px solid ${C.border}`, paddingTop: 12, color: C.muted,
          fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 6,
        }}
      >
        {open ? 'Ukryj' : 'Pokaż'} dane szczegółowe (CTL / ATL / TSB)
        <span style={{ fontSize: 9 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <RawMetrics pmc={pmc} />}
    </div>
  );
}
