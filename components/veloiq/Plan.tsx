'use client';

import { C } from '@/lib/theme';
import { ZoneBar } from './ZoneBar';
import { typeColor, fmtDur, dowLabel, dateLabel, weekRangeLabel } from '@/lib/plan';

export interface PlanDayView {
  dow: number;
  date: string;       // ISO
  type: string;
  label: string;
  tss: number;
  dur_min: number;
  watt: string;
  hr: string;
  zones: number[];
}

interface PlanProps {
  days: PlanDayView[];
  insight: string;
  weekStart: string;
  todayISO: string;
}

const card: React.CSSProperties = {
  background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px',
};

export function Plan({ days, insight, weekStart, todayISO }: PlanProps) {
  // Statsy liczone z planu
  const sessions = days.filter((d) => d.type !== 'OFF').length;
  const totalDur = days.reduce((a, d) => a + d.dur_min, 0);
  const totalTss = days.reduce((a, d) => a + d.tss, 0);

  return (
    <div className="flex flex-col gap-3">
      {/* Header tygodnia (5.2: bez strzałek — nawigacja w 5.3) */}
      <div style={{ ...card, padding: '10px 14px', textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Bieżący tydzień</span>
          <span style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.1em', color: C.bg, background: C.cyan, borderRadius: 4, padding: '2px 7px' }}>
            TERAZ
          </span>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{weekRangeLabel(weekStart)}</div>
      </div>

      {/* AI INSIGHT — realny z plan_json.insight */}
      {insight && (
        <div style={{ ...card, borderLeft: `3px solid ${C.cyan}`, borderRadius: '0 12px 12px 0', paddingLeft: 14 }}>
          <div style={{ fontSize: 9, color: C.cyan, letterSpacing: '0.12em', fontWeight: 600, marginBottom: 7 }}>
            AI INSIGHT — PLAN TYGODNIA
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: C.text }}>{insight}</div>
        </div>
      )}

      {/* STATS: SESJE / CZAS / LOAD */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {([
          ['SESJE', String(sessions), 'jednostki'],
          ['CZAS', fmtDur(totalDur), 'łącznie'],
          ['LOAD', String(totalTss), 'TSS'],
        ] as const).map(([l, v, s]) => (
          <div key={l} style={{ ...card, textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.12em', fontWeight: 600, marginBottom: 4 }}>{l}</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: C.cyan }}>{v}</div>
            <div style={{ fontSize: 9, color: C.muted }}>{s}</div>
          </div>
        ))}
      </div>

      {/* KARTY DNI (5.2: statyczne — klik w WorkoutDetail dochodzi w 5.4) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {days.map((d, i) => {
          const tc = typeColor(d.type);
          const isToday = d.date === todayISO;
          const isOff = d.type === 'OFF';
          return (
            <div key={i} style={{ ...card, padding: '12px 14px', border: isToday ? `1px solid ${C.cyan}` : `1px solid ${C.border}`, position: 'relative' }}>
              {isToday && (
                <div style={{ position: 'absolute', top: -8, left: 14, background: C.cyan, color: C.bg, fontSize: 8, fontWeight: 600, padding: '2px 8px', borderRadius: 4, letterSpacing: '0.1em' }}>
                  DZIŚ
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {/* dzień + data — dzień wyprowadzony Z DATY, nie z pola dow */}
                <div style={{ width: 42, textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{dowLabel(d.date)}</div>
                  <div style={{ fontSize: 9, color: C.muted }}>{dateLabel(d.date)}</div>
                </div>
                <div style={{ width: 50 }}>
                  <span style={{ background: tc + '22', color: tc, border: `1px solid ${tc}55`, borderRadius: 4, padding: '2px 7px', fontSize: 9, fontWeight: 600 }}>
                    {d.type}
                  </span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: C.text }}>{d.label}</div>
                  {!isOff && <ZoneBar zones={d.zones} />}
                </div>
                {!isOff ? (
                  <div style={{ display: 'flex', gap: 14, textAlign: 'right', alignItems: 'center' }}>
                    <div><div style={{ fontSize: 8, color: C.muted, fontWeight: 600 }}>CZAS</div><div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{fmtDur(d.dur_min)}</div></div>
                    <div><div style={{ fontSize: 8, color: C.muted, fontWeight: 600 }}>MOC</div><div style={{ fontSize: 12, fontWeight: 600, color: C.cyan }}>{d.watt}</div></div>
                    <div><div style={{ fontSize: 8, color: C.muted, fontWeight: 600 }}>HR</div><div style={{ fontSize: 12, fontWeight: 600, color: C.red }}>{d.hr}</div></div>
                    <div><div style={{ fontSize: 8, color: C.muted, fontWeight: 600 }}>TSS</div><div style={{ fontSize: 13, fontWeight: 600, color: C.yellow }}>{d.tss}</div></div>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic' }}>Pełna regeneracja</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
