'use client';

import { useMemo, useState } from 'react';
import { C } from '@/lib/theme';
import { RideAnalysis, type RideActivity } from './RideAnalysis';
import { type RaceRow } from './Races';

// Aktywność w kalendarzu = pełny RideActivity + identyfikacja i flaga analizy.
export interface CalActivity extends RideActivity {
  strava_activity_id: number;
  details_synced_at: string | null;
}

// Zdarzenie kalendarza — dyskryminowane po kind.
// TODO Etap 5: dojdzie kind:'training' z tabeli planu treningowego (weekly_plans / training_sessions).
type CalEvent =
  | {
      kind: 'activity';
      date: string;
      label: string;
      color: string;
      tss: number | null;
      activity: CalActivity;
      clickable: boolean;
    }
  | {
      kind: 'race';
      date: string;
      label: string;
      color: string;
      tss: null;
      race: RaceRow;
    };

interface CalendarProps {
  activities: CalActivity[];
  races: RaceRow[];
  ftp: number | null;
  onRaceClick: () => void;
}

// Zakres nawigacji: marzec–październik 2026 (sezon).
const MIN_MONTH = { y: 2026, m: 2 };  // marzec (0-idx)
const MAX_MONTH = { y: 2026, m: 9 };  // październik
const MONTH_NAMES = [
  'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
  'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień',
];
const WEEKDAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Kolor aktywności wg typu: gravel=yellow, reszta (szosa/trener)=cyan.
// TODO: sport_type leży w raw_data — doprecyzować gravel vs road po nim.
function activityColor(type: string | null): string {
  if (type && type.toLowerCase().includes('gravel')) return C.yellow;
  return C.cyan;
}

function monthIndex(y: number, m: number): number {
  return y * 12 + m;
}

export function Calendar({ activities, races, ftp, onRaceClick }: CalendarProps) {
  const todayStr = ymd(new Date());

  // Domyślny miesiąc: bieżący, ale przycięty do zakresu sezonu.
  const initial = useMemo(() => {
    const now = new Date();
    let y = now.getFullYear();
    let m = now.getMonth();
    const idx = monthIndex(y, m);
    if (idx < monthIndex(MIN_MONTH.y, MIN_MONTH.m)) return { ...MIN_MONTH };
    if (idx > monthIndex(MAX_MONTH.y, MAX_MONTH.m)) return { ...MAX_MONTH };
    return { y, m };
  }, []);

  const [cursor, setCursor] = useState(initial);
  const [hovered, setHovered] = useState<string | null>(null);
  const [openActivity, setOpenActivity] = useState<CalActivity | null>(null);

  // Zbuduj zdarzenia z obu źródeł i pogrupuj po dacie.
  const eventsByDate = useMemo(() => {
    const events: CalEvent[] = [];

    for (const a of activities) {
      events.push({
        kind: 'activity',
        date: a.activity_date,
        label: a.name ?? a.type ?? 'Jazda',
        color: activityColor(a.type),
        tss: a.tss,
        activity: a,
        clickable: !!a.details_synced_at,
      });
    }

    for (const r of races) {
      events.push({
        kind: 'race',
        date: r.date,
        label: r.name,
        color: C.red,
        tss: null,
        race: r,
      });
    }

    // TODO Etap 5: tutaj wepną się treningi z planu (kind:'training').

    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      const key = e.date.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [activities, races]);

  // Statystyki bieżącego miesiąca.
  const monthStats = useMemo(() => {
    let count = 0;
    let tss = 0;
    const prefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`;
    for (const [date, evs] of eventsByDate) {
      if (date.startsWith(prefix)) {
        count += evs.length;
        for (const e of evs) tss += e.tss ?? 0;
      }
    }
    return { count, tss: Math.round(tss) };
  }, [eventsByDate, cursor]);

  // Siatka dni: wiodące puste (Pn-based) + dni miesiąca.
  const grid = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const jsDay = first.getDay();           // 0=Nd
    const lead = (jsDay + 6) % 7;            // ile pustych przed 1-szym (Pn-based)
    const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(ymd(new Date(cursor.y, cursor.m, d)));
    }
    return cells;
  }, [cursor]);

  // Sekcja "Plan na najbliższe 14 dni" — jazdy + wyścigi z [dziś, dziś+14].
  const next14 = useMemo(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 14);
    const out: CalEvent[] = [];
    for (const [date, evs] of eventsByDate) {
      const d = new Date(date + 'T00:00:00');
      if (d >= start && d <= end) out.push(...evs);
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [eventsByDate]);

  const curIdx = monthIndex(cursor.y, cursor.m);
  const canPrev = curIdx > monthIndex(MIN_MONTH.y, MIN_MONTH.m);
  const canNext = curIdx < monthIndex(MAX_MONTH.y, MAX_MONTH.m);

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const idx = monthIndex(c.y, c.m) + delta;
      const min = monthIndex(MIN_MONTH.y, MIN_MONTH.m);
      const max = monthIndex(MAX_MONTH.y, MAX_MONTH.m);
      const clamped = Math.max(min, Math.min(max, idx));
      return { y: Math.floor(clamped / 12), m: clamped % 12 };
    });
  }

  function handleDayClick(dateKey: string) {
    const evs = eventsByDate.get(dateKey);
    if (!evs || evs.length === 0) return;
    const race = evs.find((e) => e.kind === 'race');
    const clickableRide = evs.find((e) => e.kind === 'activity' && e.clickable) as
      | Extract<CalEvent, { kind: 'activity' }>
      | undefined;
    if (clickableRide) {
      setOpenActivity(clickableRide.activity);
    } else if (race) {
      onRaceClick();
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Nagłówek miesiąca + nawigacja */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={() => shiftMonth(-1)}
          disabled={!canPrev}
          style={navBtn(canPrev)}
        >
          ‹
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, textTransform: 'capitalize' }}>
            {MONTH_NAMES[cursor.m]} {cursor.y}
          </div>
          <div style={{ fontSize: 11, color: C.muted }}>
            {monthStats.count} {eventWord(monthStats.count)} · {monthStats.tss} TSS
          </div>
        </div>
        <button
          onClick={() => shiftMonth(1)}
          disabled={!canNext}
          style={navBtn(canNext)}
        >
          ›
        </button>
      </div>

      {/* Nagłówki dni tygodnia */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ fontSize: 10, color: C.muted, textAlign: 'center', fontWeight: 600 }}>
            {w}
          </div>
        ))}
      </div>

      {/* Siatka dni */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, position: 'relative' }}>
        {grid.map((dateKey, i) => {
          if (!dateKey) return <div key={`b${i}`} style={{ minHeight: 60 }} />;

          const evs = eventsByDate.get(dateKey) ?? [];
          const hasRace = evs.some((e) => e.kind === 'race');
          const hasEvent = evs.length > 0;
          const isToday = dateKey === todayStr;
          const isPast = dateKey < todayStr;
          const dayNum = Number(dateKey.slice(8, 10));
          const first = evs[0];

          let bg = 'transparent';
          let border = `1px solid transparent`;
          if (hasRace) {
            bg = C.red + '14';
            border = `1px solid ${C.red}44`;
          } else if (hasEvent) {
            bg = C.card;
            border = `1px solid ${C.border}`;
          }
          if (isToday) border = `1.5px solid ${C.cyan}`;

          const opacity = !hasEvent && isPast ? 0.25 : 1;

          return (
            <div
              key={dateKey}
              onMouseEnter={() => hasEvent && setHovered(dateKey)}
              onMouseLeave={() => setHovered((h) => (h === dateKey ? null : h))}
              onClick={() => handleDayClick(dateKey)}
              style={{
                minHeight: 60,
                borderRadius: 8,
                background: bg,
                border,
                padding: 4,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                cursor: hasEvent ? 'pointer' : 'default',
                opacity,
                position: 'relative',
              }}
            >
              <div style={{ fontSize: 11, color: isToday ? C.cyan : C.muted, fontWeight: isToday ? 700 : 400 }}>
                {dayNum}
              </div>
              {first && (
                <div
                  style={{
                    fontSize: 9,
                    color: first.color,
                    lineHeight: 1.15,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {first.label}
                </div>
              )}
              <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                {first?.tss != null && first.tss > 0 && (
                  <span style={{ fontSize: 8, color: C.muted }}>{Math.round(first.tss)}</span>
                )}
                {evs.length > 1 && (
                  <span style={{ fontSize: 8, color: C.muted, marginLeft: 'auto' }}>+{evs.length - 1}</span>
                )}
              </div>

              {/* Tooltip / popover */}
              {hovered === dateKey && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    marginBottom: 6,
                    zIndex: 20,
                    background: C.card2,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: '8px 10px',
                    width: 180,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    pointerEvents: 'none',
                  }}
                >
                  {evs.map((e, idx) => (
                    <div key={idx} style={{ marginBottom: idx < evs.length - 1 ? 6 : 0 }}>
                      <div style={{ fontSize: 9, color: e.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {e.kind === 'race' ? 'Wyścig' : (e.activity.type ?? 'Jazda')}
                      </div>
                      <div style={{ fontSize: 12, color: C.text }}>{e.label}</div>
                      <div style={{ fontSize: 10, color: C.muted }}>
                        {e.kind === 'race'
                          ? [e.race.location, e.race.distance_km ? `${e.race.distance_km} km` : null].filter(Boolean).join(' · ')
                          : [e.activity.distance_km ? `${e.activity.distance_km} km` : null, e.tss ? `${Math.round(e.tss)} TSS` : null].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  ))}
                  {evs.some((e) => e.kind === 'activity' && e.clickable) && (
                    <div style={{ fontSize: 9, color: C.cyan, marginTop: 6 }}>Kliknij by zobaczyć analizę</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legenda */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 10, color: C.muted }}>
        <LegendDot color={C.red} label="Wyścig" />
        <LegendDot color={C.yellow} label="Gravel" />
        <LegendDot color={C.cyan} label="Szosa" />
      </div>

      {/* Plan na najbliższe 14 dni */}
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 10, color: C.cyan, textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 600, marginBottom: 10 }}>
          Plan na najbliższe 14 dni
        </div>
        {next14.length === 0 ? (
          <div style={{ fontSize: 12, color: C.muted }}>Brak zaplanowanych wydarzeń w najbliższych 14 dniach.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {next14.map((e, i) => (
              <EventRow
                key={i}
                event={e}
                onClick={() => {
                  if (e.kind === 'activity' && e.clickable) setOpenActivity(e.activity);
                  else if (e.kind === 'race') onRaceClick();
                }}
              />
            ))}
          </div>
        )}
      </div>

      {openActivity && (
        <RideAnalysis
          activity={openActivity}
          activityId={openActivity.strava_activity_id}
          ftp={ftp}
          onClose={() => setOpenActivity(null)}
        />
      )}
    </div>
  );
}

// ── Pomocnicze ────────────────────────────────────────────────────────────────

function navBtn(enabled: boolean): React.CSSProperties {
  return {
    appearance: 'none',
    border: `1px solid ${C.border}`,
    background: C.card,
    color: enabled ? C.text : C.dim,
    borderRadius: 8,
    width: 32,
    height: 32,
    fontSize: 18,
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.4,
  };
}

function eventWord(n: number): string {
  if (n === 1) return 'wydarzenie';
  if (n >= 2 && n <= 4) return 'wydarzenia';
  return 'wydarzeń';
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      {label}
    </span>
  );
}

function EventRow({ event, onClick }: { event: CalEvent; onClick: () => void }) {
  const clickable = event.kind === 'race' || (event.kind === 'activity' && event.clickable);
  const d = new Date(event.date + 'T00:00:00');
  const dateLabel = d.toLocaleDateString('pl-PL', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const meta =
    event.kind === 'race'
      ? [event.race.location, event.race.distance_km ? `${event.race.distance_km} km` : null].filter(Boolean).join(' · ')
      : [event.activity.distance_km ? `${event.activity.distance_km} km` : null, event.tss ? `${Math.round(event.tss)} TSS` : null].filter(Boolean).join(' · ');

  return (
    <div
      onClick={clickable ? onClick : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: '10px 12px',
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: event.color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: C.text, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {event.label}
        </div>
        {meta && <div style={{ fontSize: 11, color: C.muted }}>{meta}</div>}
      </div>
      <div style={{ fontSize: 11, color: C.muted, flexShrink: 0 }}>{dateLabel}</div>
    </div>
  );
}
