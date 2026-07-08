'use client';

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { C } from '@/lib/theme';
import type { ProgressStats } from '@/lib/progressStats';
import { wkgLabel } from '@/lib/fitness-level';

export interface FtpPoint {
  date: string;
  ftp_watts: number;
}

interface ProgressProps {
  stats: ProgressStats;
  ftpHistory: FtpPoint[];
  weightKg: number | null;
  seasonGoalKm: number | null;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// ── FTP hero (mockup 1011-1054) ────────────────────────────────────────────────
function FtpHero({ ftpHistory, weightKg }: { ftpHistory: FtpPoint[]; weightKg: number | null }) {
  const first = ftpHistory[0].ftp_watts;
  const last = ftpHistory[ftpHistory.length - 1].ftp_watts;
  const gain = last - first;
  const pct = first > 0 ? Math.round((gain / first) * 100) : 0;
  const wkg = weightKg ? last / weightKg : null;

  // Punkty na osi CZASOWEJ — pozycja proporcjonalna do daty pomiaru (nie kategorialna).
  const chart = ftpHistory.map((p) => ({
    t: new Date(p.date).getTime(),
    ftp: p.ftp_watts,
  }));
  const ftps = ftpHistory.map((p) => p.ftp_watts);
  const minFtp = Math.min(...ftps);
  const maxFtp = Math.max(...ftps);

  // Okno 6 miesięcy (dziś−6mies → dziś) + ticki na ŚRODKU miesiąca (15. dzień),
  // żeby etykiety lądowały pod pomiarami FTP (które są z 15. dnia miesiąca).
  const now = new Date();
  const domainStart = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).getTime();
  const domainEnd = now.getTime();
  const monthTicks: number[] = [];
  let mt = new Date(now.getFullYear(), now.getMonth() - 6, 15);
  while (mt.getTime() <= domainEnd) {
    if (mt.getTime() >= domainStart) monthTicks.push(mt.getTime());
    mt = new Date(mt.getFullYear(), mt.getMonth() + 1, 15);
  }

  // Podpis poziomu z W/kg — ta sama funkcja co kafel FTP (koniec rozjazdu percentyla).
  const levelLabel = wkg != null ? wkgLabel(wkg) : null;

  return (
    <div style={{ background: C.bg, borderRadius: 12, border: `1px solid ${C.border}`, padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 10, color: C.muted, letterSpacing: '0.1em', fontWeight: 600, marginBottom: 4 }}>TWÓJ SILNIK · FTP</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 38, fontWeight: 600, color: C.cyan, lineHeight: 1 }}>{last}</span>
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
              {gain > 0 ? '+' : ''}{pct}% {gain > 0 ? 'mocniejszy' : 'słabszy'}
            </div>
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={84}>
        <LineChart data={chart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <YAxis domain={[minFtp - 6, maxFtp + 4]} hide />
          <XAxis
            dataKey="t" type="number" scale="time"
            domain={[domainStart, domainEnd]} ticks={monthTicks}
            tickFormatter={(t) => new Date(t).toLocaleDateString('pl-PL', { month: 'short' })}
            tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false}
          />
          <Tooltip
            cursor={{ stroke: C.border }}
            contentStyle={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: C.muted }} itemStyle={{ color: C.cyan }}
            labelFormatter={(t) => new Date(t as number).toLocaleDateString('pl-PL', { month: 'short', year: 'numeric' })}
            formatter={(v: any) => [`${v}W`, 'FTP']}
          />
          <Line type="monotone" dataKey="ftp" stroke={C.cyan} strokeWidth={2.5} dot={{ r: 3, fill: C.cyan, strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>

      {/* Poziom z W/kg — kategoria z weryfikowalnej tabeli progów (nie percentyl populacyjny). */}
      {levelLabel != null && (
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 10, color: C.muted, letterSpacing: '0.08em', fontWeight: 600 }}>POZIOM (W/KG)</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.cyan }}>{levelLabel}</span>
        </div>
      )}
    </div>
  );
}

export function Progress({ stats, ftpHistory, weightKg, seasonGoalKm }: ProgressProps) {
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

      {/* FTP hero (gdy ≥2 pomiary) */}
      {ftpHistory.length >= 2 && <FtpHero ftpHistory={ftpHistory} weightKg={weightKg} />}

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
