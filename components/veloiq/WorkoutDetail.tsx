'use client';

import { C } from '@/lib/theme';
import { ZoneBar } from './ZoneBar';
import { WorkoutProfile } from './WorkoutProfile';
import { typeColor, fmtDur, dowLabel, dateLabel, ZONE_COLORS } from '@/lib/plan';
import { buildWorkout } from '@/lib/workout';
import type { PlanDayView } from './Plan';

interface WorkoutDetailProps {
  day: PlanDayView;
  ftp: number;
  onClose: () => void;
}

function SectionTitle({ color, children }: { color: string; children: string }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '2px', color, textTransform: 'uppercase', marginBottom: 10 }}>
      {children}
    </div>
  );
}

export function WorkoutDetail({ day, ftp, onClose }: WorkoutDetailProps) {
  const tc = typeColor(day.type);
  const wk = buildWorkout({ type: day.type, label: day.label, dur_min: day.dur_min, warmup: day.warmup, cooldown: day.cooldown }, ftp);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: C.bg, overflowY: 'auto', color: C.text }}>
      {/* Sticky header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'rgba(6,8,10,0.9)', backdropFilter: 'blur(16px)', borderBottom: `1px solid ${C.border}`, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onClose} aria-label="Zamknij" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, cursor: 'pointer', padding: '6px 10px', color: C.muted, fontSize: 16, lineHeight: 1 }}>×</button>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', color: tc }}>PLANOWANY TRENING</div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '20px 16px 48px' }}>
        {/* Nagłówek */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ background: tc + '22', color: tc, border: `1px solid ${tc}55`, borderRadius: 5, padding: '3px 10px', fontSize: 11, fontWeight: 600 }}>{day.type}</span>
            <span style={{ fontSize: 12, color: C.muted }}>{dowLabel(day.date)} · {dateLabel(day.date)}</span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: '#fff' }}>{day.label}</h1>
        </div>

        {/* Statystyki docelowe */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 16 }}>
          {([['CZAS', fmtDur(day.dur_min), C.text], ['MOC śr', day.watt, C.cyan], ['HR', day.hr, C.red], ['TSS', String(day.tss), C.yellow]] as const).map(([l, v, c]) => (
            <div key={l} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2, color: c }}>{v}</div>
              <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{l}</div>
            </div>
          ))}
        </div>

        {/* Cel sesji */}
        <div style={{ background: tc + '0E', border: `1px solid ${tc}30`, borderRadius: 10, padding: '12px 14px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>🎯</div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 600, color: tc, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 3 }}>Cel sesji</div>
            <p style={{ fontSize: 12.5, color: '#C2C7CF', lineHeight: 1.6 }}>{wk.goal}</p>
          </div>
        </div>

        {/* Profil sesji — wizualny wykres mocy w czasie */}
        {wk.expanded.length > 0 && (
          <>
            <SectionTitle color={tc}>Profil sesji</SectionTitle>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 14px 10px', marginBottom: 16 }}>
              <WorkoutProfile expanded={wk.expanded} ftp={ftp} />
            </div>
          </>
        )}

        {/* Struktura sesji */}
        <SectionTitle color={tc}>Struktura sesji</SectionTitle>
        <div style={{ marginBottom: 16 }}>
          {wk.segs.map((s, i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: s.c, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
                  {s.k}{s.reps && <span style={{ fontSize: 10, color: s.c, marginLeft: 6, fontWeight: 600 }}>● interwały</span>}
                </div>
                {s.note && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>{s.note}</div>}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: s.c }}>{s.t}</div>
                <div style={{ fontSize: 10.5, color: '#C2C7CF', marginTop: 1 }}>{s.w}</div>
                {s.hr && <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>{s.hr} bpm</div>}
              </div>
            </div>
          ))}
        </div>

        {/* Wskazówki wykonania */}
        <SectionTitle color={tc}>Wskazówki wykonania</SectionTitle>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
          {wk.tips.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 9, marginBottom: i < wk.tips.length - 1 ? 9 : 0, alignItems: 'flex-start' }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: tc, marginTop: 6, flexShrink: 0 }} />
              <div style={{ fontSize: 12, color: '#C2C7CF', lineHeight: 1.5 }}>{t}</div>
            </div>
          ))}
        </div>

        {/* Co zabrać ze sobą */}
        {wk.nutrition && (
          <>
            <SectionTitle color={tc}>Co zabrać ze sobą</SectionTitle>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ fontSize: 22, flexShrink: 0 }}>💧</div>
                  <div>
                    <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.5px', fontWeight: 600, marginBottom: 2 }}>PICIE</div>
                    <div style={{ fontSize: 12.5, color: C.text, fontWeight: 600, lineHeight: 1.4 }}>{wk.nutrition.drink}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ fontSize: 22, flexShrink: 0 }}>🍌</div>
                  <div>
                    <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.5px', fontWeight: 600, marginBottom: 2 }}>JEDZENIE</div>
                    <div style={{ fontSize: 12.5, color: wk.nutrition.short ? C.muted : C.text, fontWeight: 600, lineHeight: 1.4 }}>{wk.nutrition.food}</div>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>{wk.nutrition.note}</div>
            </div>
          </>
        )}

        {/* Rozkład stref mocy */}
        {day.type !== 'OFF' && (
          <>
            <SectionTitle color={tc}>Rozkład stref mocy</SectionTitle>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
              <ZoneBar zones={day.zones} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                {['Z1', 'Z2', 'Z3', 'Z4', 'Z5'].map((z, i) => (
                  <div key={z} style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ width: 9, height: 9, borderRadius: 2, background: ZONE_COLORS[i], margin: '0 auto 4px' }} />
                    <div style={{ fontSize: 11, fontWeight: 600 }}>{day.zones[i]}%</div>
                    <div style={{ fontSize: 8, color: C.muted }}>{z}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
