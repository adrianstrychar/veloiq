'use client';

import { C } from '@/lib/theme';
import type { ProgressStats } from '@/lib/progressStats';

interface ProgressProps {
  seasonStartCtl: number;
  seasonStartDate: string;
  nowCtl: number;
  nowDate: string;
  stats: ProgressStats;
}

// Kafelek statystyki (grid 1fr 1fr 1fr) — wzór z mockupu.
function StatTile({
  icon, label, value, sub, color, gradient,
}: {
  icon: string; label: string; value: string; sub: string; color: string; gradient?: string;
}) {
  return (
    <div
      style={{
        background: gradient ?? C.bg,
        border: `1px solid ${color}44`,
        borderRadius: 10,
        padding: '12px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minHeight: 96,
      }}
    >
      <div style={{ fontSize: 18 }}>{icon}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 10, color: C.muted, marginTop: 'auto', lineHeight: 1.25, overflow: 'hidden' }}>{sub}</div>
    </div>
  );
}

// Pasek porównawczy CTL "wtedy vs teraz" — BEZ procentu (baza ~0 daje absurd).
function CtlCompare({
  fromVal, toVal, fromLabel, toLabel,
}: {
  fromVal: number; toVal: number; fromLabel: string; toLabel: string;
}) {
  const max = Math.max(fromVal, toVal, 1);
  const fromPct = (fromVal / max) * 100;
  const toPct = (toVal / max) * 100;
  const delta = Math.round(toVal - fromVal);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>Forma (CTL)</span>
        <span style={{ fontSize: 12, color: delta >= 0 ? C.green : C.red, fontWeight: 600 }}>
          {delta >= 0 ? '+' : ''}{delta} pkt od {fromLabel}
        </span>
      </div>

      {/* wtedy */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, color: C.muted, width: 46, flexShrink: 0 }}>{fromLabel}</span>
        <div style={{ flex: 1, height: 8, borderRadius: 4, background: C.dim, overflow: 'hidden' }}>
          <div style={{ width: `${fromPct}%`, height: '100%', background: C.muted, borderRadius: 4 }} />
        </div>
        <span style={{ fontSize: 11, color: C.muted, width: 28, textAlign: 'right', flexShrink: 0 }}>{Math.round(fromVal)}</span>
      </div>

      {/* teraz */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, color: C.muted, width: 46, flexShrink: 0 }}>{toLabel}</span>
        <div style={{ flex: 1, height: 8, borderRadius: 4, background: C.dim, overflow: 'hidden' }}>
          <div style={{ width: `${toPct}%`, height: '100%', background: C.cyan, borderRadius: 4 }} />
        </div>
        <span style={{ fontSize: 11, color: C.cyan, width: 28, textAlign: 'right', flexShrink: 0, fontWeight: 600 }}>{Math.round(toVal)}</span>
      </div>

      <div style={{ fontSize: 11, color: C.muted }}>
        CTL {Math.round(fromVal)} → {Math.round(toVal)}, +{delta} pkt od {fromLabel}.
      </div>
    </div>
  );
}

export function Progress({ seasonStartCtl, seasonStartDate, nowCtl, nowDate, stats }: ProgressProps) {
  const fromLabel = new Date(seasonStartDate).toLocaleDateString('pl-PL', { day: '2-digit', month: 'short' });
  const toLabel = new Date(nowDate).toLocaleDateString('pl-PL', { day: '2-digit', month: 'short' });

  const streakSub = stats.streakWeeks === 1 ? 'tydzień z treningiem' : 'tygodni z rzędu z treningiem';

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div style={{ fontSize: 10, color: C.cyan, textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 600 }}>
        Twój rozwój
      </div>

      {/* Trzy kafelki statystyk */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <StatTile
          icon="🔥"
          label="Streak"
          value={String(stats.streakWeeks)}
          sub={streakSub}
          color={C.yellow}
          gradient={`linear-gradient(135deg, ${C.yellow}22, ${C.bg})`}
        />
        <StatTile
          icon="🚴"
          label="Najdłuższa"
          value={`${stats.longestKm} km`}
          sub={stats.longestName ?? '—'}
          color={C.green}
        />
        <StatTile
          icon="📅"
          label="Sezon 2026"
          value={`${stats.totalKm}`}
          sub="kilometrów"
          color={C.cyan}
        />
      </div>

      {/* Progres formy CTL — bez mylącego procentu */}
      <CtlCompare fromVal={seasonStartCtl} toVal={nowCtl} fromLabel={fromLabel} toLabel={toLabel} />

      {/* TODO: gdy będzie ftp_history — FTP hero z wykresem krzywej + skala percentylowa FTP.
          TODO: gdy w bazie pojawi się cel sezonu (SEASON_GOAL_KM) — pasek postępu km do celu.
          Teraz pomijamy: brak danych historycznych FTP/VO2max i brak celu km. */}
    </div>
  );
}
