'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceDot } from 'recharts';
import { TrendingUp, TrendingDown, Wind } from 'lucide-react';
import { C, F, RADIUS } from '@/lib/theme';
import { CardLabel } from './CardLabel';
import { wkgLabel } from '@/lib/level';
import type { ReconPoint } from '@/lib/ftp-reconstruct';
import type { ForecastPoint, Milestone } from '@/lib/ftp-forecast';
import type { FtpDisplay } from '@/lib/ftp';

// "Twój silnik" (ETAP 3) — scalenie FTP + Pułap tlenowy + rozwój w JEDNĄ kartę.
// NIENEGOCJOWALNE rozróżnienie fakt/model na wykresie: historia = linia CIĄGŁA (cyan),
// prognoza = linia PRZERYWANA "2 6" (purple) + punkt prognozy jako PUSTY OKRĄG. Pas niepewności
// (purple) i złote markery celów jak dotąd.

const MONTH_MS = 30 * 86_400_000;
const BAND_DOWN_PER_MONTH = 2.5; // W/mies. w dół (niedowiezienie bardziej prawdopodobne)
const BAND_UP_PER_MONTH = 1.5;   // W/mies. w górę

function dMs(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function monthlyLast<T extends { t: number }>(pts: T[]): T[] {
  const by = new Map<string, T>();
  for (const p of pts) { const d = new Date(p.t); by.set(`${d.getUTCFullYear()}-${d.getUTCMonth()}`, p); }
  return Array.from(by.values()).sort((a, b) => a.t - b.t);
}

const PL_MONTH_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

interface EngineCardProps {
  ftp: FtpDisplay;             // wyświetlane FTP + tag Zmierzone/Szacunek + estymata do akceptacji
  vo2Estimate: number | null;  // pułap tlenowy (ml/kg/min); null → wiersz ukryty
  weightKg: number | null;
  recon: ReconPoint[];         // historia zrekonstruowana (envelope) — linia CIĄGŁA
  forecast: ForecastPoint[];   // prognoza periodyzowana — linia PRZERYWANA
  milestones: Milestone[];
}

// ── Wykres FTP (fakt/model) ────────────────────────────────────────────────────
function FtpChart({ recon, forecast, milestones }: { recon: ReconPoint[]; forecast: ForecastPoint[]; milestones: Milestone[] }) {
  const realMonthly = monthlyLast(recon.map((p) => ({ t: dMs(p.date), ftp: p.ftp })));
  const realLast = realMonthly.length ? realMonthly[realMonthly.length - 1] : null;

  // Styk real↔forecast: prognoza startuje DOKŁADNIE od ostatniego realnego punktu (wspólny wierzchołek).
  const monthKey = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}-${d.getUTCMonth()}`; };
  const fcRaw = forecast.map((p) => ({ t: p.t, fc: p.ftp }));
  const startNode = realLast ? { t: realLast.t, fc: realLast.ftp } : (fcRaw[0] ?? null);
  const fcMonthly = startNode
    ? [startNode, ...monthlyLast(fcRaw.filter((p) => p.t > startNode.t && monthKey(p.t) !== monthKey(startNode.t)))]
    : [];

  const todayT = startNode ? startNode.t : (forecast.length ? forecast[0].t : Date.now());

  const fcBand = fcMonthly.map((p) => {
    const mo = Math.max(0, (p.t - todayT) / MONTH_MS);
    return { t: p.t, fc: p.fc, band: [Math.round(p.fc - BAND_DOWN_PER_MONTH * mo), Math.round(p.fc + BAND_UP_PER_MONTH * mo)] as [number, number] };
  });
  const fcEnd = fcBand.length ? fcBand[fcBand.length - 1] : null; // punkt prognozy → pusty okrąg

  const byT = new Map<number, { t: number; ftp?: number; fc?: number; band?: [number, number] }>();
  for (const p of realMonthly) byT.set(p.t, { ...(byT.get(p.t) ?? { t: p.t }), ftp: p.ftp });
  for (const p of fcBand) byT.set(p.t, { ...(byT.get(p.t) ?? { t: p.t }), fc: p.fc, band: p.band });
  const chart = Array.from(byT.values()).sort((a, b) => a.t - b.t);

  const domainStart = realMonthly.length ? realMonthly[0].t : todayT;
  const domainEnd = fcBand.length ? fcBand[fcBand.length - 1].t : todayT;

  const dataVals = [...realMonthly.map((p) => p.ftp), ...fcMonthly.map((p) => p.fc)];
  const dMin = dataVals.length ? Math.min(...dataVals) : 0;
  const dMax = dataVals.length ? Math.max(...dataVals) : 0;
  const yPad = Math.max(3, Math.round((dMax - dMin) * 0.1));

  const monthTicks: number[] = [];
  const ds = new Date(domainStart);
  let mt = new Date(ds.getUTCFullYear(), ds.getUTCMonth(), 15);
  while (mt.getTime() <= domainEnd) { if (mt.getTime() >= domainStart) monthTicks.push(mt.getTime()); mt = new Date(mt.getFullYear(), mt.getMonth() + 1, 15); }

  const lastM = milestones.length ? milestones[milestones.length - 1] : null;
  const earlierM = lastM ? ([...milestones].reverse().find((m) => m.ftp !== lastM.ftp) ?? null) : null;
  const marks = [earlierM, lastM].filter((m): m is Milestone => m != null);

  return (
    <div style={{ position: 'relative' }}>
      <ResponsiveContainer width="100%" height={104}>
        <ComposedChart data={chart} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="engineRealGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.cyan} stopOpacity={0.28} />
              <stop offset="100%" stopColor={C.cyan} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis domain={[dMin - yPad, dMax + yPad]} hide />
          <XAxis
            dataKey="t" type="number" scale="time" domain={[domainStart, domainEnd]} ticks={monthTicks}
            tickFormatter={(t) => new Date(t).toLocaleDateString('pl-PL', { month: 'short' })}
            tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false}
          />
          <Tooltip
            cursor={{ stroke: C.border }}
            contentStyle={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: C.muted }}
            labelFormatter={(t) => new Date(t as number).toLocaleDateString('pl-PL', { month: 'short', year: '2-digit' })}
            formatter={(v, name) => {
              if (Array.isArray(v)) return [`${v[0]}–${v[1]} W`, 'prognoza (zakres)'];
              if (name === 'fc') return [`${v} W`, 'prognoza'];
              return [`${v} W`, 'FTP'];
            }}
          />
          <ReferenceLine x={todayT} stroke={C.border} strokeDasharray="4 4" />
          {/* PROGNOZA — pas niepewności (purple) rozszerza się z horyzontem */}
          <Area dataKey="band" stroke="none" fill={C.purple} fillOpacity={0.14} isAnimationActive={false} connectNulls={false} activeDot={false} />
          {/* PROGNOZA (model) — linia PRZERYWANA "2 6" */}
          <Line dataKey="fc" stroke={C.purple} strokeWidth={1.75} strokeDasharray="2 6" dot={false} isAnimationActive={false} connectNulls />
          {/* HISTORIA (fakt) — linia CIĄGŁA cyan + cień gradientowy */}
          <Area dataKey="ftp" stroke={C.cyan} strokeWidth={2.5} fill="url(#engineRealGrad)" dot={{ r: 2.5, fill: C.cyan, strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} connectNulls />
          {/* PUNKT PROGNOZY — pusty okrąg (fill = tło karty, obrys purple) */}
          {fcEnd && (
            <ReferenceDot x={fcEnd.t} y={fcEnd.fc} r={4.5} fill={C.bg} stroke={C.purple} strokeWidth={2} />
          )}
          {/* Cele — złote kropki + FTP (max 2) */}
          {marks.map((m, i) => (
            <ReferenceDot key={i} x={m.t} y={m.ftp} r={4} fill={C.yellow} stroke={C.bg} strokeWidth={1.5}
              label={{ value: `${m.ftp}`, position: 'top', fill: C.yellow, fontSize: 9.5, fontWeight: 700 }} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      <span style={{ position: 'absolute', top: 4, right: 8, fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', color: C.purple, pointerEvents: 'none' }}>
        PROGNOZA
      </span>
    </div>
  );
}

export function EngineCard({ ftp, vo2Estimate, weightKg, recon, forecast, milestones }: EngineCardProps) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);

  async function acceptEstimate() {
    if (accepting) return;
    setAccepting(true);
    try {
      const res = await fetch('/api/ftp/accept', { method: 'POST' });
      if (!res.ok) throw new Error(`accept failed (${res.status})`);
      router.refresh();
    } catch (e) {
      console.error('ftp accept failed', e);
    } finally {
      setAccepting(false);
    }
  }

  // FTP z rekonstrukcji (spójne z wykresem) ?? wyświetlane. Gain od pierwszego realnego miesiąca.
  const realMonthly = monthlyLast(recon.map((p) => ({ t: dMs(p.date), ftp: p.ftp })));
  const ftpNow = ftp.value;
  const first = realMonthly.length ? realMonthly[0].ftp : (ftpNow ?? 0);
  const gain = ftpNow != null ? ftpNow - first : 0;
  const pct = first > 0 ? Math.round((gain / first) * 100) : 0;
  const fromMonth = realMonthly.length ? PL_MONTH_GEN[new Date(realMonthly[0].t).getUTCMonth()] : '';
  const wkg = weightKg && ftpNow ? ftpNow / weightKg : null;
  const valueColor = ftp.est ? C.yellow : C.cyan;

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.card, padding: 18 }}>
      <CardLabel style={{ marginBottom: 12 }}>Twój silnik</CardLabel>

      {ftp.empty || ftpNow == null ? (
        <div style={{ background: C.bg, borderRadius: RADIUS.card, border: `1px dashed ${C.border}`, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 4 }}>Ustaw FTP w profilu</div>
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
            Prognoza rozwoju pojawi się, gdy poznamy Twój punkt startowy — zrób test 20 min albo jeźdź z miernikiem, a silnik oszacuje FTP sam.
          </div>
        </div>
      ) : (
        <>
          {/* FTP hero: liczba (Space Grotesk) + badge Zmierzone/Szacunek + delta */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: F.display, fontSize: 40, fontWeight: 600, color: valueColor, lineHeight: 1 }}>
                  {ftp.est ? '~' : ''}{ftpNow}
                </span>
                <span style={{ fontSize: 14, color: C.muted }}>W</span>
                {wkg && <span style={{ fontSize: 13, color: C.muted }}>· {wkg.toFixed(2)} W/kg</span>}
                <span style={{
                  fontSize: 9, padding: '2px 7px', borderRadius: 4, fontWeight: 600,
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                  background: ftp.tagColor + '22', color: ftp.tagColor,
                }}>{ftp.tag}</span>
              </div>
            </div>
            {gain !== 0 && (
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: (gain > 0 ? C.green : C.red) + '1E',
                  border: `1px solid ${gain > 0 ? C.green : C.red}44`, borderRadius: RADIUS.pill, padding: '4px 12px',
                }}>
                  {gain > 0 ? <TrendingUp size={15} color={C.green} strokeWidth={2} /> : <TrendingDown size={15} color={C.red} strokeWidth={2} />}
                  <span style={{ fontSize: 15, fontWeight: 600, color: gain > 0 ? C.green : C.red }}>{gain > 0 ? '+' : ''}{gain}W</span>
                </div>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginTop: 4 }}>
                  od {fromMonth} · {gain > 0 ? '+' : ''}{pct}%
                </div>
              </div>
            )}
          </div>

          {/* Estymata silnika do akceptacji (tap = przyjmij jako FTP) */}
          {ftp.pendingEstimate != null && (
            <button
              onClick={acceptEstimate}
              disabled={accepting}
              title="Estymata z 28-dniowej krzywej mocy — tap, żeby przyjąć jako FTP"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 12,
                background: C.yellow + '1A', color: C.yellow, border: `1px solid ${C.yellow}44`,
                borderRadius: 6, padding: '3px 8px', fontSize: 10.5, fontWeight: 600,
                cursor: accepting ? 'default' : 'pointer', opacity: accepting ? 0.6 : 1,
              }}
            >
              ~{ftp.pendingEstimate} W szac. · {accepting ? 'zapisuję…' : 'przyjmij'}
            </button>
          )}

          <FtpChart recon={recon} forecast={forecast} milestones={milestones} />
        </>
      )}

      {/* Pułap tlenowy — wiersz pod wykresem (dawny osobny kafel VO2) */}
      {vo2Estimate != null && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Wind size={18} color={C.green} strokeWidth={2} />
          <span style={{ fontSize: 12, color: C.muted, letterSpacing: '0.02em' }}>Pułap tlenowy</span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span style={{ fontFamily: F.display, fontSize: 20, fontWeight: 600, color: C.green, lineHeight: 1 }}>{vo2Estimate}</span>
            <span style={{ fontSize: 11, color: C.muted }}>ml/kg/min</span>
          </span>
        </div>
      )}
    </div>
  );
}
