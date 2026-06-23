'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { C } from '@/lib/theme';
import { ZoneBar } from './ZoneBar';
import { WorkoutDetail } from './WorkoutDetail';
import { RideAnalysis, type RideActivity } from './RideAnalysis';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { typeColor, fmtDur, dowLabel, dateLabel, weekRangeLabel, scaleWeek, type WeekKind } from '@/lib/plan';

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
  warmup?: number;    // 5.6: rozgrzewka/schłodzenie po skalowaniu suwakiem (→ buildWorkout)
  cooldown?: number;
  removed?: boolean;  // 5.6: sesja usunięta przez skalowanie w dół (pokazana jako OFF)
  locked?: boolean;   // ręczna blokada usera — odblokowanie tylko przez czat
}

// Wykonana jazda dla dnia planu — kształt wymagany przez RideAnalysis + sync-details.
export interface PlanActivityRow extends RideActivity {
  strava_activity_id: number;
  details_synced_at: string | null;
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
  ftp: number;
  ctl: number;
  // Wszystkie jazdy danego dnia (data lokalna), posortowane malejąco po TSS.
  activitiesByDate: Record<string, PlanActivityRow[]>;
}

// Czy dzień ma wykonaną jazdę (≥1 aktywność).
function isDoneDate(acts: Record<string, PlanActivityRow[]>, date: string): boolean {
  return (acts[date]?.length ?? 0) > 0;
}

// ISO data przesunięta o n dni (UTC-safe).
function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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

function DayCard({ d, isToday, done, loading, onClick }: { d: PlanDayView; isToday: boolean; done: boolean; loading: boolean; onClick?: () => void }) {
  const isRemoved = !!d.removed;
  const isOff = d.type === 'OFF';
  const offLike = isOff || isRemoved; // usunięta sesja renderuje się jak OFF (szara)
  const tc = isRemoved ? C.muted : typeColor(d.type);
  const isOutline = !!d.outline;
  const clickable = !!onClick;
  const [hover, setHover] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={clickable ? () => setHover(true) : undefined}
      onMouseLeave={clickable ? () => setHover(false) : undefined}
      style={{
        ...card, padding: '12px 14px', position: 'relative',
        border: `1px solid ${isToday ? C.cyan : hover ? tc + '88' : C.border}`,
        opacity: isRemoved ? 0.5 : isOutline ? 0.6 : (done && !isToday ? 0.55 : 1),
        cursor: clickable ? 'pointer' : 'default',
        transition: 'border-color 0.15s',
      }}
    >
      {isToday && (
        <div style={{ position: 'absolute', top: -8, left: 14, background: C.cyan, color: C.bg, fontSize: 8, fontWeight: 600, padding: '2px 8px', borderRadius: 4, letterSpacing: '0.1em' }}>
          {done ? 'DZIŚ · ZROBIONE ✓' : 'DZIŚ'}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 42, textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{dowLabel(d.date)}</div>
          <div style={{ fontSize: 9, color: C.muted }}>{dateLabel(d.date)}</div>
        </div>
        <div style={{ width: 50, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ background: tc + '22', color: tc, border: `1px solid ${tc}55`, borderRadius: 4, padding: '2px 7px', fontSize: 9, fontWeight: 600 }}>
            {isRemoved ? 'OFF' : d.type}
          </span>
          {d.locked && (
            <span title="Zablokowane ręcznie — zmień przez czat" style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>🔒</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: C.text }}>
            {isRemoved ? 'Dzień wolny' : d.label}
          </div>
          {!offLike && <ZoneBar zones={d.zones} />}
        </div>
        {isRemoved ? (
          <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic' }}>Dzień wolny — obciążenie zredukowane</div>
        ) : isOff ? (
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
      {clickable && (
        <div style={{ fontSize: 9, color: tc, fontWeight: 600, marginTop: 8, opacity: 0.8 }}>
          {loading ? 'Pobieram szczegóły…' : done ? 'Analiza wykonania →' : 'Pełna rozpiska treningu →'}
        </div>
      )}
    </div>
  );
}

// Jazda POZA PLANEM — aktywność Stravy bez dopasowania do zaplanowanego treningu.
// Wizualnie odróżniona: szary akcent + badge "POZA PLANEM". Klik → RideAnalysis.
function UnplannedCard({ activity, loading, onClick }: { activity: PlanActivityRow; loading: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...card, padding: '10px 14px', position: 'relative',
        border: `1px dashed ${hover ? C.muted : C.border}`,
        background: C.bg,
        cursor: 'pointer', transition: 'border-color 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 42, textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>{dowLabel(activity.activity_date)}</div>
          <div style={{ fontSize: 9, color: C.muted }}>{dateLabel(activity.activity_date)}</div>
        </div>
        <div style={{ width: 50 }}>
          <span style={{ background: C.muted + '22', color: C.muted, border: `1px solid ${C.muted}55`, borderRadius: 4, padding: '2px 6px', fontSize: 8, fontWeight: 600, letterSpacing: '0.04em' }}>
            POZA PLANEM
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {activity.name ?? activity.type ?? 'Jazda'}
          </div>
          <div style={{ fontSize: 10, color: C.muted, fontStyle: 'italic' }}>nieplanowana jazda</div>
        </div>
        <div style={{ display: 'flex', gap: 14, textAlign: 'right', alignItems: 'center' }}>
          {activity.distance_km != null && <Cell label="DYST" value={`${Math.round(activity.distance_km)} km`} color={C.muted} />}
          {activity.tss != null && <Cell label="TSS" value={`${Math.round(activity.tss)}`} color={C.yellow} />}
        </div>
      </div>
      <div style={{ fontSize: 9, color: C.muted, fontWeight: 600, marginTop: 6, opacity: 0.8 }}>
        {loading ? 'Pobieram szczegóły…' : 'Analiza wykonania →'}
      </div>
    </div>
  );
}

// ── Plan ──────────────────────────────────────────────────────────────────────

// Kolumny do odczytu świeżego wiersza po sync-details (jak w LastActivityCard).
const ACTIVITY_SELECT =
  'name, activity_date, type, distance_km, elevation_m, duration_seconds, tss, avg_watts, avg_hr, best_efforts, laps, details_synced_at, strava_activity_id';

// baseHours = Σ dur_min dni NOT done i NOT OFF / 60 (zaokrąglone). done = istnienie jazdy.
function computeBaseHours(days: PlanDayView[] | null, acts: Record<string, PlanActivityRow[]>): number {
  if (!days) return 1;
  const min = days
    .filter((d) => d.type !== 'OFF' && !isDoneDate(acts, d.date))
    .reduce((a, d) => a + d.dur_min, 0);
  return Math.round(min / 60) || 1;
}

export function Plan({ weeks, currentIdx, todayISO, ftp, ctl, activitiesByDate }: PlanProps) {
  const [idx, setIdx] = useState(currentIdx);
  const [openWorkout, setOpenWorkout] = useState<PlanDayView | null>(null);
  const [openRide, setOpenRide] = useState<PlanActivityRow | null>(null);
  const [loadingDate, setLoadingDate] = useState<string | null>(null);
  // hours init = baseHours bieżącego tygodnia (nie rekomendacji — user sam decyduje).
  const [hours, setHours] = useState(() =>
    computeBaseHours(weeks[currentIdx]?.days ?? null, activitiesByDate)
  );

  // 5.7: lokalny override planu per tydzień (po modyfikacji czatem) + stan czatu.
  const [override, setOverride] = useState<Record<string, PlanDayView[]>>({});
  const [overrideInsight, setOverrideInsight] = useState<Record<string, string>>({});
  type ChatMsg = { role: 'user' | 'ai'; text: string };
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [genLoading, setGenLoading] = useState(false);

  // 5.7: wygeneruj plan dla pustego slotu (anchor week_start) → odśwież dane z bazy.
  async function generatePlan(weekStart: string) {
    if (genLoading) return;
    setGenLoading(true);
    try {
      const res = await fetch('/api/plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week_start: weekStart }),
      });
      if (!res.ok) throw new Error('generate failed');
      router.refresh();
    } catch (e) {
      console.error('generate failed', e);
    } finally {
      setGenLoading(false);
    }
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat, chatLoading]);

  const QUICK_MODS = ['Piątek potrzebuję wolny', 'Jestem świeży — mocniejsza końcówka', 'Skróć weekend, mam wyjazd'];

  // Klik w wykonany dzień → dociągnij szczegóły (jeśli brak) i otwórz RideAnalysis.
  // Wzorzec 1:1 z LastActivityCard: loading podczas syncu, dopiero potem modal.
  async function handleOpenRide(row: PlanActivityRow) {
    if (loadingDate) return;
    let data = row;
    if (!data.details_synced_at) {
      setLoadingDate(row.activity_date);
      try {
        const res = await fetch(`/api/activities/${row.strava_activity_id}/sync-details`, { method: 'POST' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `sync failed (${res.status})`);
        }
        const supabase = createBrowserSupabaseClient();
        const { data: fresh } = await supabase
          .from('strava_activities')
          .select(ACTIVITY_SELECT)
          .eq('strava_activity_id', row.strava_activity_id)
          .maybeSingle();
        if (fresh) data = fresh as unknown as PlanActivityRow;
      } catch (e) {
        console.error('sync-details failed', e);
        // mimo błędu otwieramy modal — pokaże fallbacki "brak danych"
      } finally {
        setLoadingDate(null);
      }
    }
    setOpenRide(data);
  }

  const week = weeks[idx];
  const isCurrent = week.kind === 'current';
  const isPast = week.kind === 'past';
  const isFuture = week.kind === 'future';

  // 5.7: czat modyfikacji planu — aktualizuje override (UI od razu) + zapisuje w bazie.
  async function sendMod(text?: string) {
    const q = (text ?? input).trim();
    if (!q || chatLoading) return;
    const weekStart = week.weekStart;
    setChat((c) => [...c, { role: 'user', text: q }]);
    setInput('');
    setChatLoading(true);
    try {
      const res = await fetch('/api/plan/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q, weekStart }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error ?? 'modify failed');
      setOverride((o) => ({ ...o, [weekStart]: d.days as PlanDayView[] }));
      if (d.insight) setOverrideInsight((o) => ({ ...o, [weekStart]: d.insight as string }));
      setChat((c) => [...c, { role: 'ai', text: (d.insight as string) ?? 'Plan zaktualizowany.' }]);
    } catch {
      setChat((c) => [...c, { role: 'ai', text: 'Nie mogę teraz zmodyfikować planu. Spróbuj jeszcze raz.' }]);
    } finally {
      setChatLoading(false);
    }
  }

  // Plan dnia: override po modyfikacji czatem albo wersja z bazy (props).
  const days = override[week.weekStart] ?? week.days;

  // Suwak działa TYLKO na bieżącym tygodniu. Hierarchiczne skalowanie (scaleWeek):
  // ruszamy warmup/cooldown w zakresach, przy dużych cięciach usuwamy całe sesje.
  const baseHours = computeBaseHours(days, activitiesByDate);
  const scaledDays: PlanDayView[] | null = days
    ? isCurrent
      ? scaleWeek(days, hours * 60, (date) => isDoneDate(activitiesByDate, date))
      : days
    : null;

  // ── HYBRYDA (b): WYKONANE (Strava, cały tydzień, łącznie z poza planem) + POZOSTAŁO (plan) ──
  // Daty tygodnia (pn–nd) od weekStart.
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysISO(week.weekStart, i));
  const weekActs = weekDates.flatMap((d) => activitiesByDate[d] ?? []);
  // WYKONANE — z rzeczywistych jazd Stravy (czas z duration_seconds).
  const doneSessions = weekActs.length;
  const doneDurMin = Math.round(weekActs.reduce((a, x) => a + (x.duration_seconds ?? 0), 0) / 60);
  const doneTss = Math.round(weekActs.reduce((a, x) => a + (x.tss ?? 0), 0));
  // POZOSTAŁO — dni planu NIE wykonane (brak jazdy tego dnia), nie OFF, nie usunięte przez suwak.
  // Wykluczenie isDoneDate gwarantuje, że zaplanowany trening, który już zrobiłem, NIE liczy się
  // podwójnie (jest w "wykonane" jako jazda Stravy, a nie w "pozostało").
  const remDays = scaledDays
    ? scaledDays.filter((d) => d.type !== 'OFF' && !d.removed && !isDoneDate(activitiesByDate, d.date))
    : [];
  const remSessions = remDays.length;
  const remDurMin = remDays.reduce((a, d) => a + d.dur_min, 0);
  const remTss = remDays.reduce((a, d) => a + d.tss, 0);
  // CZAS „pozostało" rzadko trafia dokładnie w hours×60 (interwały chronione) — ~ gdy różnica >10.
  const durApprox = isCurrent && Math.abs(remDurMin - hours * 60) > 10;

  // Rekomendacja AI godzin: ile jeszcze do celu, licząc od FAKTYCZNIE wykonanego TSS.
  const futureBaseTSS = remDays.reduce((a, d) => a + d.tss, 0);
  const futureBaseDur = remDays.reduce((a, d) => a + d.dur_min, 0);
  const tssPerH = futureBaseDur > 0 ? futureBaseTSS / (futureBaseDur / 60) : 42;
  const targetWeeklyTSS = ctl * 7 * 1.15;
  // Fallback: brak CTL (pusta baza fitness_metrics) → rekomendacja = baseHours (marker pokrywa suwak).
  const recHours =
    ctl > 0
      ? Math.max(2, Math.min(16, Math.round((targetWeeklyTSS - doneTss) / tssPerH)))
      : Math.max(2, Math.min(16, baseHours));
  const atRec = hours === recHours;

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

      {/* SUWAK GODZIN — tylko bieżący tydzień */}
      {isCurrent && days && (
        <div style={{ ...card }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Pozostały czas w tygodniu</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
              <span style={{ fontSize: 24, fontWeight: 600, color: C.cyan }}>{hours}</span>
              <span style={{ fontSize: 13, color: C.muted }}>h</span>
            </div>
          </div>

          {/* track z markerem rekomendacji AI */}
          <div style={{ position: 'relative' }}>
            <input
              type="range" min={2} max={16} step={1} value={hours}
              onChange={(e) => setHours(+e.target.value)}
              style={{ width: '100%', accentColor: C.cyan, cursor: 'pointer', display: 'block' }}
            />
            <div style={{ position: 'absolute', top: -3, left: `${((recHours - 2) / (16 - 2)) * 100}%`, transform: 'translateX(-50%)', pointerEvents: 'none' }}>
              <div style={{ width: 2, height: 22, background: C.green, borderRadius: 1, margin: '0 auto' }} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: C.muted, marginTop: 4 }}>
            <span>2h</span><span>8h</span><span>16h</span>
          </div>

          {/* Rekomendacja AI */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, padding: '10px 12px', background: C.green + '0E', border: `1px solid ${C.green}30`, borderRadius: 10 }}>
            <div style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 8, background: C.green + '1E', border: `1px solid ${C.green}44`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill={C.green}><path d="M12 2l2.4 6.5L21 9l-5 4.5L17.5 21 12 17l-5.5 4L8 13.5 3 9l6.6-.5z" /></svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, color: C.green, letterSpacing: '0.1em', fontWeight: 600, marginBottom: 2 }}>REKOMENDACJA AI · {recHours}h</div>
              <div style={{ fontSize: 11, color: C.text, lineHeight: 1.4 }}>
                {atRec
                  ? 'Optymalny punkt dla Twojej formy — najlepszy postęp przy zdrowej regeneracji.'
                  : hours > recHours
                  ? 'Powyżej rekomendacji — większy bodziec, ale i większe obciążenie. Świadomy wybór, jeśli czujesz się dobrze.'
                  : 'Poniżej rekomendacji — bezpieczniej, wolniejszy przyrost formy. Dołóż, jeśli chcesz szybciej budować.'}
              </div>
            </div>
            {!atRec && (
              <button onClick={() => setHours(recHours)} style={{ flexShrink: 0, background: C.green + '1E', color: C.green, border: `1px solid ${C.green}55`, borderRadius: 7, padding: '7px 11px', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                Użyj {recHours}h
              </button>
            )}
          </div>

          <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
            Skaluje tylko <b style={{ color: C.text }}>nadchodzące</b> sesje — wykonane treningi i dzisiejsza jazda zostają bez zmian.
          </div>
        </div>
      )}

      {days ? (
        <>
          {/* AI INSIGHT (override po modyfikacji czatem, inaczej z bazy) */}
          {(overrideInsight[week.weekStart] ?? week.insight) && (
            <div style={{ ...card, borderLeft: `3px solid ${C.cyan}`, borderRadius: '0 12px 12px 0', paddingLeft: 14 }}>
              <div style={{ fontSize: 9, color: C.cyan, letterSpacing: '0.12em', fontWeight: 600, marginBottom: 7 }}>
                AI INSIGHT — {isPast ? 'PODSUMOWANIE TYGODNIA' : isFuture ? 'ZARYS TYGODNIA' : 'PLAN TYGODNIA'}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: C.text }}>{overrideInsight[week.weekStart] ?? week.insight}</div>
            </div>
          )}

          {/* STATS — hybryda: WYKONANE (Strava) + POZOSTAŁO (plan). Dwa segmenty, nie zlane. */}
          {isCurrent && (
            <div style={{ display: 'flex', gap: 12, fontSize: 9, color: C.muted, paddingLeft: 2 }}>
              <span><span style={{ color: C.green }}>●</span> wykonane</span>
              <span><span style={{ color: C.cyan }}>●</span> pozostało (plan)</span>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {([
              ['SESJE', String(doneSessions), String(remSessions), `~${remSessions}`],
              ['CZAS', fmtDur(doneDurMin), `${durApprox ? '~' : ''}${fmtDur(remDurMin)}`, `~${fmtDur(remDurMin)}`],
              ['LOAD', String(doneTss), `${remTss}`, `~${remTss}`],
            ] as const).map(([l, doneStr, remStr, plannedStr]) => (
              <div key={l} style={{ ...card, textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.12em', fontWeight: 600, marginBottom: 4 }}>{l}</div>
                {isCurrent ? (
                  <>
                    <div style={{ fontSize: 22, fontWeight: 600, color: C.green, lineHeight: 1.1 }}>{doneStr}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.cyan }}>+ {remStr}</div>
                  </>
                ) : isPast ? (
                  <div style={{ fontSize: 24, fontWeight: 600, color: C.green }}>{doneStr}</div>
                ) : (
                  // future/outline — nic nie wykonane, pokaż plan jako orientacyjny (~)
                  <div style={{ fontSize: 24, fontWeight: 600, color: C.cyan }}>{plannedStr}</div>
                )}
              </div>
            ))}
          </div>

          {/* KARTY DNI — zaplanowany trening + (osobno) jazdy POZA PLANEM tego dnia */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(scaledDays ?? []).map((d, i) => {
              const list = activitiesByDate[d.date] ?? [];
              const isTraining = d.type !== 'OFF' && !d.removed;
              // Trening planu "konsumuje" 1 jazdę (max TSS = lista[0]); reszta = poza planem.
              // Dzień OFF/usunięty z jazdą → cała jazda poza planem.
              const matched = isTraining ? list[0] : undefined;
              const unplanned = isTraining ? list.slice(1) : list;
              const done = !!matched;
              const clickable = d.type !== 'OFF' && !d.removed && (done || !d.outline);
              const onClick = !clickable
                ? undefined
                : done
                ? () => handleOpenRide(matched!)
                : () => setOpenWorkout(d);
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <DayCard
                    d={d}
                    isToday={isCurrent && d.date === todayISO}
                    done={done}
                    loading={loadingDate === d.date}
                    onClick={onClick}
                  />
                  {unplanned.map((a) => (
                    <UnplannedCard
                      key={a.strava_activity_id}
                      activity={a}
                      loading={loadingDate === a.activity_date}
                      onClick={() => handleOpenRide(a)}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          {/* 5.7: CZAT MODYFIKACJI PLANU — tylko bieżący tydzień */}
          {isCurrent && (
            <div style={{ ...card }}>
              <div style={{ fontSize: 9, color: C.green, letterSpacing: '0.12em', fontWeight: 600, marginBottom: 10 }}>
                ZMIEŃ PLAN — napisz, czego potrzebujesz
              </div>

              {chat.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, maxHeight: 240, overflowY: 'auto' }}>
                  {chat.map((m, i) => (
                    <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                      <div style={{
                        background: m.role === 'user' ? C.cyan : C.bg,
                        color: m.role === 'user' ? '#000' : C.text,
                        border: m.role === 'user' ? 'none' : `1px solid ${C.border}`,
                        borderRadius: 12, padding: '9px 13px', fontSize: 12.5, lineHeight: 1.55,
                      }}>
                        {m.text}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div style={{ alignSelf: 'flex-start', color: C.muted, fontSize: 12, fontStyle: 'italic' }}>Trener pisze…</div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}

              {chat.length === 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {QUICK_MODS.map((s) => (
                    <button key={s} onClick={() => sendMod(s)} disabled={chatLoading}
                      style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.green, borderRadius: 14, padding: '6px 12px', fontSize: 11, cursor: 'pointer' }}>
                      {s}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMod()}
                  placeholder="np. piątek potrzebuję wolny, weekend mocniej…"
                  disabled={chatLoading}
                  style={{ flex: 1, background: C.bg, border: `1px solid ${C.green}55`, borderRadius: 10, padding: '11px 14px', color: C.text, fontSize: 13, outline: 'none' }}
                />
                <button onClick={() => sendMod()} disabled={chatLoading}
                  style={{ background: C.green, border: 'none', borderRadius: 10, padding: '0 18px', color: C.bg, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  ↑
                </button>
              </div>
            </div>
          )}
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
          <button
            onClick={() => generatePlan(week.weekStart)}
            disabled={genLoading}
            style={{ marginTop: 4, background: C.cyan, border: 'none', borderRadius: 10, padding: '10px 18px', color: C.bg, fontWeight: 600, fontSize: 13, cursor: genLoading ? 'default' : 'pointer', opacity: genLoading ? 0.6 : 1 }}
          >
            {genLoading ? 'Generuję…' : '⚡ Wygeneruj plan'}
          </button>
        </div>
      )}

      {openWorkout && (
        <WorkoutDetail day={openWorkout} ftp={ftp} onClose={() => setOpenWorkout(null)} />
      )}

      {openRide && (
        <RideAnalysis
          activity={openRide}
          activityId={openRide.strava_activity_id}
          ftp={ftp}
          onClose={() => setOpenRide(null)}
        />
      )}
    </div>
  );
}
