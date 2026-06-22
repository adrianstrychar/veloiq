'use client';

import { useState } from 'react';
import { C } from '@/lib/theme';
import { ZoneBar } from './ZoneBar';
import { typeColor, fmtDur, dowLabel, dateLabel, weekRangeLabel, type WeekKind } from '@/lib/plan';

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
  outline?: boolean;
}

export interface WeekSlot {
  weekStart: string;
  kind: WeekKind;
  days: PlanDayView[] | null;   // null = brak planu na ten tydzień
  insight: string;
}

interface PlanProps {
  weeks: WeekSlot[];
  currentIdx: number;
  todayISO: string;
}

const card: React.CSSProperties = {
  background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px',
};

// Etykieta tygodnia względem bieżącego (idx 0=poprzedni … 3=za 2 tyg)
function weekLabel(idx: number, currentIdx: number): string {
  const d = idx - currentIdx;
  if (d === 0) return 'Bieżący tydzień';
  if (d === -1) return 'Poprzedni tydzień';
  if (d === 1) return 'Kolejny tydzień';
  if (d === 2) return 'Za 2 tygodnie';
  return d < 0 ? `${-d} tyg. temu` : `Za ${d} tygodnie`;
}

// ── Karta dnia ──────────────────────────────────────────────────────────────

function Cell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 8, color: C.muted, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: color ?? C.text }}>{value}</div>
    </div>
  );
}

function DayCard({ d, isToday }: { d: PlanDayView; isToday: boolean }) {
  const tc = typeColor(d.type);
  const isOff = d.type === 'OFF';
  const isOutline = !!d.outline;

  return (
    <div style={{
      ...card, padding: '12px 14px', position: 'relative',
      border: isToday ? `1px solid ${C.cyan}` : `1px solid ${C.border}`,
      opacity: isOutline ? 0.6 : 1,
    }}>
      {isToday && (
        <div style={{ position: 'absolute', top: -8, left: 14, background: C.cyan, color: C.bg, fontSize: 8, fontWeight: 600, padding: '2px 8px', borderRadius: 4, letterSpacing: '0.1em' }}>
          DZIŚ
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
        {isOff ? (
          <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic' }}>Pełna regeneracja</div>
        ) : isOutline ? (
          // ZARYS: bez watt/hr (są "–"), tylko orientacyjny czas + ~TSS
          <div style={{ display: 'flex', gap: 14, textAlign: 'right', alignItems: 'center' }}>
            <Cell label="CZAS" value={`~${fmtDur(d.dur_min)}`} />
            <Cell label="~TSS" value={`${d.tss}`} color={C.yellow} />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 14, textAlign: 'right', alignItems: 'center' }}>
            <Cell label="CZAS" value={fmtDur(d.dur_min)} />
            <Cell label="MOC" value={d.watt} color={C.cyan} />
            <Cell label="HR" value={d.hr} color={C.red} />
            <Cell label="TSS" value={`${d.tss}`} color={C.yellow} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Plan ──────────────────────────────────────────────────────────────────────

export function Plan({ weeks, currentIdx, todayISO }: PlanProps) {
  const [idx, setIdx] = useState(currentIdx);
  const week = weeks[idx];
  const isCurrent = week.kind === 'current';
  const isPast = week.kind === 'past';
  const isFuture = week.kind === 'future';

  const days = week.days;
  const isOutlineWeek = !!days && days.some((d) => d.outline);
  const sessions = days ? days.filter((d) => d.type !== 'OFF').length : 0;
  const totalDur = days ? days.reduce((a, d) => a + d.dur_min, 0) : 0;
  const totalTss = days ? days.reduce((a, d) => a + d.tss, 0) : 0;

  return (
    <div className="flex flex-col gap-3">
      {/* WEEK NAVIGATION — strzałki ‹ › */}
      <div style={{ ...card, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx <= 0}
          style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 9, width: 36, height: 36, color: idx <= 0 ? C.dim : C.text, cursor: idx <= 0 ? 'default' : 'pointer', fontSize: 18, flexShrink: 0 }}
        >‹</button>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{weekLabel(idx, currentIdx)}</span>
            {isCurrent && <span style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.1em', color: C.bg, background: C.cyan, borderRadius: 4, padding: '2px 7px' }}>TERAZ</span>}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
            {weekRangeLabel(week.weekStart)}{isPast && ' · miniony'}{isFuture && ' · zarys'}
          </div>
        </div>
        <button
          onClick={() => setIdx((i) => Math.min(weeks.length - 1, i + 1))}
          disabled={idx >= weeks.length - 1}
          style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 9, width: 36, height: 36, color: idx >= weeks.length - 1 ? C.dim : C.text, cursor: idx >= weeks.length - 1 ? 'default' : 'pointer', fontSize: 18, flexShrink: 0 }}
        >›</button>
      </div>

      {/* Baner kontekstowy dla tygodni ≠ bieżący */}
      {!isCurrent && (
        <div style={{ ...card, padding: '10px 13px', display: 'flex', alignItems: 'center', gap: 9, borderLeft: `3px solid ${isPast ? C.muted : C.cyan}`, borderRadius: '0 12px 12px 0' }}>
          <span style={{ fontSize: 15 }}>{isPast ? '✓' : '📋'}</span>
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.45 }}>
            {isPast
              ? 'Tydzień miniony.'
              : 'Tydzień orientacyjny — dokładna rozpiska dopnie się, gdy się zbliży.'}
          </div>
          <button onClick={() => setIdx(currentIdx)} style={{ flexShrink: 0, marginLeft: 'auto', background: C.cyan + '1E', color: C.cyan, border: `1px solid ${C.cyan}55`, borderRadius: 7, padding: '6px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Bieżący</button>
        </div>
      )}

      {days ? (
        <>
          {/* AI INSIGHT */}
          {week.insight && (
            <div style={{ ...card, borderLeft: `3px solid ${C.cyan}`, borderRadius: '0 12px 12px 0', paddingLeft: 14 }}>
              <div style={{ fontSize: 9, color: C.cyan, letterSpacing: '0.12em', fontWeight: 600, marginBottom: 7 }}>
                AI INSIGHT — {isPast ? 'PODSUMOWANIE TYGODNIA' : isFuture ? 'ZARYS TYGODNIA' : 'PLAN TYGODNIA'}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: C.text }}>{week.insight}</div>
            </div>
          )}

          {/* STATS */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {([
              ['SESJE', String(sessions), 'jednostki'],
              ['CZAS', `${isOutlineWeek ? '~' : ''}${fmtDur(totalDur)}`, 'łącznie'],
              ['LOAD', `${isOutlineWeek ? '~' : ''}${totalTss}`, isOutlineWeek ? 'TSS · zarys' : 'TSS'],
            ] as const).map(([l, v, s]) => (
              <div key={l} style={{ ...card, textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.12em', fontWeight: 600, marginBottom: 4 }}>{l}</div>
                <div style={{ fontSize: 24, fontWeight: 600, color: C.cyan }}>{v}</div>
                <div style={{ fontSize: 9, color: C.muted }}>{s}</div>
              </div>
            ))}
          </div>

          {/* KARTY DNI (5.3: nieklikalne — WorkoutDetail w 5.4) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {days.map((d, i) => (
              <DayCard key={i} d={d} isToday={isCurrent && d.date === todayISO} />
            ))}
          </div>
        </>
      ) : (
        // Stan pusty — brak planu dla tego tygodnia.
        // TODO 5.7: tutaj przycisk "Wygeneruj plan" (client) → POST /api/plan/generate.
        <div style={{ ...card, padding: '28px 18px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <div style={{ fontSize: 28 }}>📋</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Brak planu na ten tydzień</div>
          <div style={{ fontSize: 12, color: C.muted, maxWidth: 280, lineHeight: 1.5 }}>
            Plan dla tego tygodnia nie został jeszcze wygenerowany.
          </div>
          {/* TODO 5.7: <GeneratePlanButton weekStart={week.weekStart} /> */}
        </div>
      )}
    </div>
  );
}
