'use client';

import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceArea, ReferenceDot } from 'recharts';
import { C } from '@/lib/theme';
import type { ProgressStats } from '@/lib/progressStats';
import { wkgLabel } from '@/lib/level';
import type { ReconPoint } from '@/lib/ftp-reconstruct';
import type { ForecastPoint, Milestone } from '@/lib/ftp-forecast';

interface ProgressProps {
  stats: ProgressStats;
  weightKg: number | null;
  seasonGoalKm: number | null;
  // Rekonstrukcja + prognoza policzone SERVER-SIDE (dashboard/page, w locie — zero migracji/stanu):
  ftpNow: number | null;      // wyświetlane FTP (ostatni punkt rekonstrukcji ?? kolumna); null → placeholder
  recon: ReconPoint[];        // historia zrekonstruowana (envelope) — linia real; [] gdy brak danych mocy
  forecast: ForecastPoint[];  // prognoza periodyzowana (fazy BUILD/TAPER/REGEN)
  milestones: Milestone[];    // cele: starty lub progi W/kg
}

const PHASE_FILL: Record<string, string> = {
  TAPER: C.green + '12',   // okno szczytowania — subtelny zielony
  REGEN: C.muted + '10',   // regeneracja po starcie — szary
};

function dMs(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// ── FTP hero: REAL (envelope rekonstrukcji, ciągła cyan) + PROGNOZA periodyzowana (przerywana
// purple) + pasy faz w tle (TAPER/REGEN) + markery milestone'ów (starty/progi W/kg) ────
function FtpHero({ recon, forecast, milestones, weightKg, ftpNow }: {
  recon: ReconPoint[]; forecast: ForecastPoint[]; milestones: Milestone[]; weightKg: number | null; ftpNow: number;
}) {
  const realPts = recon.map((p) => ({ t: dMs(p.date), ftp: p.ftp }));
  const fcPts = forecast.map((p) => ({ t: p.t, fc: p.ftp }));
  const chart: { t: number; ftp?: number; fc?: number }[] = [...realPts, ...fcPts].sort((a, b) => a.t - b.t);
  const todayT = forecast.length ? forecast[0].t : (realPts.length ? realPts[realPts.length - 1].t : Date.now());

  // OŚ od pierwszego realnego punktu (dynamicznie — zero pustych tygodni przed danymi).
  const domainStart = realPts.length ? realPts[0].t : todayT;
  const domainEnd = fcPts.length ? fcPts[fcPts.length - 1].t : todayT;

  const first = realPts.length ? realPts[0].ftp : ftpNow;
  const gain = ftpNow - first;
  const pct = first > 0 ? Math.round((gain / first) * 100) : 0;
  const wkg = weightKg ? ftpNow / weightKg : null;
  const levelLabel = wkg != null ? wkgLabel(wkg) : null;

  const allVals = [...realPts.map((p) => p.ftp), ...fcPts.map((p) => p.fc), ...milestones.map((m) => m.ftp)];
  const minFtp = allVals.length ? Math.min(...allVals) : ftpNow - 20;
  const maxFtp = allVals.length ? Math.max(...allVals) : ftpNow + 20;

  // Pasy faz w tle: sklej sąsiadujące tygodnie o tej samej NIE-build fazie w przedziały ReferenceArea.
  const bands: { x1: number; x2: number; phase: string }[] = [];
  for (const p of forecast) {
    if (p.phase === 'BUILD') continue;
    const lastB = bands[bands.length - 1];
    if (lastB && lastB.phase === p.phase && Math.abs(p.t - lastB.x2) <= 8 * 86_400_000) lastB.x2 = p.t;
    else bands.push({ x1: p.t - 3 * 86_400_000, x2: p.t, phase: p.phase });
  }

  // Milestone'y: kropka na prognozie; etykieta FTP tylko gdy wartość ≠ poprzedniej (7 startów o tej
  // samej prognozie → jedna etykieta, bez tłoku).
  let prevFtp = -1;
  const marks = milestones.map((m) => { const showLabel = m.ftp !== prevFtp; prevFtp = m.ftp; return { ...m, showLabel }; });

  const monthTicks: number[] = [];
  const ds = new Date(domainStart);
  let mt = new Date(ds.getUTCFullYear(), ds.getUTCMonth(), 15);
  while (mt.getTime() <= domainEnd) { if (mt.getTime() >= domainStart) monthTicks.push(mt.getTime()); mt = new Date(mt.getFullYear(), mt.getMonth() + 1, 15); }

  return (
    <div style={{ background: C.bg, borderRadius: 12, border: `1px solid ${C.border}`, padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 10, color: C.muted, letterSpacing: '0.1em', fontWeight: 600, marginBottom: 4 }}>TWÓJ SILNIK · FTP</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 38, fontWeight: 600, color: C.cyan, lineHeight: 1 }}>{ftpNow}</span>
            <span style={{ fontSize: 14, color: C.muted }}>W</span>
            {wkg && <span style={{ fontSize: 13, color: C.muted }}>· {wkg.toFixed(2)} W/kg</span>}
          </div>
        </div>
        {gain !== 0 && (
          <div style={{ textAlign: 'right' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: (gain > 0 ? C.green : C.red) + '1E',
              border: `1px solid ${gain > 0 ? C.green : C.red}44`, borderRadius: 20, padding: '4px 12px',
            }}>
              <span style={{ fontSize: 14, color: gain > 0 ? C.green : C.red }}>{gain > 0 ? '▲' : '▼'}</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: gain > 0 ? C.green : C.red }}>{gain > 0 ? '+' : ''}{gain}W</span>
            </div>
            <div style={{ fontSize: 11, color: gain > 0 ? C.green : C.red, fontWeight: 600, marginTop: 4 }}>
              {gain > 0 ? '+' : ''}{pct}% od {new Date(domainStart).toLocaleDateString('pl-PL', { month: 'short' })}
            </div>
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <ResponsiveContainer width="100%" height={104}>
          <ComposedChart data={chart} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
            <YAxis domain={[minFtp - 6, maxFtp + 6]} hide />
            <XAxis
              dataKey="t" type="number" scale="time" domain={[domainStart, domainEnd]} ticks={monthTicks}
              tickFormatter={(t) => new Date(t).toLocaleDateString('pl-PL', { month: 'short' })}
              tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false}
            />
            <Tooltip
              cursor={{ stroke: C.border }}
              contentStyle={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: C.muted }}
              labelFormatter={(t) => new Date(t as number).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}
              formatter={(v, name) => [`${v} W`, name === 'fc' ? 'prognoza' : 'FTP (zrekonstruowane)']}
            />
            {/* Pasy faz w tle — TAPER (zielony) / REGEN (szary); BUILD = brak tła */}
            {bands.map((b, i) => <ReferenceArea key={i} x1={b.x1} x2={b.x2} fill={PHASE_FILL[b.phase]} stroke="none" />)}
            {/* Granica real|prognoza */}
            <ReferenceLine x={todayT} stroke={C.border} strokeDasharray="4 4" />
            {/* PROGNOZA: przerywana purple (odcień inny niż real cyan — nie do pomylenia z pomiarem) */}
            <Line dataKey="fc" stroke={C.purple} strokeWidth={1.75} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls />
            {/* REAL: ciągła cyan z kropkami (envelope rekonstrukcji) */}
            <Line dataKey="ftp" stroke={C.cyan} strokeWidth={2.5} dot={{ r: 2.5, fill: C.cyan, strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} connectNulls />
            {/* Markery milestone'ów — kropka (start=red / próg=cyan), etykieta FTP gdy zmiana wartości */}
            {marks.map((m, i) => (
              <ReferenceDot key={i} x={m.t} y={m.ftp} r={3.5} fill={m.kind === 'race' ? C.red : C.cyan} stroke={C.bg} strokeWidth={1}
                label={m.showLabel ? { value: `${m.ftp}`, position: 'top', fill: m.kind === 'race' ? C.red : C.cyan, fontSize: 9, fontWeight: 700 } : undefined} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
        <span style={{ position: 'absolute', top: 4, right: 8, fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', color: C.purple, pointerEvents: 'none' }}>
          PROGNOZA
        </span>
      </div>

      {levelLabel != null && (
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 10, color: C.muted, letterSpacing: '0.08em', fontWeight: 600 }}>POZIOM (W/KG)</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.cyan }}>{levelLabel}</span>
        </div>
      )}
    </div>
  );
}

// FTP null (brak zmierzonego i estymaty) → placeholder z CTA zamiast prognozy z niczego.
// Onboarding/pole ręczne to osobny dług — tu tylko uczciwy komunikat.
function FtpPlaceholder() {
  return (
    <div style={{ background: C.bg, borderRadius: 12, border: `1px dashed ${C.border}`, padding: 16, marginBottom: 12, textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: C.muted, letterSpacing: '0.1em', fontWeight: 600, marginBottom: 6 }}>TWÓJ SILNIK · FTP</div>
      <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 4 }}>Ustaw FTP w profilu</div>
      <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
        Prognoza rozwoju pojawi się, gdy poznamy Twój punkt startowy — zrób test 20 min albo jeźdź z miernikiem, a silnik oszacuje FTP sam.
      </div>
    </div>
  );
}

export function Progress({ stats, weightKg, seasonGoalKm, ftpNow, recon, forecast, milestones }: ProgressProps) {
  const goalPct = seasonGoalKm && seasonGoalKm > 0 ? clamp(Math.round((stats.totalKm / seasonGoalKm) * 100), 0, 100) : null;

  // Pace marker: oczekiwane km wg dnia roku (realne, nie wymyślone).
  let paceDelta: number | null = null;
  let expectedPct = 0;
  if (seasonGoalKm && seasonGoalKm > 0) {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
    const expected = seasonGoalKm * (dayOfYear / 365);
    paceDelta = Math.round(stats.totalKm - expected);
    expectedPct = clamp((expected / seasonGoalKm) * 100, 0, 100);
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
      {/* Nagłówek (mockup 1006-1009) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Twój rozwój</span>
        {/* Zwykły label zakresu — bez kropki-chipa, żeby nie wyglądał na przełącznik. */}
        <span style={{ fontSize: 11, color: C.muted }}>od początku sezonu</span>
      </div>

      {/* FTP hero: real (rekonstrukcja) + prognoza (jest punkt startowy) / placeholder CTA (FTP null) */}
      {ftpNow != null ? (
        <FtpHero recon={recon} forecast={forecast} milestones={milestones} weightKg={weightKg} ftpNow={ftpNow} />
      ) : (
        <FtpPlaceholder />
      )}

      {/* Trzy kafelki — centrowane (mockup 1057-1078) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <div style={{
          background: `linear-gradient(160deg, ${C.yellow}14, ${C.bg})`, borderRadius: 12,
          border: `1px solid ${C.yellow}33`, padding: '14px 12px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 24, marginBottom: 2 }}>🔥</div>
          <div style={{ fontSize: 30, fontWeight: 600, color: C.yellow, lineHeight: 1 }}>{stats.streakWeeks}</div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 3, lineHeight: 1.3 }}>tygodni z rzędu<br />z treningiem</div>
        </div>
        <div style={{
          background: C.bg, borderRadius: 12, border: `1px solid ${C.border}`, padding: '14px 12px',
          textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
          <div style={{ fontSize: 10, color: C.muted, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>NAJDŁUŻSZA JAZDA</div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 3 }}>
            <span style={{ fontSize: 28, fontWeight: 600, color: C.green, lineHeight: 1 }}>{stats.longestKm}</span>
            <span style={{ fontSize: 12, color: C.muted }}>km</span>
          </div>
          <div style={{ fontSize: 11, color: C.green, fontWeight: 600, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {stats.longestName ?? '—'}
          </div>
        </div>
        <div style={{
          background: C.bg, borderRadius: 12, border: `1px solid ${C.border}`, padding: '14px 12px',
          textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
          <div style={{ fontSize: 10, color: C.muted, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>SEZON 2026</div>
          <div style={{ fontSize: 26, fontWeight: 600, color: C.cyan, lineHeight: 1 }}>{stats.totalKm.toLocaleString('pl')}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>kilometrów</div>
        </div>
      </div>

      {/* Cel sezonu km + pace marker (mockup 1082-1103) */}
      {goalPct != null && seasonGoalKm != null && (
        <div style={{ marginTop: 12, background: C.bg, borderRadius: 10, border: `1px solid ${C.border}`, padding: '13px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>🎯</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>Cel sezonu</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
              <span style={{ fontSize: 16, fontWeight: 600, color: C.cyan }}>{stats.totalKm.toLocaleString('pl')}</span>
              <span style={{ fontSize: 12, color: C.muted }}>/ {seasonGoalKm.toLocaleString('pl')} km</span>
            </div>
          </div>
          <div style={{ position: 'relative', background: C.dim, borderRadius: 4, height: 8, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{ height: '100%', width: `${goalPct}%`, background: `linear-gradient(90deg, ${C.cyan}, ${C.green})`, borderRadius: 4 }} />
            <div style={{ position: 'absolute', top: -2, bottom: -2, left: `${expectedPct}%`, width: 2, background: C.text, opacity: 0.5 }} title="tempo planu" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: (paceDelta ?? 0) >= 0 ? C.green : C.yellow, fontWeight: 600 }}>
              {(paceDelta ?? 0) >= 0 ? `▲ ${paceDelta} km przed tempem` : `▼ ${Math.abs(paceDelta ?? 0)} km za tempem`}
            </span>
            <span style={{ fontSize: 11, color: C.muted }}>
              {goalPct}% celu · zostało {(seasonGoalKm - stats.totalKm).toLocaleString('pl')} km
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
