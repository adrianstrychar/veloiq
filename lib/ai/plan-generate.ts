// Generator planu (ETAP 5.1b) — dwa tygodnie naraz: bieżący SZCZEGÓŁ + następny ZARYS.

export const WORKOUT_TYPES = ['OFF', 'Z1', 'Z2', 'SST', 'THR', 'OU', 'VO2', 'LONG'] as const;
export type WorkoutType = (typeof WORKOUT_TYPES)[number];

export interface PlanDay {
  dow: number;        // 1=Pn ... 7=Nd
  date: string;       // ISO, doliczany server-side
  type: WorkoutType;
  label: string;
  tss: number;
  dur_min: number;
  watt: string;       // "255–275W" lub "–"
  hr: string;         // "155–168" lub "–"
  zones: number[];    // [Z1,Z2,Z3,Z4,Z5] %
  outline: boolean;   // true = zarys (tylko type+label+~tss+~dur)
}

export interface GeneratorInputs {
  weekStart: string;          // ISO poniedziałek (tydzień bieżący)
  ftp: number;
  mass: number | null;
  vo2max: number | null;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  raceName: string | null;
  raceDate: string | null;    // ISO
  daysToRace: number | null;
  weeklyTssTarget: number;
}

// ── Daty ────────────────────────────────────────────────────────────────────

// Poniedziałek tygodnia zawierającego `d` (ISO 'YYYY-MM-DD'), liczone w UTC.
export function mondayOf(d: Date): string {
  const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = u.getUTCDay(); // 0=Nd..6=So
  const diff = dow === 0 ? -6 : 1 - dow; // przesuń do poniedziałku
  u.setUTCDate(u.getUTCDate() + diff);
  return u.toISOString().slice(0, 10);
}

// ISO data dnia `dow` (1..7) w tygodniu zaczynającym się od weekStart.
export function dateForDow(weekStart: string, dow: number): string {
  const u = new Date(weekStart + 'T00:00:00Z');
  u.setUTCDate(u.getUTCDate() + (dow - 1));
  return u.toISOString().slice(0, 10);
}

// Poniedziałek następnego tygodnia.
export function nextWeekStart(weekStart: string): string {
  const u = new Date(weekStart + 'T00:00:00Z');
  u.setUTCDate(u.getUTCDate() + 7);
  return u.toISOString().slice(0, 10);
}

// ── Prompt (dwa tygodnie) ─────────────────────────────────────────────────────

export function buildTwoWeekPrompt(inp: GeneratorInputs): { system: string; user: string } {
  const system = [
    'Jesteś doświadczonym trenerem kolarstwa. Budujesz horyzont DWÓCH tygodni:',
    'BIEŻĄCY tydzień w pełnym SZCZEGÓLE oraz NASTĘPNY tydzień jako ZARYS (kierunek, dopnie się po sesjach).',
    'Zawodnik: Adrian — puncheur. GŁÓWNA SŁABOŚĆ: próg utrzymany 20–60 min. To priorytet rozwojowy:',
    'w BIEŻĄCYM tygodniu zaplanuj min. 2 sesje jakościowe (THR/SST/OU) celujące w utrzymany wysiłek progowy 20–60 min.',
    'ZASADY ROZGRZEWKI (wlicz w dur_min i w rozkład stref): min 20 min spokojnej rozgrzewki przed Z2/SST,',
    'min 25 min przed THR/OU/VO2. Każda jakościowa sesja ma rozgrzewkę + część główną + schłodzenie.',
    'TWARDA REGUŁA dla zones[] (tylko tydzień bieżący): rozgrzewka i schłodzenie MUSZĄ być widoczne w strefach.',
    'Dla THR/OU/VO2 udział Z1+Z2 (zones[0]+zones[1]) >= round(25 / dur_min * 100)%.',
    'Dla Z2/SST udział Z1+Z2 >= round(20 / dur_min * 100)%. Przykład: THR 90 min → Z1+Z2 >= 28%.',
    'Buduj progresywnie względem CTL. Zostaw regenerację: dni OFF/Z1 i jedną długą LONG w weekend.',
    'Typy: OFF=wolne, Z1=regeneracja, Z2=endurance, SST=sweet spot, THR=threshold, OU=over-under, VO2=vo2max, LONG=długa.',
    'TYDZIEŃ ZARYSU (next): podaj TYLKO type + label + orientacyjny tss + przybliżony dur_min.',
    'NIE podawaj watt/hr/zones dla zarysu (zostaw puste — zostaną znormalizowane). To kierunek, nie rozpiska.',
    'Zwróć WYŁĄCZNIE poprawny JSON (bez markdown, bez tekstu przed/po).',
  ].join(' ');

  const raceLine = inp.raceName && inp.daysToRace != null
    ? `Najbliższy wyścig: ${inp.raceName} za ${inp.daysToRace} dni (${inp.raceDate}). Faza budowania.`
    : 'Brak nadchodzącego wyścigu — budowanie ogólnej formy.';

  const user = [
    `Profil: FTP ${inp.ftp}W, masa ${inp.mass ?? '—'} kg, VO2max ${inp.vo2max ?? '—'}.`,
    `Forma: CTL ${inp.ctl ?? '—'}, ATL ${inp.atl ?? '—'}, TSB ${inp.tsb ?? '—'}.`,
    raceLine,
    `Cel TSS bieżącego tygodnia ~${inp.weeklyTssTarget} (orientacyjnie). Następny tydzień: podobny rząd wielkości.`,
    `Bieżący tydzień zaczyna się w poniedziałek ${inp.weekStart}, następny tydzień tydzień później.`,
    '',
    'Zwróć JSON w formacie:',
    '{',
    '  "current": {"days":[{"dow":1,"type":"OFF|Z1|Z2|SST|THR|OU|VO2|LONG","label":"...",' +
      '"tss":0,"dur_min":0,"watt":"255–275W lub –","hr":"155–168 lub –","zones":[Z1,Z2,Z3,Z4,Z5]}, ...7 dni dow 1..7...],' +
      '"insight":"1-2 zdania co zaplanowałeś i dlaczego"},',
    '  "next": {"days":[{"dow":1,"type":"...","label":"...","tss":0,"dur_min":0}, ...7 dni dow 1..7...],' +
      '"insight":"1 zdanie o kierunku następnego tygodnia"}',
    '}',
    '',
    'Wymogi: każdy tydzień dokładnie 7 dni (dow 1..7 rosnąco). Dla OFF: tss 0, dur_min 0.',
    'Bieżący: zones to % w Z1–Z5, suma ~100. Nie dodawaj pola date — zostanie doliczone.',
  ].join('\n');

  return { system, user };
}

// ── Walidacja ────────────────────────────────────────────────────────────────

export interface WeekValidation {
  ok: boolean;
  days?: PlanDay[];
  insight?: string;
  error?: string;
}

export interface TwoWeekValidation {
  ok: boolean;
  current?: { days: PlanDay[]; insight: string };
  next?: { days: PlanDay[]; insight: string };
  error?: string;
}

// Waliduje tablicę dni jednego tygodnia. outline=true → tryb zarysu (luźniejszy).
export function validateWeek(
  rawDays: unknown,
  weekStart: string,
  opts: { outline: boolean }
): WeekValidation {
  if (!Array.isArray(rawDays) || rawDays.length !== 7) {
    return { ok: false, error: `oczekiwano 7 dni, otrzymano ${Array.isArray(rawDays) ? rawDays.length : 'brak'}` };
  }

  const days: PlanDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = rawDays[i] as Record<string, unknown>;
    const dow = i + 1;

    const type = String(d.type ?? '') as WorkoutType;
    if (!WORKOUT_TYPES.includes(type)) {
      return { ok: false, error: `dzień ${dow}: nieznany typ "${d.type}"` };
    }

    let tss = Math.max(0, Math.round(Number(d.tss) || 0));
    let durMin = Math.max(0, Math.round(Number(d.dur_min) || 0));
    let watt = typeof d.watt === 'string' && d.watt.trim() ? d.watt.trim() : '–';
    let hr = typeof d.hr === 'string' && d.hr.trim() ? d.hr.trim() : '–';
    let zones = Array.isArray(d.zones) ? d.zones.map((z) => Math.round(Number(z) || 0)) : [];
    if (zones.length !== 5) zones = [0, 0, 0, 0, 0];
    zones = zones.map((z) => Math.max(0, Math.min(100, z)));

    if (opts.outline) {
      // ZARYS: tylko type + label + tss + ~dur. Reszta pusta. Bez kontroli stref.
      watt = '–'; hr = '–'; zones = [0, 0, 0, 0, 0];
      if (type === 'OFF') { tss = 0; durMin = 0; }
    } else if (type === 'OFF') {
      tss = 0; durMin = 0; watt = '–'; hr = '–'; zones = [0, 0, 0, 0, 0];
    } else {
      // SZCZEGÓŁ, dzień z treningiem: walidacja sumy stref (tolerancja 90–110)
      const zsum = zones.reduce((a, b) => a + b, 0);
      if (zsum < 90 || zsum > 110) {
        return { ok: false, error: `dzień ${dow} (${type}): strefy sumują się do ${zsum}%, poza 90–110` };
      }
    }

    days.push({
      dow,
      date: dateForDow(weekStart, dow),
      type,
      label: typeof d.label === 'string' && d.label.trim() ? d.label.trim() : type,
      tss,
      dur_min: durMin,
      watt,
      hr,
      zones,
      outline: opts.outline,
    });
  }

  return { ok: true, days };
}

// Waliduje odpowiedź {current, next}.
export function validateTwoWeekPlan(
  rawText: string,
  currentWeekStart: string,
  nextWeek: string
): TwoWeekValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
  } catch {
    return { ok: false, error: 'JSON parse failed' };
  }

  const obj = parsed as {
    current?: { days?: unknown; insight?: unknown };
    next?: { days?: unknown; insight?: unknown };
  };

  if (!obj.current || !obj.next) {
    return { ok: false, error: 'brak klucza current lub next' };
  }

  const cur = validateWeek(obj.current.days, currentWeekStart, { outline: false });
  if (!cur.ok || !cur.days) return { ok: false, error: `bieżący: ${cur.error}` };

  const nxt = validateWeek(obj.next.days, nextWeek, { outline: true });
  if (!nxt.ok || !nxt.days) return { ok: false, error: `następny: ${nxt.error}` };

  return {
    ok: true,
    current: { days: cur.days, insight: typeof obj.current.insight === 'string' ? obj.current.insight.trim() : '' },
    next: { days: nxt.days, insight: typeof obj.next.insight === 'string' ? obj.next.insight.trim() : '' },
  };
}
