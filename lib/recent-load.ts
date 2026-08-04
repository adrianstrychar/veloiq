// Kontekst OBCIĄŻENIA Z PRZESZŁOŚCI dla generatora planu — czysty, bez I/O.
//
// PO CO TO ISTNIEJE: generator planu (app/api/plan/generate) czytał wyłącznie NAJŚWIEŻSZY wiersz
// fitness_metrics i PRZYSZŁE wyścigi. Fakt, że dwa dni temu odbył się 5-godzinny start, docierał do
// modelu wyłącznie jako dwie liczby (ATL/TSB) bez instrukcji co z nimi zrobić — więc poniedziałek po
// wyścigu potrafił dostać Threshold 3×12. Dodatkowo jedyna reguła post-race w repo
// (nextWeeklyTssTarget = baseTarget * 0.7) trafiała WYŁĄCZNIE do zarysu następnego tygodnia i ginęła
// przy jego promocji na tydzień bieżący — generator startował od nowa i nie widział już startu.
//
// Ten moduł domyka lukę deterministycznie: z surowych aktywności i minionych startów liczy, ILE dni
// regeneracji zawodnik jeszcze POTRZEBUJE i ile już REALNIE odebrał. Wynik jest podwójnie użyty —
// jako tekst dla modelu (guidance) ORAZ jako twarda reguła walidowana server-side
// (recoveryViolation), tak samo jak ochrona ostatnich 48 h przed startem: nie ufamy, że model
// posłucha promptu.

import type { RacePriority } from '@/lib/race-taper';

// ── KONFIGURACJA (jedyne miejsce do strojenia) ───────────────────────────────
export const RECOVERY_CONFIG = {
  // Ile dni z prezentowanej historii trafia do promptu (lista dzień po dniu).
  windowDays: 14,
  // Dni regeneracji NALEŻNE po starcie wg rangi. Kalibracja: start A (5 h, pełne opróżnienie)
  // realnie potrzebuje 3–4 dni zanim wróci sens sesji progowej; B to mocny trening ze sprawdzianem.
  recoveryDaysByPriority: { A: 4, B: 3, C: 2 } as Record<RacePriority, number>,
  // Dzień treningowy BEZ wpisu w kalendarzu startów też potrafi wyniszczyć (długi maraton,
  // nieoznaczony start). Progi na sumie TSS dnia — dwa poziomy głębokości.
  hardTssThreshold: 250,
  hardTssRecoveryDays: 2,
  veryHardTssThreshold: 350,
  veryHardTssRecoveryDays: 3,
  // Dzień liczy się jako ODEBRANA regeneracja, gdy suma TSS <= tej wartości. 70 przepuszcza dzień
  // wolny, Z1 i spokojne Z2 do ~2 h (realna "luźna jazda regeneracyjna"), odcina LONG i jakość.
  recoveryDayTssMax: 70,
  // Bezpiecznik: regeneracja nie zjada więcej niż tyle dni planowanego tygodnia (inaczej przy
  // ekstremalnym starcie zostałby tydzień bez treningu, a to już decyzja zawodnika, nie generatora).
  maxRecoveryDowsInWeek: 3,
  // Obniżenie celu TSS tygodnia za każdy wymuszony dzień regeneracji + podłoga.
  tssFactorPerDay: 0.12,
  tssFactorFloor: 0.65,
} as const;

// Typy dozwolone w dniu regeneracyjnym. LONG świadomie POZA listą — "spokojnie, ale 4 h" to nie
// regeneracja po pięciogodzinnym starcie.
export const RECOVERY_ALLOWED_TYPES = ['OFF', 'Z1', 'Z2'] as const;

// ── Wejścia ──────────────────────────────────────────────────────────────────

export interface RecentActivity {
  date: string;                    // 'YYYY-MM-DD' (activity_date = start_date_local)
  name: string | null;
  type: string | null;
  tss: number;
  durationSeconds: number | null;
}

export interface PastRace {
  name: string;
  date: string;                    // 'YYYY-MM-DD'
  priority: RacePriority;
}

// ── Wyjścia ──────────────────────────────────────────────────────────────────

export interface HardEffort {
  date: string;
  name: string;
  kind: 'race' | 'training';
  priority: RacePriority | null;
  tss: number;
  durationMin: number | null;
  recoveryDaysNeeded: number;      // ile dni należnych wg konfiguracji
  recoveryDaysConsumed: number;    // ile już REALNIE odebrano (lekkie dni po wysiłku)
  daysBeforePlanStart: number;     // odległość od pierwszego planowanego dnia
}

export interface RecentLoadContext {
  days: Array<{ date: string; dowShort: string; tss: number; label: string | null }>;
  last7Tss: number;
  prev7Tss: number;
  hardEffort: HardEffort | null;
  recoveryDows: number[];          // dow (1..7) planowanego tygodnia wymagające OFF/Z1/Z2
  tssFactor: number;               // mnożnik celu tygodniowego (1 = bez korekty)
  guidance: string | null;         // gotowy blok do promptu (null = nie ma o czym mówić)
}

// ── Daty (czysty UTC, spójnie z lib/ai/plan-generate) ────────────────────────

const MS_PER_DAY = 86_400_000;
const DOW_SHORT = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * MS_PER_DAY).toISOString().slice(0, 10);
}

function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / MS_PER_DAY);
}

// dow 1..7 (Pn..Nd) dla daty ISO.
export function isoDow(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0=Nd
  return d === 0 ? 7 : d;
}

// ── Rdzeń ────────────────────────────────────────────────────────────────────

// Ile dni regeneracji należy się po dniu o danym profilu. null = dzień nie kwalifikuje się
// jako wysiłek wymagający osobnej ochrony.
function recoveryDaysFor(dayTss: number, priority: RacePriority | null): number | null {
  if (priority) return RECOVERY_CONFIG.recoveryDaysByPriority[priority];
  if (dayTss >= RECOVERY_CONFIG.veryHardTssThreshold) return RECOVERY_CONFIG.veryHardTssRecoveryDays;
  if (dayTss >= RECOVERY_CONFIG.hardTssThreshold) return RECOVERY_CONFIG.hardTssRecoveryDays;
  return null;
}

/**
 * Buduje kontekst obciążenia z przeszłości dla tygodnia zaczynającego się `weekStart`.
 *
 * `planFrom` (pierwszy dzień, który generator realnie planuje) = max(weekStart, today): tydzień
 * przyszły planujemy od poniedziałku, bieżący od DZISIAJ — dni już minione mają realne dane
 * w Stravie i to one, a nie plan, decydują ile regeneracji zostało odebrane. Dzięki temu mechanizm
 * sam się koryguje: jeśli zawodnik pojechał w poniedziałek ciężko mimo zalecenia, wtorek nadal
 * będzie chroniony.
 */
export function buildRecentLoad(args: {
  weekStart: string;
  today: string;
  activities: RecentActivity[];
  pastRaces: PastRace[];
  raceDowCurrent: number | null;   // dow startu w planowanym tygodniu — wykluczony z regeneracji
}): RecentLoadContext {
  const { weekStart, today, activities, pastRaces, raceDowCurrent } = args;

  const planFrom = today > weekStart ? today : weekStart;
  const windowEnd = addDays(planFrom, -1);
  const windowStart = addDays(windowEnd, -(RECOVERY_CONFIG.windowDays - 1));

  // Suma TSS per dzień + etykieta dnia (nazwa najcięższej jazdy tego dnia).
  const tssByDate = new Map<string, number>();
  const labelByDate = new Map<string, { name: string; tss: number }>();
  const durByDate = new Map<string, number>();
  for (const a of activities) {
    const tss = Number.isFinite(a.tss) ? Math.max(0, a.tss) : 0;
    tssByDate.set(a.date, (tssByDate.get(a.date) ?? 0) + tss);
    durByDate.set(a.date, (durByDate.get(a.date) ?? 0) + (a.durationSeconds ?? 0));
    const prev = labelByDate.get(a.date);
    if (a.name && (!prev || tss > prev.tss)) labelByDate.set(a.date, { name: a.name, tss });
  }

  const raceByDate = new Map<string, PastRace>();
  for (const r of pastRaces) if (!raceByDate.has(r.date)) raceByDate.set(r.date, r);

  // Lista dzień po dniu (od najstarszego) — materiał dla promptu.
  const days: RecentLoadContext['days'] = [];
  for (let d = windowStart; d <= windowEnd; d = addDays(d, 1)) {
    days.push({
      date: d,
      dowShort: DOW_SHORT[isoDow(d) - 1],
      tss: Math.round(tssByDate.get(d) ?? 0),
      label: raceByDate.get(d)?.name ?? labelByDate.get(d)?.name ?? null,
    });
  }

  const sumRange = (from: string, to: string) => {
    let s = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) s += tssByDate.get(d) ?? 0;
    return Math.round(s);
  };
  const last7Tss = sumRange(addDays(windowEnd, -6), windowEnd);
  const prev7Tss = sumRange(addDays(windowEnd, -13), addDays(windowEnd, -7));

  // ── Wybór wysiłku decydującego ──
  // Kandydatem jest każdy dzień okna kwalifikujący się jako start albo dzień ekstremalny.
  // Wygrywa ten z największą POZOSTAŁĄ regeneracją (należne − odebrane), nie po prostu najnowszy:
  // ciężki start sprzed 3 dni bije lekki „ekstremalny” dzień sprzed 1 dnia, a jeśli po starcie
  // doszedł kolejny mocny dzień, to on wygra sam z siebie. Remis → dzień późniejszy.
  let best: HardEffort | null = null;
  for (const day of days) {
    const race = raceByDate.get(day.date) ?? null;
    const needed = recoveryDaysFor(day.tss, race?.priority ?? null);
    if (needed == null) continue;

    // Odebrana regeneracja = dni PO wysiłku, a PRZED pierwszym planowanym dniem, których suma TSS
    // nie przekroczyła progu lekkiego dnia.
    let consumed = 0;
    for (let d = addDays(day.date, 1); d < planFrom; d = addDays(d, 1)) {
      if ((tssByDate.get(d) ?? 0) <= RECOVERY_CONFIG.recoveryDayTssMax) consumed++;
    }
    const remaining = needed - consumed;
    const bestRemaining = best ? best.recoveryDaysNeeded - best.recoveryDaysConsumed : -Infinity;
    if (remaining < bestRemaining) continue;
    if (remaining === bestRemaining && best && day.date < best.date) continue;

    const durSec = durByDate.get(day.date) ?? 0;
    best = {
      date: day.date,
      name: race?.name ?? labelByDate.get(day.date)?.name ?? 'ciężki dzień treningowy',
      kind: race ? 'race' : 'training',
      priority: race?.priority ?? null,
      tss: day.tss,
      durationMin: durSec > 0 ? Math.round(durSec / 60) : null,
      recoveryDaysNeeded: needed,
      recoveryDaysConsumed: consumed,
      daysBeforePlanStart: diffDays(planFrom, day.date),
    };
  }

  // ── Dni regeneracji wymuszone w planowanym tygodniu ──
  const recoveryDows: number[] = [];
  if (best) {
    const remaining = Math.min(
      Math.max(0, best.recoveryDaysNeeded - best.recoveryDaysConsumed),
      RECOVERY_CONFIG.maxRecoveryDowsInWeek
    );
    for (let i = 0, d = planFrom; i < remaining; i++, d = addDays(d, 1)) {
      if (diffDays(d, weekStart) > 6) break;      // regeneracja nie wychodzi poza planowany tydzień
      const dow = isoDow(d);
      if (dow === raceDowCurrent) continue;       // dzień startu nie jest dniem regeneracji
      recoveryDows.push(dow);
    }
  }

  const tssFactor = recoveryDows.length
    ? Math.max(
        RECOVERY_CONFIG.tssFactorFloor,
        Math.round((1 - RECOVERY_CONFIG.tssFactorPerDay * recoveryDows.length) * 100) / 100
      )
    : 1;

  const ctx: RecentLoadContext = {
    days,
    last7Tss,
    prev7Tss,
    hardEffort: best,
    recoveryDows,
    tssFactor,
    guidance: null,
  };
  ctx.guidance = buildRecentLoadGuidance(ctx);
  return ctx;
}

// Blok tekstowy dla promptu. null gdy okno jest puste (nowe konto / brak synchronizacji) — wtedy
// nie ma sensu wysyłać modelowi 14 zer i sugerować, że zawodnik nic nie robił.
export function buildRecentLoadGuidance(ctx: RecentLoadContext): string | null {
  const ridden = ctx.days.filter((d) => d.tss > 0);
  if (ridden.length === 0) return null;

  const lines: string[] = [];
  lines.push('CO SIĘ FAKTYCZNIE WYDARZYŁO (ostatnie 14 dni, dane ze Stravy — nie zgaduj, to fakty):');
  // Serie ≥3 dni wolnych zwijane do jednej linii — 8× "wolne" to czysty koszt tokenów, a przy
  // ograniczonym budżecie rozumowania (patrz KRYTYCZNE w prompcie) każda zbędna linia szkodzi.
  for (let i = 0; i < ctx.days.length; i++) {
    const d = ctx.days[i];
    if (d.tss === 0) {
      let j = i;
      while (j + 1 < ctx.days.length && ctx.days[j + 1].tss === 0) j++;
      const run = j - i + 1;
      if (run >= 3) {
        lines.push(`  ${d.dowShort} ${d.date} – ${ctx.days[j].dowShort} ${ctx.days[j].date}: wolne (${run} dni bez jazdy)`);
        i = j;
        continue;
      }
      lines.push(`  ${d.dowShort} ${d.date}: wolne`);
      continue;
    }
    lines.push(`  ${d.dowShort} ${d.date}: ${d.label ?? 'jazda'} — ${d.tss} TSS`);
  }
  lines.push(`Suma TSS ostatnich 7 dni: ${ctx.last7Tss}. Tydzień wcześniej: ${ctx.prev7Tss}.`);

  const h = ctx.hardEffort;
  if (h) {
    const dur = h.durationMin != null ? `, ${Math.floor(h.durationMin / 60)} h ${h.durationMin % 60} min` : '';
    const what = h.kind === 'race'
      ? `START "${h.name}"${h.priority ? ` (ranga ${h.priority})` : ''}`
      : `wyniszczający dzień "${h.name}"`;
    lines.push(
      `KLUCZOWY FAKT: ${h.date} — ${what}: ${h.tss} TSS${dur}. To ${h.daysBeforePlanStart} dni przed pierwszym dniem, który planujesz. ` +
      `Regeneracja należna po takim wysiłku: ${h.recoveryDaysNeeded} dni; zawodnik odebrał już ${h.recoveryDaysConsumed}.`
    );
  }

  if (ctx.recoveryDows.length) {
    const names = ctx.recoveryDows.map((d) => DOW_SHORT[d - 1]).join(', ');
    lines.push(
      `TWARDA REGUŁA REGENERACJI: dni dow [${ctx.recoveryDows.join(', ')}] (${names}) MUSZĄ mieć type OFF, Z1 albo Z2, ` +
      `każdy max ${RECOVERY_CONFIG.recoveryDayTssMax} TSS. ZERO intensywności w tych dniach — żadnego SST/THR/OU/VO2/LONG, ` +
      `nawet "lekkiego akcentu". Plan łamiący tę regułę zostanie ODRZUCONY przez serwer. ` +
      `Cel TSS tygodnia jest już z tego powodu obniżony — nie próbuj nadrabiać obciążenia w pozostałych dniach.`
    );
  } else if (h) {
    lines.push('Regeneracja po tym wysiłku została już odebrana — możesz planować normalnie, ale nie wchodź w tydzień od najcięższej sesji.');
  }

  return lines.join('\n');
}

// ── Walidacja server-side (bliźniak taperLast48hViolation) ───────────────────

// Zwraca opis naruszenia albo null. Sprawdzane na dniach OD MODELU, przed wstrzyknięciem RACE.
export function recoveryViolation(
  days: Array<{ dow: number; type: string; tss: number }>,
  recoveryDows: number[]
): string | null {
  if (!recoveryDows.length) return null;
  const allowed = new Set<string>(RECOVERY_ALLOWED_TYPES);
  for (const dow of recoveryDows) {
    const d = days.find((x) => x.dow === dow);
    if (!d) continue;
    if (!allowed.has(d.type)) {
      return `dzień ${dow} to ${d.type}, a musi być dniem regeneracji (OFF/Z1/Z2) po ciężkim wysiłku`;
    }
    if (d.tss > RECOVERY_CONFIG.recoveryDayTssMax) {
      return `dzień ${dow} ma ${d.tss} TSS, ponad limit ${RECOVERY_CONFIG.recoveryDayTssMax} TSS dla dnia regeneracji`;
    }
  }
  return null;
}
