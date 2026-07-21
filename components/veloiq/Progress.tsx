'use client';

import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceDot } from 'recharts';
import { C } from '@/lib/theme';
import type { ProgressStats } from '@/lib/progressStats';
import { wkgLabel } from '@/lib/level';
import type { ReconPoint } from '@/lib/ftp-reconstruct';
import { forecastBand, type ForecastPoint, type Milestone } from '@/lib/ftp-forecast';

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

function dMs(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// Próbkowanie miesięczne: ostatni punkt każdego miesiąca (koniec tygodniowego szumu na wykresie).
function monthlyLast<T extends { t: number }>(pts: T[]): T[] {
  const by = new Map<string, T>();
  for (const p of pts) { const d = new Date(p.t); by.set(`${d.getUTCFullYear()}-${d.getUTCMonth()}`, p); }
  return Array.from(by.values()).sort((a, b) => a.t - b.t);
}

const PL_MONTH_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

// ── FTP hero P3: real (envelope, cyan + cień gradientowy) + PROGNOZA (pas niepewności lo-hi purple
// rozszerzający się z horyzontem + linia przerywana) + 1-2 złote markery celów. Punkty MIESIĘCZNE.
// Bez pasów faz w tle. Badge liczony od pierwszego ZREKONSTRUOWANEGO punktu (nie seed). ────
function FtpHero({ recon, forecast, milestones, weightKg, ftpNow }: {
  recon: ReconPoint[]; forecast: ForecastPoint[]; milestones: Milestone[]; weightKg: number | null; ftpNow: number;
}) {
  // Punkty MIESIĘCZNE (ostatni w miesiącu) — koniec tygodniowego szumu na wykresie.
  const realMonthly = monthlyLast(recon.map((p) => ({ t: dMs(p.date), ftp: p.ftp })));
  const realLast = realMonthly.length ? realMonthly[realMonthly.length - 1] : null;

  // STYK real↔forecast: węzeł "dziś" (np. 308) NALEŻY DO OBU serii. monthlyLast nie może go zjeść —
  // dlatego prognoza startuje DOKŁADNIE od punktu styku (t i wartość = ostatni realny punkt), a
  // miesięczne próbkowanie prognozy idzie od NASTĘPNYCH miesięcy. Bez tego cyan i purple się rozłączały.
  const monthKey = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}-${d.getUTCMonth()}`; };
  const fcRaw = forecast.map((p) => ({ t: p.t, fc: p.ftp }));
  const startNode = realLast ? { t: realLast.t, fc: realLast.ftp } : (fcRaw[0] ?? null);
  const fcMonthly = startNode
    ? [startNode, ...monthlyLast(fcRaw.filter((p) => p.t > startNode.t && monthKey(p.t) !== monthKey(startNode.t)))]
    : [];

  // "Dziś" = punkt styku (linia referencyjna + szerokość pasa 0 w tym punkcie).
  const todayT = startNode ? startNode.t : (forecast.length ? forecast[0].t : Date.now());

  // Pas prognozy: frakcje wzrostu środka od dziś (lib/ftp-forecast.forecastBand) — dolna ostrożny
  // wzrost (nigdy poniżej startu, nigdy płaska w BUILD), górna optymistyczna ≤ sufit W/kg. U dziś
  // szerokość 0 (gain=0). anchor = wartość węzła "dziś" (styk real↔forecast).
  const anchor = startNode ? startNode.fc : (fcMonthly[0]?.fc ?? ftpNow);
  const fcBand = forecastBand(fcMonthly, anchor, weightKg);

  // MERGE po t → wiersz "dziś" niesie i ftp (real) i fc/band (forecast) = WSPÓLNY wierzchołek styku.
  const byT = new Map<number, { t: number; ftp?: number; fc?: number; band?: [number, number] }>();
  for (const p of realMonthly) byT.set(p.t, { ...(byT.get(p.t) ?? { t: p.t }), ftp: p.ftp });
  for (const p of fcBand) byT.set(p.t, { ...(byT.get(p.t) ?? { t: p.t }), fc: p.fc, band: p.band });
  const chart = Array.from(byT.values()).sort((a, b) => a.t - b.t);

  const domainStart = realMonthly.length ? realMonthly[0].t : todayT; // oś od pierwszego realnego punktu
  const domainEnd = fcBand.length ? fcBand[fcBand.length - 1].t : todayT;

  // BADGE OD PRAWDY: przyrost od PIERWSZEGO MIESIĘCZNEGO punktu rekonstrukcji — nie od seedu ani
  // tygodniowego artefaktu krawędzi okna. Format "+NW · od {miesiąc}".
  const first = realMonthly.length ? realMonthly[0].ftp : ftpNow;
  const gain = ftpNow - first;
  const pct = first > 0 ? Math.round((gain / first) * 100) : 0;
  const fromMonth = realMonthly.length ? PL_MONTH_GEN[new Date(realMonthly[0].t).getUTCMonth()] : '';
  const wkg = weightKg ? ftpNow / weightKg : null;
  const levelLabel = wkg != null ? wkgLabel(wkg) : null;

  // OŚ Y z DANYCH: realne punkty + CENTRALNA linia prognozy (fc), NIE krawędzie pasa. Pas może lekko
  // wystawać poza kadr — to OK, dane mają wypełniać wykres (~85% wys. zamiast ~60%). Margines ~10%
  // zakresu (min 3W), zamiast sztywnych ±8 → cień cyan odzyskuje wysokość, koniec pustki u dołu.
  const dataVals = [...realMonthly.map((p) => p.ftp), ...fcMonthly.map((p) => p.fc)];
  const dMin = dataVals.length ? Math.min(...dataVals) : ftpNow - 15;
  const dMax = dataVals.length ? Math.max(...dataVals) : ftpNow + 15;
  const yPad = Math.max(3, Math.round((dMax - dMin) * 0.1));

  const monthTicks: number[] = [];
  const ds = new Date(domainStart);
  let mt = new Date(ds.getUTCFullYear(), ds.getUTCMonth(), 15);
  while (mt.getTime() <= domainEnd) { if (mt.getTime() >= domainStart) monthTicks.push(mt.getTime()); mt = new Date(mt.getFullYear(), mt.getMonth() + 1, 15); }

  // Cele: max 2 złote markery — ostatni (np. Nannup) obowiązkowo + najpóźniejszy wcześniejszy o INNEJ
  // wartości FTP (np. Hlinsko), jeśli jest. Bez etykiet faz.
  const lastM = milestones.length ? milestones[milestones.length - 1] : null;
  const earlierM = lastM ? ([...milestones].reverse().find((m) => m.ftp !== lastM.ftp) ?? null) : null;
  const marks = [earlierM, lastM].filter((m): m is Milestone => m != null);

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
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginTop: 4 }}>
              od {fromMonth} · {gain > 0 ? '+' : ''}{pct}%
            </div>
          </div>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <ResponsiveContainer width="100%" height={104}>
          <ComposedChart data={chart} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="ftpRealGrad" x1="0" y1="0" x2="0" y2="1">
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
                if (Array.isArray(v)) return [`${v[0]}–${v[1]} W`, 'prognoza przy realizacji planu (zakres)'];
                if (name === 'fc') return [`${v} W`, 'prognoza przy realizacji planu'];
                return [`${v} W`, 'FTP'];
              }}
            />
            {/* PROGNOZA + podpis zakotwiczone do STYKU (todayT = początek przerywanego odcinka), a nie
                do piksela rogu. textAnchor="end" → etykieta rozciąga się w LEWO nad ogonem historii,
                czysto od wartości końcowej "318" (prawy koniec) i od najbliższego marka "310" (tuż na
                prawo od styku). viewBox.x = piksel todayT liczony przez Recharts z danych → skaluje się
                dla dowolnego FTP i długości prognozy. */}
            <ReferenceLine
              x={todayT}
              stroke={C.border}
              strokeDasharray="4 4"
              label={(props: { viewBox?: { x?: number; y?: number } }) => {
                const vx = props.viewBox?.x ?? 0;
                const vy = props.viewBox?.y ?? 0;
                return (
                  <g pointerEvents="none">
                    <text x={vx - 4} y={vy + 9} textAnchor="end" fontSize={8} fontWeight={700} letterSpacing="0.12em" fill={C.purple}>PROGNOZA</text>
                    <text x={vx - 4} y={vy + 18} textAnchor="end" fontSize={7.5} fontWeight={600} fill={C.muted}>przy realizacji planu</text>
                  </g>
                );
              }}
            />
            {/* PROGNOZA — pas niepewności lo-hi (purple ~14%), rozszerza się z horyzontem */}
            <Area dataKey="band" stroke="none" fill={C.purple} fillOpacity={0.14} isAnimationActive={false} connectNulls={false} activeDot={false} />
            {/* środkowa linia prognozy — przerywana purple */}
            <Line dataKey="fc" stroke={C.purple} strokeWidth={1.75} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls />
            {/* HISTORIA — cień gradientowy cyan→transparent + ciągła linia cyan na wierzchu */}
            <Area dataKey="ftp" stroke={C.cyan} strokeWidth={2.5} fill="url(#ftpRealGrad)" dot={{ r: 2.5, fill: C.cyan, strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} connectNulls />
            {/* Cele: złote kropki + FTP (max 2) */}
            {marks.map((m, i) => (
              <ReferenceDot key={i} x={m.t} y={m.ftp} r={4} fill={C.yellow} stroke={C.bg} strokeWidth={1.5}
                label={{ value: `${m.ftp}`, position: 'top', fill: C.yellow, fontSize: 9.5, fontWeight: 700 }} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
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
