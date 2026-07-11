'use client';

// Karta "NAJBLIŻSZY CEL" (mockup Races): pierścień PRZYGOTOWANIE + faza + odliczanie + sparkline
// CTL 21 dni + cel kwalifikacyjny + oś cyklu Budowanie→Peak→Taper z markerem TERAZ.
import { useId } from 'react';
import { LineChart, Line, YAxis, ResponsiveContainer } from 'recharts';
import { C } from '@/lib/theme';
import type { RacePrep, RacePhase } from '@/lib/race-prep';
import { countryFlag } from '@/lib/country-flag';
import type { RaceRow } from './Races';

// Tony pierścienia wg prep% (mockup: ≥80 green, ≥45 cyan, reszta yellow). Gradient light→deep
// + glow — estetyka ExecutionRing, ale progi celu przygotowania, nie realizacji sesji.
function ringTone(prep: number): { deep: string; light: string; glow: string } {
  if (prep >= 80) return { deep: '#4bbf7d', light: '#8fe6b0', glow: 'rgba(75,191,125,0.5)' };
  if (prep >= 45) return { deep: '#4A8FC7', light: '#8fc0e6', glow: 'rgba(74,143,199,0.5)' };
  return { deep: '#d9ab3a', light: '#f0d478', glow: 'rgba(217,171,58,0.5)' };
}

const SIZE = 92;
const STROKE = 9;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

function PrepRing({ prep }: { prep: number }) {
  const t = ringTone(prep);
  const gradId = useId();
  const offset = CIRC * (1 - prep / 100);
  return (
    <div style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={t.light} />
            <stop offset="100%" stopColor={t.deep} />
          </linearGradient>
        </defs>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={`url(#${gradId})`} strokeWidth={STROKE}
          strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={offset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{ filter: `drop-shadow(0 0 5px ${t.glow})` }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, fontWeight: 700, color: t.deep,
      }}>
        {prep}%
      </div>
    </div>
  );
}

const PHASES: { name: RacePhase; sub: string; color: string; flex: number }[] = [
  { name: 'Budowanie', sub: 'objętość + próg', color: C.cyan, flex: 2 },
  { name: 'Peak', sub: 'maks. obciążenie', color: C.yellow, flex: 1 },
  { name: 'Taper', sub: 'wyostrzenie formy', color: C.green, flex: 1 },
];

export default function RacePrepCard({
  race, prep, sparkline,
}: { race: RaceRow; prep: RacePrep; sparkline: { label: string; ctl: number }[] }) {
  const activeIdx = prep.phase === 'Budowanie' ? 0 : prep.phase === 'Peak' ? 1 : 2;
  const flag = countryFlag(race.location);
  const ctlMin = sparkline.length ? Math.min(...sparkline.map((p) => p.ctl)) : 0;
  const ctlMax = sparkline.length ? Math.max(...sparkline.map((p) => p.ctl)) : 0;
  const meta = [race.location, race.distance_km ? `${race.distance_km} km` : null].filter(Boolean).join(' · ');

  return (
    <div style={{ background: '#0C1827', border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
      <div style={{ fontSize: 9, color: C.green, letterSpacing: '0.12em', fontWeight: 700, marginBottom: 12 }}>
        NAJBLIŻSZY CEL{race.series ? ` · ${race.series.toUpperCase()}` : ''}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        {/* Pierścień + faza */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 8, color: C.muted, letterSpacing: '0.1em', fontWeight: 700 }}>PRZYGOTOWANIE</div>
          <PrepRing prep={prep.prep} />
          <div style={{
            background: prep.phaseColor + '1E', color: prep.phaseColor, border: `1px solid ${prep.phaseColor}44`,
            borderRadius: 20, padding: '4px 14px', fontSize: 11, fontWeight: 600,
          }}>
            Faza: {prep.phase}
          </div>
        </div>

        {/* Prawa kolumna */}
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 600, fontSize: 22, marginBottom: 2, color: C.text }}>
            {flag ? `${flag} ` : ''}{race.name}
          </div>
          {meta && <div style={{ color: C.muted, fontSize: 12, marginBottom: 14 }}>{meta}</div>}

          <div style={{ display: 'flex', gap: 20, marginBottom: 14, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 34, fontWeight: 600, color: C.green, lineHeight: 1 }}>{Math.max(0, prep.daysOut)}</div>
              <div style={{ fontSize: 10, color: C.muted }}>dni do startu</div>
            </div>
            <div style={{ borderLeft: `1px solid ${C.border}`, paddingLeft: 20, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.cyan }}>Forma rośnie ↗</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>cel: CTL {prep.targetCtl} na start</div>
                <div style={{ fontSize: 11, color: C.muted }}>jesteś na {prep.nowCtl} — {prep.prep}% drogi</div>
              </div>
              {sparkline.length >= 2 && (
                <div style={{ width: 96, height: 46 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sparkline} margin={{ top: 6, right: 2, left: 2, bottom: 2 }}>
                      <YAxis domain={[ctlMin - 1.5, ctlMax + 1.5]} hide />
                      <Line type="monotone" dataKey="ctl" stroke={C.cyan} strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                  <div style={{ fontSize: 8, color: C.muted, textAlign: 'center', marginTop: -2 }}>21 dni</div>
                </div>
              )}
            </div>
          </div>

          {race.qualification_goal && (
            <div style={{ fontSize: 11, color: C.muted, background: C.bg, borderRadius: 8, padding: '8px 10px', border: `1px solid ${C.border}` }}>
              🎯 {race.qualification_goal}
            </div>
          )}
        </div>
      </div>

      {/* Oś cyklu Budowanie → Peak → Taper */}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.1em', fontWeight: 700, marginBottom: 12 }}>
          CYKL PRZYGOTOWAŃ DO STARTU
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {PHASES.map((p, i) => {
            const active = i === activeIdx;
            const done = i < activeIdx;
            return (
              <div key={p.name} style={{ flex: p.flex }}>
                <div style={{ height: 6, borderRadius: 3, background: done || active ? p.color : C.dim, opacity: done ? 0.4 : 1, marginBottom: 8 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: active ? 700 : 500, color: active ? p.color : done ? C.muted : C.text }}>{p.name}</span>
                  {active && (
                    <span style={{ background: p.color, color: C.bg, fontSize: 7, fontWeight: 700, padding: '1px 6px', borderRadius: 3, letterSpacing: '0.08em' }}>TERAZ</span>
                  )}
                </div>
                <div style={{ fontSize: 9, color: C.muted }}>{p.sub}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
