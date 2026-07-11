'use client';

import { useMemo, useState } from 'react';
import { C } from '@/lib/theme';
import { fmtDur } from '@/lib/plan';
import { countryFlag, cleanLocation } from '@/lib/country-flag';
import { RideAnalysis, type RideActivity } from './RideAnalysis';
import { WorkoutDetail } from './WorkoutDetail';
import { type RaceRow } from './Races';
import { buildCalendarEvents, type CalActivity, type CalPlanDay, type CalEvent } from '@/lib/calendar-events';

// Pełny wiersz jazdy do RideAnalysis — dociągany LAZY po kliknięciu (P1-a dieta: lista niesie
// slim CalActivity bez jsonb). Ten sam zestaw kolumn co LastActivityCard.
type FullActivity = RideActivity & { strava_activity_id: number; details_synced_at: string | null };
const FULL_ACTIVITY_SELECT =
  'name, activity_date, type, distance_km, elevation_m, duration_seconds, tss, avg_watts, avg_hr, best_efforts, laps, details_synced_at, strava_activity_id, avg_cadence, normalized_power, intensity_factor, calories, avg_speed:raw_data->average_speed, max_speed:raw_data->max_speed, kilojoules:raw_data->kilojoules';

// Typy zdarzeń żyją w lib/calendar-events (builder wyodrębniony do testów). Re-eksport, bo
// calendar/page.tsx importuje CalActivity/CalPlanDay z tego komponentu.
export type { CalActivity, CalPlanDay } from '@/lib/calendar-events';

interface CalendarProps {
  activities: CalActivity[];
  races: RaceRow[];
  planDays: CalPlanDay[];
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

function monthIndex(y: number, m: number): number {
  return y * 12 + m;
}

export function Calendar({ activities, races, planDays, ftp, onRaceClick }: CalendarProps) {
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
  const [openActivity, setOpenActivity] = useState<FullActivity | null>(null);
  const [openWorkout, setOpenWorkout] = useState<CalPlanDay | null>(null);
  const [loadingRideId, setLoadingRideId] = useState<number | null>(null);

  // Lazy dociągnięcie pełnego wiersza (laps/best_efforts/metryki) po kliknięciu — lista jest slim.
  // clickable wymaga details_synced_at (jak dotąd), więc szczegóły w bazie już są; to 1 lekki select (~5 KB).
  async function openRide(a: CalActivity) {
    if (loadingRideId != null) return; // ochrona przed podwójnym klikiem
    setLoadingRideId(a.strava_activity_id);
    try {
      // Dynamiczny import: klient supabase-js NIE wchodzi do first-load JS strony (109 kB
      // zostaje) — ładuje się dopiero przy pierwszym kliknięciu w jazdę.
      const { createBrowserSupabaseClient } = await import('@/lib/supabase-browser');
      const supabase = createBrowserSupabaseClient();
      const { data } = await supabase
        .from('strava_activities')
        .select(FULL_ACTIVITY_SELECT)
        .eq('strava_activity_id', a.strava_activity_id)
        .maybeSingle();
      if (data) setOpenActivity(data as unknown as FullActivity);
    } catch (e) {
      console.error('open ride failed', e);
    } finally {
      setLoadingRideId(null);
    }
  }

  // Zdarzenia pogrupowane po dacie — builder wyodrębniony (lib/calendar-events, testowalny bez React).
  // Zawiera dedup dnia wyścigu (FIX #77): dzień z wyścigiem = tylko event race, TSS startu przeniesiony.
  const eventsByDate = useMemo(
    () => buildCalendarEvents(activities, races, planDays, todayStr, ftp),
    [activities, races, planDays, todayStr, ftp]
  );

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
    const clickableWorkout = evs.find((e) => e.kind === 'training' && e.clickable) as
      | Extract<CalEvent, { kind: 'training' }>
      | undefined;
    if (clickableRide) {
      void openRide(clickableRide.activity);
    } else if (clickableWorkout) {
      setOpenWorkout(clickableWorkout.day);
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
          // Zarys (mockup): main = trening z kolejnego tygodnia → dashed + przygaszenie.
          const isOutline = first?.kind === 'training' && first.outline && !hasRace;
          const canClick = evs.some(
            (e) => e.kind === 'race' || ((e.kind === 'activity' || e.kind === 'training') && e.clickable)
          );

          let bg = 'transparent';
          let border = `1px solid transparent`;
          if (hasRace) {
            bg = C.red + '14';
            border = `1px solid ${C.red}44`;
          } else if (isOutline) {
            bg = C.card + '80';
            border = `1px dashed ${C.border}`;
          } else if (hasEvent) {
            bg = C.card;
            border = `1px solid ${C.border}`;
          }
          if (isToday) border = `1.5px solid ${C.cyan}`;

          const opacity = !hasEvent && isPast ? 0.25 : isOutline ? 0.6 : 1;

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
                cursor: canClick ? 'pointer' : 'default',
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
                    fontWeight: first.kind === 'training' ? 600 : 400,
                    color: first.color,
                    lineHeight: 1.15,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {first.kind === 'training'
                    ? (first.day.type === 'OFF' ? 'Odpocz.' : first.day.type)
                    : first.kind === 'race'
                      ? [countryFlag(first.race.location), first.label].filter(Boolean).join(' ')
                      : first.label}
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
                        {e.kind === 'race' ? 'Wyścig' : e.kind === 'training' ? `Plan · ${e.day.type}` : (e.activity.type ?? 'Jazda')}
                      </div>
                      <div style={{ fontSize: 12, color: C.text }}>{e.label}</div>
                      <div style={{ fontSize: 10, color: C.muted }}>
                        {e.kind === 'race'
                          ? [cleanLocation(e.race.location), e.race.distance_km ? `${e.race.distance_km} km` : null].filter(Boolean).join(' · ')
                          : e.kind === 'training'
                            ? (e.day.type === 'OFF' ? 'Pełna regeneracja' : [e.day.dur_min ? fmtDur(e.day.dur_min) : null, e.tss ? `~TSS ${Math.round(e.tss)}` : null, e.outline ? 'zarys' : null].filter(Boolean).join(' · '))
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

      {/* Legenda (1:1 z mockupu) */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 10, color: C.muted }}>
        <LegendDot color={C.red} label="Wyścig" />
        <LegendDot color={C.cyan} label="Plan" />
        <LegendDot color={C.yellow} label="Gravel" />
        <LegendDot color={C.cyan} label="Szosa" />
        <LegendDot color={C.purple} label="Zwift" />
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
            {(() => {
              // 7 dni szczegółu + 7 zarysu; separator przed pierwszym eventem spoza tygodnia.
              const detailEnd = new Date(todayStr + 'T00:00:00');
              detailEnd.setDate(detailEnd.getDate() + 7);
              const detailStr = ymd(detailEnd);
              const rows: React.ReactNode[] = [];
              let outlineStarted = false;
              next14.forEach((e, i) => {
                if (e.date.slice(0, 10) > detailStr && !outlineStarted) {
                  outlineStarted = true;
                  rows.push(
                    <div key="sep" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 2px 2px' }}>
                      <div style={{ flex: 1, height: 1, background: C.border }} />
                      <span style={{ fontSize: 9, color: C.muted, fontWeight: 600, letterSpacing: '0.1em' }}>ZARYS · KOLEJNY TYDZIEŃ</span>
                      <div style={{ flex: 1, height: 1, background: C.border }} />
                    </div>
                  );
                }
                rows.push(
                  <EventRow
                    key={i}
                    event={e}
                    todayStr={todayStr}
                    onClick={() => {
                      if (e.kind === 'activity' && e.clickable) void openRide(e.activity);
                      else if (e.kind === 'training' && e.clickable) setOpenWorkout(e.day);
                      else if (e.kind === 'race') onRaceClick();
                    }}
                  />
                );
              });
              return rows;
            })()}
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

      {openWorkout && ftp != null && (
        <WorkoutDetail day={openWorkout} ftp={ftp} onClose={() => setOpenWorkout(null)} />
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

const MONTH_ABBR = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

// Wiersz listy 14 dni — 1:1 z mockupu (EventRow): data | tag + nazwa + meta | odliczanie dni.
// Zarys: lewy border 3px dashed + opacity 0.7; szczegół/jazda/wyścig: 3px solid.
function EventRow({ event, todayStr, onClick }: { event: CalEvent; todayStr: string; onClick: () => void }) {
  const clickable =
    event.kind === 'race' || ((event.kind === 'activity' || event.kind === 'training') && event.clickable);
  const isOutline = event.kind === 'training' && event.outline;
  const d = new Date(event.date.slice(0, 10) + 'T00:00:00');
  const days = Math.round((d.getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 86_400_000);
  const c = event.color;

  const tag =
    event.kind === 'race'
      ? (event.date.slice(0, 10) < todayStr ? 'WYŚCIG ✓' : 'WYŚCIG')
      : event.kind === 'training'
        ? `PLAN · ${event.day.type}`
        : event.activity.sport_type === 'GravelRide'
          ? 'GRAVEL'
          : event.activity.sport_type === 'VirtualRide'
            ? 'ZWIFT'
            : event.activity.sport_type === 'Ride'
              ? 'SZOSA'
              : 'JAZDA';

  const label =
    event.kind === 'race'
      ? [countryFlag(event.race.location), event.label].filter(Boolean).join(' ')
      : event.label;

  const meta =
    event.kind === 'race'
      ? [cleanLocation(event.race.location), event.race.series, event.race.distance_km ? `${event.race.distance_km} km` : null]
          .filter(Boolean)
          .join(' · ')
      : event.kind === 'training'
        ? (event.day.type === 'OFF'
            ? 'Pełna regeneracja'
            : [event.day.dur_min ? fmtDur(event.day.dur_min) : null, event.tss ? `~TSS ${Math.round(event.tss)}` : null, isOutline ? 'zarys' : null]
                .filter(Boolean)
                .join(' · '))
        : [event.activity.distance_km ? `${event.activity.distance_km} km` : null, event.tss ? `${Math.round(event.tss)} TSS` : null]
            .filter(Boolean)
            .join(' · ');

  return (
    <div
      onClick={clickable ? onClick : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: C.card,
        border: `1px solid ${C.border}`,
        borderLeft: isOutline ? `3px dashed ${c}` : `3px solid ${c}`,
        borderRadius: '0 8px 8px 0',
        padding: '10px 12px',
        cursor: clickable ? 'pointer' : 'default',
        opacity: isOutline ? 0.7 : 1,
      }}
    >
      <div style={{ width: 42, textAlign: 'center', flexShrink: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: c, lineHeight: 1 }}>{d.getDate()}</div>
        <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase' }}>{MONTH_ABBR[d.getMonth()]}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.08em', color: c, background: c + '18', border: `1px solid ${c}44`, borderRadius: 4, padding: '1px 6px', flexShrink: 0 }}>
            {tag}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {label}
          </span>
        </div>
        {meta && <div style={{ fontSize: 10, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta}</div>}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: days === 0 ? C.cyan : c }}>
            {days === 0 ? 'dziś' : days > 0 ? `+${days}` : days}
          </div>
          {days !== 0 && <div style={{ fontSize: 9, color: C.muted }}>dni</div>}
        </div>
        {clickable && <span style={{ fontSize: 14, color: c }}>›</span>}
      </div>
    </div>
  );
}
