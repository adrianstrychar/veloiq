'use client';

import { useMemo } from 'react';
import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';
import { C } from '@/lib/theme';
import type { ProgressStats } from '@/lib/progressStats';
import { wkgLabel } from '@/lib/fitness-level';
import { forecastFtp, type PlannedWeekTss, type RaceLite, type CtlPointF } from '@/lib/ftp-forecast';

export interface FtpPoint {
  date: string;
  ftp_watts: number;
}

interface ProgressProps {
  stats: ProgressStats;
  ftpHistory: FtpPoint[];
  weightKg: number | null;
  seasonGoalKm: number | null;
  // Prognoza FTP (liczona w locie w komponencie, cache = useMemo; zero migracji/stanu):
  ftpNow: number | null;          // wyświetlane FTP (measured ?? estimate); null → placeholder CTA
  ctlNow: number;
  ctlSeries: CtlPointF[];         // pełna seria CTL (dashboard i tak ją ma) → rampFactor kalibracji G
  plannedWeeks: PlannedWeekTss[]; // weekly_tss_target bieżący + przyszłe
  races: RaceLite[];              // nadchodzące starty → okna taperu (pas płaski przed startem)
  todayISO: string;
}

const WEEK_MS = 7 * 86_400_000;
const FORECAST_WEEKS = 14;      // ~3.5 mies. prognozy
const REAL_WINDOW_WEEKS = 16;   // ~4 mies. realu przy bogatej historii
const RICH_HISTORY_WEEKS = 12;  // próg kompozycji "istniejący user"

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// ── FTP hero: real (linia ciągła) + PROGNOZA (pas p25-p75-stylowy, przerywany kontur) ────
function FtpHero({ ftpHistory, weightKg, ftpNow, ctlNow, ctlSeries, plannedWeeks, races, todayISO }: {
  ftpHistory: FtpPoint[]; weightKg: number | null; ftpNow: number; ctlNow: number;
  ctlSeries: CtlPointF[]; plannedWeeks: PlannedWeekTss[]; races: RaceLite[]; todayISO: string;
}) {
  // Kompozycja: bogata historia (≥12 tyg. rozpiętości) → okno 16 tyg. realu; nowy user
  // (0-1 pomiarów / krótka historia) → punkt startowy "dziś" + sama trajektoria prognozy.
  const todayT = new Date(todayISO + 'T12:00:00Z').getTime();
  const histSpanWeeks = ftpHistory.length >= 2
    ? (new Date(ftpHistory[ftpHistory.length - 1].date).getTime() - new Date(ftpHistory[0].date).getTime()) / WEEK_MS
    : 0;
  const rich = histSpanWeeks >= RICH_HISTORY_WEEKS;
  const domainStart = todayT - (rich ? REAL_WINDOW_WEEKS : 2) * WEEK_MS;
  const domainEnd = todayT + FORECAST_WEEKS * WEEK_MS;

  // Prognoza w locie + cache w pamięci komponentu (useMemo) — rekalibracja naturalna:
  // każdy render liczy z aktualnych danych (historia/CTL/plan), zero materializacji.
  const forecast = useMemo(
    () => forecastFtp({
      ftpNow,
      massKg: weightKg,
      ctlNow,
      plannedWeeks,
      ftpHistory: ftpHistory.map((p) => ({ date: p.date, ftp: p.ftp_watts })),
      ctlSeries,
      races,
      today: todayISO,
      horizonWeeks: FORECAST_WEEKS,
    }),
    [ftpNow, weightKg, ctlNow, ctlSeries, plannedWeeks, ftpHistory, races, todayISO]
  );

  // Serie wykresu: real (punkty historii w oknie; nowy user → syntetyczny punkt "dziś"),
  // prognoza (pas [lo,hi] + linia centralna) doklejona od dziś.
  const realPts = ftpHistory
    .map((p) => ({ t: new Date(p.date).getTime(), ftp: p.ftp_watts }))
    .filter((p) => p.t >= domainStart);
  if (realPts.length === 0) realPts.push({ t: todayT, ftp: ftpNow });
  const fcPts = forecast.points.map((p) => ({ t: p.t, band: [p.lo, p.hi] as [number, number], fc: p.central }));
  const chart: { t: number; ftp?: number; band?: [number, number]; fc?: number }[] =
    [...realPts, ...fcPts].sort((a, b) => a.t - b.t);

  const last = ftpNow;
  const first = realPts[0].ftp;
  const gain = (realPts[realPts.length - 1].ftp ?? last) - first;
  const pct = first > 0 ? Math.round((gain / first) * 100) : 0;
  const wkg = weightKg ? last / weightKg : null;

  const allVals = [...realPts.map((p) => p.ftp), ...fcPts.flatMap((p) => p.band)];
  const minFtp = Math.min(...allVals);
  const maxFtp = Math.max(...allVals);

  // Ticki na środku miesiąca przez całą domenę (real + prognoza).
  const monthTicks: number[] = [];
  const ds = new Date(domainStart);
  let mt = new Date(ds.getFullYear(), ds.getMonth(), 15);
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

      <div style={{ position: 'relative' }}>
        <ResponsiveContainer width="100%" height={96}>
          <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
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
              labelStyle={{ color: C.muted }}
              labelFormatter={(t) => new Date(t as number).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}
              formatter={(v, name) => {
                if (Array.isArray(v)) return [`${v[0]}–${v[1]} W`, 'prognoza (pas)'];
                if (name === 'fc') return [`${v} W`, 'prognoza'];
                return [`${v} W`, 'FTP'];
              }}
            />
            {/* Granica real|prognoza — pionowa przerywana na dziś */}
            <ReferenceLine x={todayT} stroke={C.border} strokeDasharray="4 4" />
            {/* PROGNOZA: pas lo–hi (wypełnienie ~15%) + przerywana linia centralna — odcień
                inny niż real (purple vs cyan), kontur dashed: nikt nie pomyli obietnicy z pomiarem. */}
            <Area dataKey="band" stroke={C.purple + '66'} strokeDasharray="5 4" strokeWidth={1}
              fill={C.purple + '26'} isAnimationActive={false} connectNulls={false} activeDot={false} />
            <Line dataKey="fc" stroke={C.purple} strokeWidth={1.5} strokeDasharray="6 4"
              dot={false} isAnimationActive={false} connectNulls={false} />
            {/* REAL: linia ciągła cyan z kropkami (jak dotąd) */}
            <Line dataKey="ftp" stroke={C.cyan} strokeWidth={2.5}
              dot={{ r: 3, fill: C.cyan, strokeWidth: 0 }} activeDot={{ r: 5 }}
              isAnimationActive={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
        {/* Etykieta pasa — na prognozowanej połowie wykresu */}
        <span style={{
          position: 'absolute', top: 4, right: 8, fontSize: 8, fontWeight: 700,
          letterSpacing: '0.12em', color: C.purple, pointerEvents: 'none',
        }}>
          PROGNOZA
        </span>
      </div>

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

export function Progress({ stats, ftpHistory, weightKg, seasonGoalKm, ftpNow, ctlNow, ctlSeries, plannedWeeks, races, todayISO }: ProgressProps) {
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

      {/* FTP hero: real + prognoza (jest punkt startowy) / placeholder CTA (FTP null) */}
      {ftpNow != null ? (
        <FtpHero
          ftpHistory={ftpHistory} weightKg={weightKg} ftpNow={ftpNow} ctlNow={ctlNow}
          ctlSeries={ctlSeries} plannedWeeks={plannedWeeks} races={races} todayISO={todayISO}
        />
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
