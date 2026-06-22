import { C } from '@/lib/theme';
import { sessionStructure } from '@/lib/workout';

// Helpery planu treningowego (ETAP 5.2) — kolory stref/typów, formatowanie, daty.

// Kolory stref Z1–Z5 (1:1 z mockupu: Z1 szary, Z2 zielony, Z3 cyan, Z4 żółty, Z5 czerwony)
export const ZONE_COLORS = ['#3A4A5C', C.green, C.cyan, C.yellow, C.red];

// Kolor wg typu treningu (1:1 z mockupu)
const TYPE_COLORS: Record<string, string> = {
  OFF: C.muted, Z1: C.muted, Z2: C.green, SST: C.yellow,
  THR: C.yellow, OU: '#C68A4E', VO2: C.red, LONG: C.cyan,
};
export function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? C.muted;
}

// Minuty → "1h 30m" / "45min" (1:1 z mockupu fmtDur)
export function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  const mm = min % 60;
  return h > 0 ? `${h}h${mm > 0 ? ` ${mm}m` : ''}` : `${mm}min`;
}

// ── Daty (lokalne, niezależne od dow z bazy) ──────────────────────────────────

// Dzisiejsza data w STREFIE LOKALNEJ jako ISO 'YYYY-MM-DD' (nie UTC — unika
// przesunięcia o dzień blisko północy).
export function localTodayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Poniedziałek tygodnia zawierającego datę ISO (liczone w UTC-noon, bezpiecznie).
export function mondayOfISO(iso: string): string {
  const u = new Date(iso + 'T12:00:00Z');
  const dow = u.getUTCDay(); // 0=Nd..6=So
  const diff = dow === 0 ? -6 : 1 - dow;
  u.setUTCDate(u.getUTCDate() + diff);
  return u.toISOString().slice(0, 10);
}

const PL_DOW = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So']; // index = getUTCDay()

// Skrót dnia tygodnia WYPROWADZONY Z DATY (nie z pola dow) — odporne na błędny dow.
export function dowLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return PL_DOW[d.getUTCDay()];
}

// ISO → "22.06"
export function dateLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}`;
}

// weekStart przesunięty o n tygodni (ISO).
export function addWeeks(weekStart: string, n: number): string {
  const u = new Date(weekStart + 'T12:00:00Z');
  u.setUTCDate(u.getUTCDate() + n * 7);
  return u.toISOString().slice(0, 10);
}

export type WeekKind = 'past' | 'current' | 'future';

// past/current/future z porównania week_start vs bieżący tydzień (ISO porównywalne leksykalnie).
export function weekKind(weekStart: string, currentWeekStart: string): WeekKind {
  if (weekStart < currentWeekStart) return 'past';
  if (weekStart > currentWeekStart) return 'future';
  return 'current';
}

// weekStart ISO → "22–28.06" (lub "29.06–5.07" gdy różne miesiące)
export function weekRangeLabel(weekStart: string): string {
  const start = new Date(weekStart + 'T12:00:00Z');
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const sD = start.getUTCDate();
  const sM = start.getUTCMonth() + 1;
  const eD = end.getUTCDate();
  const eM = end.getUTCMonth() + 1;
  const mm = (m: number) => String(m).padStart(2, '0');
  return sM === eM
    ? `${sD}–${eD}.${mm(eM)}`
    : `${sD}.${mm(sM)}–${eD}.${mm(eM)}`;
}

// ── ETAP 5.6: hierarchiczne skalowanie tygodnia suwakiem godzin ────────────────
// Model: każda sesja = warmup + core(chroniony) + cooldown. core = dur − warmupDef − cooldownDef.
// Skala działa na DELCIE (target − base): warmup/cooldown ruszamy w zakresach, przy dużych
// cięciach usuwamy całe sesje (interwały nietknięte). delta=0 ⇒ plan bez zmian (baseHours).

// Minimalny kształt dnia wymagany przez scaleWeek (strukturalnie zgodny z PlanDayView).
export interface ScalableDay {
  date: string;
  type: string;
  label: string;
  dur_min: number;
  tss: number;
  warmup?: number;
  cooldown?: number;
  removed?: boolean;
}

// Kolejność usuwania zależy od budżetu (LONG nie ma sensu przy bardzo krótkim tygodniu).
const REMOVE_ORDER_LOW = ['LONG', 'Z1', 'Z2', 'SST', 'THR', 'OU', 'VO2'];  // target < 6h: LONG pierwszy
const REMOVE_ORDER_HIGH = ['Z1', 'Z2', 'LONG', 'SST', 'THR', 'OU', 'VO2']; // target >= 6h: LONG wcześnie
const LOW_BUDGET_MIN = 360; // 6h
// Priorytet ocalałego (gdy zostaje 1 sesja): VO2 najcenniejszy, LONG/Z1 najmniej.
const SURVIVOR_PRIORITY = ['VO2', 'OU', 'THR', 'SST', 'Z2', 'LONG', 'Z1'];

export function scaleWeek<T extends ScalableDay>(
  days: T[],
  targetDurMin: number,
  isDone: (date: string) => boolean
): T[] {
  // Stan roboczy per dzień (kopie). Skalowalne = NOT done, NOT OFF.
  type W = { idx: number; type: string; core: number; w: number; c: number; origDur: number; origTss: number; removed: boolean };
  const work: (W | null)[] = days.map((d, idx) => {
    if (d.type === 'OFF' || isDone(d.date)) return null;
    const ss = sessionStructure(d.type);
    const core = Math.max(0, d.dur_min - ss.warmupDefault - ss.cooldownDefault);
    return { idx, type: d.type, core, w: ss.warmupDefault, c: ss.cooldownDefault, origDur: d.dur_min, origTss: d.tss, removed: false };
  });

  const scalable = work.filter((x): x is W => x !== null);
  const baseDur = scalable.reduce((a, x) => a + x.origDur, 0);

  // Neutralna pozycja: suwak na zaokrąglonym baseHours ⇒ plan bez zmian (start = oryginał).
  // baseDur rzadko jest wielokrotnością 60 (np. 585 = 9h45 → 10h), więc bez tego init dawałby drobny scale.
  if (Math.round(targetDurMin / 60) === Math.round(baseDur / 60)) {
    return days.map((d) => ({ ...d }));
  }

  let delta = targetDurMin - baseDur;

  // Dni OFF bieżącego tygodnia (kandydaci na Z1 przy skalowaniu w górę).
  const offIdxs = days.map((d, idx) => ({ d, idx })).filter(({ d }) => d.type === 'OFF' && !isDone(d.date)).map(({ idx }) => idx);
  const converted = new Map<number, { dur: number }>(); // idx OFF → nowy Z1

  if (delta > 0) {
    // UP: schłodzenie→max, potem rozgrzewka→max, potem OFF→Z1.
    for (const x of scalable) {
      if (delta <= 0) break;
      const ss = sessionStructure(x.type);
      const take = Math.min(delta, ss.cooldownMax - x.c);
      x.c += take; delta -= take;
    }
    for (const x of scalable) {
      if (delta <= 0) break;
      const ss = sessionStructure(x.type);
      const take = Math.min(delta, ss.warmupMax - x.w);
      x.w += take; delta -= take;
    }
    for (const idx of offIdxs) {
      if (delta <= 0) break;
      const add = Math.min(delta, 60);
      converted.set(idx, { dur: add }); delta -= add;
    }
  } else if (delta < 0) {
    let need = -delta;
    // DOWN faza 1: schłodzenie→min.
    for (const x of scalable) {
      if (need <= 0) break;
      const ss = sessionStructure(x.type);
      const take = Math.min(need, x.c - ss.cooldownMin);
      x.c -= take; need -= take;
    }
    // faza 2: rozgrzewka→min.
    for (const x of scalable) {
      if (need <= 0) break;
      const ss = sessionStructure(x.type);
      const take = Math.min(need, x.w - ss.warmupMin);
      x.w -= take; need -= take;
    }
    // faza 3: usuń całe sesje (kolejność zależna od budżetu), chroniąc ostatnią wg SURVIVOR_PRIORITY.
    if (need > 0) {
      const active = () => scalable.filter((x) => !x.removed);
      const protectedIdx = (() => {
        const a = active();
        for (const t of SURVIVOR_PRIORITY) {
          const hit = a.find((x) => x.type === t);
          if (hit) return hit.idx;
        }
        return a[0]?.idx;
      })();
      const removeOrder = targetDurMin < LOW_BUDGET_MIN ? REMOVE_ORDER_LOW : REMOVE_ORDER_HIGH;
      for (const t of removeOrder) {
        if (need <= 0) break;
        for (const x of scalable) {
          if (need <= 0) break;
          if (x.removed || x.type !== t || x.idx === protectedIdx) continue;
          if (active().length <= 1) break;
          const cur = x.w + x.core + x.c;
          x.removed = true; need -= cur;
        }
      }
    }

    // faza 4: usunięcie zwykle uwalnia więcej niż trzeba ("dziura") — wypełnij ją rozciągając
    // schłodzenie→max, potem rozgrzewkę→max pozostałych sesji, na końcu OFF→Z1.
    const curTotal = () => scalable.filter((x) => !x.removed).reduce((a, x) => a + x.w + x.core + x.c, 0);
    let fill = targetDurMin - curTotal();
    if (fill > 0) {
      for (const x of scalable) {
        if (fill <= 0) break;
        if (x.removed) continue;
        const ss = sessionStructure(x.type);
        const take = Math.min(fill, ss.cooldownMax - x.c);
        x.c += take; fill -= take;
      }
      for (const x of scalable) {
        if (fill <= 0) break;
        if (x.removed) continue;
        const ss = sessionStructure(x.type);
        const take = Math.min(fill, ss.warmupMax - x.w);
        x.w += take; fill -= take;
      }
      // Limit konwersji OFF→Z1: przy target ≤10h zostaw min. 1 dzień wolny (konwertuj max 1).
      let convCount = 0;
      for (const idx of offIdxs) {
        if (fill <= 0) break;
        if (targetDurMin <= 600 && convCount >= 1) break;
        const add = Math.min(fill, 60);
        converted.set(idx, { dur: add }); fill -= add; convCount++;
      }
    }
  }

  // Złóż wynik.
  return days.map((d, idx) => {
    const x = work[idx];
    if (converted.has(idx)) {
      const add = converted.get(idx)!.dur;
      return { ...d, type: 'Z1', label: 'Regeneracja Z1', dur_min: add, tss: Math.round(add * 0.6), warmup: 0, cooldown: 0, removed: false };
    }
    if (!x) return d; // OFF lub done — bez zmian
    if (x.removed) {
      return { ...d, dur_min: 0, tss: 0, removed: true };
    }
    const newDur = x.w + x.core + x.c;
    const newTss = x.origDur > 0 ? Math.round((x.origTss * newDur) / x.origDur) : 0;
    return { ...d, dur_min: newDur, tss: newTss, warmup: x.w, cooldown: x.c, removed: false };
  });
}
