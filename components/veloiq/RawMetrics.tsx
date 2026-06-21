'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { C } from '@/lib/theme';

export interface PmcRow {
  date: string;   // 'YYYY-MM-DD'
  label: string;  // 'DD.M'
  ctl: number;
  atl: number;
  tsb: number;
}

// ── Sparkline ────────────────────────────────────────────────────────────────

function Spark({ data, k, color }: { data: PmcRow[]; k: 'ctl' | 'atl' | 'tsb'; color: string }) {
  return (
    <ResponsiveContainer width="100%" height={28}>
      <LineChart data={data}>
        <Line
          type="monotone"
          dataKey={k}
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Custom PMC tooltip ────────────────────────────────────────────────────────

function PmcTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0A1828', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 11 }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.stroke }}>
          {p.dataKey.toUpperCase()}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
        </div>
      ))}
    </div>
  );
}

// ── Kafel ─────────────────────────────────────────────────────────────────────

function Tile({
  label, sublabel, value, color, spark, data, k,
}: {
  label: string;
  sublabel: string;
  value: string;
  color: string;
  spark: PmcRow[];
  data: PmcRow[];
  k: 'ctl' | 'atl' | 'tsb';
}) {
  return (
    <div style={{
      background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontSize: 8, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label} · {sublabel}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <Spark data={spark} k={k} color={color} />
    </div>
  );
}

// ── RawMetrics ────────────────────────────────────────────────────────────────

export function RawMetrics({ pmc }: { pmc: PmcRow[] }) {
  if (!pmc.length) {
    return (
      <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
        Brak danych — zsynchronizuj Stravę
      </div>
    );
  }

  const now = pmc[pmc.length - 1];
  const chart65 = pmc.slice(-65);
  const spark14 = pmc.slice(-14);

  const tsbColor = now.tsb >= 0 ? C.green : C.red;
  const tsbValue = now.tsb >= 0 ? `+${Math.round(now.tsb)}` : `${Math.round(now.tsb)}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 3 kafle */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <Tile label="CTL" sublabel="Forma"     value={String(Math.round(now.ctl))} color={C.cyan}   spark={spark14} data={pmc} k="ctl" />
        <Tile label="ATL" sublabel="Zmęczenie" value={String(Math.round(now.atl))} color={C.yellow} spark={spark14} data={pmc} k="atl" />
        <Tile label="TSB" sublabel="Świeżość"  value={tsbValue}                    color={tsbColor} spark={spark14} data={pmc} k="tsb" />
      </div>

      {/* PMC */}
      <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ fontSize: 9, color: C.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Performance Management Chart — 65 dni
        </div>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={chart65}>
            <CartesianGrid stroke={C.border} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="label" interval={10} tick={{ fontSize: 9, fill: C.muted }} />
            <YAxis width={26} tick={{ fontSize: 9, fill: C.muted }} />
            <ReferenceLine y={0} stroke={C.border} />
            <Tooltip content={<PmcTip />} />
            <Line type="monotone" dataKey="ctl" stroke={C.cyan}   strokeWidth={2}   dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="atl" stroke={C.yellow} strokeWidth={1.5} dot={false} isAnimationActive={false} strokeDasharray="5 2" />
            <Line type="monotone" dataKey="tsb" stroke={C.green}  strokeWidth={1.5} dot={false} isAnimationActive={false} strokeDasharray="2 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
