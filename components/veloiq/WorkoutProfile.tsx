'use client';

import { C } from '@/lib/theme';
import { FTP_LINE_COLOR, type ExpandedSeg } from '@/lib/workout';

// Skala (ustalona): oś dolna = 40% FTP, sufit = 130%, linia FTP (100%) na 2/3 wysokości.
const VB_W = 680, VB_H = 230;
const X0 = 8, X1 = 672, BASE_Y = 186, TOP_Y = 14;
const PLOT_W = X1 - X0, PLOT_H = BASE_Y - TOP_Y;
const PCT_MIN = 40, PCT_MAX = 130;
const LABEL_Y = 204;
const GAP = 3; // odstęp między segmentami (osobne bloki, nie ciągła podłoga)

function pctToHeight(pct: number): number {
  const clamped = Math.max(PCT_MIN, Math.min(PCT_MAX, pct));
  return ((clamped - PCT_MIN) / (PCT_MAX - PCT_MIN)) * PLOT_H;
}

interface Phase { x0: number; x1: number; label: string }

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.muted }}>
      <span style={{ width: 11, height: 9, background: color, borderRadius: 2 }} />{label}
    </span>
  );
}

export function WorkoutProfile({ expanded, ftp }: { expanded: ExpandedSeg[]; ftp: number }) {
  if (!expanded.length) return null;

  const total = expanded.reduce((a, s) => a + s.min, 0) || 1;
  const ftpY = BASE_Y - pctToHeight(100);
  const watt = (pct: number) => Math.round((ftp * pct) / 100);

  // Odstęp przed segmentem — POMIJANY tylko wewnątrz pary under/over (falowanie OU
  // ma być sklejone). Wszystko inne (rozgrzewka, bloki, przerwy, schłodzenie) stoi
  // jako OSOBNY prostokąt oddzielony przerwą — żaden nie jest tłem pod innym.
  const gapBefore = expanded.map((s, i) => {
    if (i === 0) return false;
    const prev = expanded[i - 1].kind;
    const ouPair = (prev === 'under' || prev === 'over') && (s.kind === 'under' || s.kind === 'over');
    return !ouPair;
  });
  const gapCount = gapBefore.filter(Boolean).length;
  const usableW = PLOT_W - gapCount * GAP;

  let cx = X0;
  const placed = expanded.map((s, i) => {
    if (gapBefore[i]) cx += GAP;
    const w = Math.max(3, (s.min / total) * usableW);
    const x = cx;
    cx += w;
    return { s, x, w };
  });

  // Fazy do podpisów pod osią
  const phases: Phase[] = [];
  let cur: { over: boolean } | null = null;
  let workIdx = 0;
  for (const p of placed) {
    const k = p.s.kind;
    if (k === 'warmup') { phases.push({ x0: p.x, x1: p.x + p.w, label: 'rozgrzewka' }); cur = null; continue; }
    if (k === 'cooldown') { phases.push({ x0: p.x, x1: p.x + p.w, label: 'schłodz.' }); cur = null; continue; }
    if (k === 'steady') { phases.push({ x0: p.x, x1: p.x + p.w, label: 'część główna' }); cur = null; continue; }
    if (k === 'rest') { cur = null; continue; }
    if (!cur) {
      workIdx++;
      cur = { over: k === 'over' || k === 'under' };
      phases.push({ x0: p.x, x1: p.x + p.w, label: `${cur.over ? 'blok' : 'interwał'} ${workIdx}` });
    } else {
      phases[phases.length - 1].x1 = p.x + p.w;
    }
  }

  const hasOu = expanded.some((s) => s.kind === 'over');
  const ouUnderPct = expanded.find((s) => s.kind === 'under')?.pctFtp ?? 95;
  const ouOverPct = expanded.find((s) => s.kind === 'over')?.pctFtp ?? 110;

  return (
    <div>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" role="img" aria-label="Profil mocy sesji z wartościami w watach">
        <line x1={X0} y1={BASE_Y} x2={X1} y2={BASE_Y} stroke={C.border} />

        {placed.map(({ s, x, w }, i) => {
          const h = Math.max(3, pctToHeight(s.pctFtp));
          const y = BASE_Y - h;
          const showWatt = s.kind === 'work' && w > 30;
          return (
            <g key={i}>
              <rect x={x} y={y} width={w} height={h} fill={s.color} rx={1.5} />
              {showWatt && (
                <text x={x + w / 2} y={y + 15} fontSize={11} fontWeight={600} fill={C.bg} textAnchor="middle">
                  {watt(s.pctFtp)}W
                </text>
              )}
              {s.label && w > 26 && (
                <text x={x + w / 2} y={y + h / 2 + 4} fontSize={10} fontWeight={600} fill={C.bg} textAnchor="middle">
                  {s.label}
                </text>
              )}
            </g>
          );
        })}

        <line x1={X0} y1={ftpY} x2={X1} y2={ftpY} stroke={FTP_LINE_COLOR} strokeDasharray="5 4" />
        <text x={X1} y={ftpY - 5} fontSize={11} fontWeight={600} fill={FTP_LINE_COLOR} textAnchor="end">
          FTP · {ftp}W
        </text>

        {phases.map((p, i) => (
          <text key={i} x={(p.x0 + p.x1) / 2} y={LABEL_Y} fontSize={10} fill={C.muted} textAnchor="middle">
            {p.label}
          </text>
        ))}
      </svg>

      {hasOu && (
        <div style={{ display: 'flex', gap: 18, justifyContent: 'center', marginTop: 4 }}>
          <Legend color="#C99A4E" label={`under · ${watt(ouUnderPct)}W`} />
          <Legend color="#C68A4E" label={`over · ${watt(ouOverPct)}W`} />
        </div>
      )}
    </div>
  );
}
