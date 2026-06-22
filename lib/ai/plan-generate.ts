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
  weeklyTssTarget: number;        // cel TSS tygodnia bieżącego
  nextWeeklyTssTarget: number;    // cel TSS tygodnia zarysu (next)
}

// Przedział twardej reguły dla promptu (target ±, węższy niż walidacja serwera).
export function tssBand(target: number, lo = 0.95, hi = 1.10): [number, number] {
  return [Math.round(target * lo), Math.round(target * hi)];
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
    'OBOWIĄZKOWO 2 dni OFF w tygodniu. Jeden zwykle w poniedziałek (regeneracja po weekendzie), drugi w środku tygodnia (czwartek lub piątek — przed lub po sesji jakościowej). Nigdy dwa OFF z rzędu. Sesje jakościowe (THR/OU/VO2) nigdy bezpośrednio obok siebie — zawsze Z1/Z2/OFF między nimi.',
    'MINIMALNY czas sesji to 45 min (dur_min >= 45). Sesje poniżej 45 min nie mają sensu treningowego — jeśli budżet jest za mały, lepiej dać OFF niż krótką sesję. Nie planuj Z1/Z2/regeneracji poniżej 45 min.',
    'Typy: OFF=wolne, Z1=regeneracja, Z2=endurance, SST=sweet spot, THR=threshold, OU=over-under, VO2=vo2max, LONG=długa.',
    'TYDZIEŃ ZARYSU (next): podaj TYLKO type + label + orientacyjny tss + przybliżony dur_min.',
    'NIE podawaj watt/hr/zones dla zarysu (zostaw puste — zostaną znormalizowane). To kierunek, nie rozpiska.',
    'FORMAT LABELA (oba tygodnie): krótka nazwa sesji = typ + opcjonalnie struktura interwałów, MAX ~3 słowa.',
    'ŻADNEGO opisu po myślniku, żadnych zdań — opis "dlaczego/po co" idzie WYŁĄCZNIE do insight, nie do label.',
    'Przykłady poprawnych labeli: "Threshold 2×15min", "Sweet Spot 3×15min", "Over-Under 3×12min", "VO2max 5×5min", "Long gravel", "Endurance", "Regeneracja aktywna", "Odpoczynek".',
    'INSIGHT (oba tygodnie): MAX 1-2 zdania, prosty codzienny język. Krótko: co to za tydzień i na co zwrócić uwagę.',
    'NIE tłumacz każdej sesji po kolei, nie pisz o TSS ani szczegółów — to ma być zwięzła myśl, nie rozprawka.',
    'Zwróć WYŁĄCZNIE poprawny JSON (bez markdown, bez tekstu przed/po).',
  ].join(' ');

  const raceLine = inp.raceName && inp.daysToRace != null
    ? `Najbliższy wyścig: ${inp.raceName} za ${inp.daysToRace} dni (${inp.raceDate}). Faza budowania.`
    : 'Brak nadchodzącego wyścigu — budowanie ogólnej formy.';

  const [curLo, curHi] = tssBand(inp.weeklyTssTarget);
  const [nxtLo, nxtHi] = tssBand(inp.nextWeeklyTssTarget);

  const user = [
    `Profil: FTP ${inp.ftp}W, masa ${inp.mass ?? '—'} kg, VO2max ${inp.vo2max ?? '—'}.`,
    `Forma: CTL ${inp.ctl ?? '—'}, ATL ${inp.atl ?? '—'}, TSB ${inp.tsb ?? '—'}.`,
    raceLine,
    `TWARDA REGUŁA TSS: suma TSS BIEŻĄCEGO tygodnia MUSI mieścić się w przedziale ${curLo}–${curHi} (cel ${inp.weeklyTssTarget}). Wyjście poza ten przedział = BŁĘDNY plan, popraw rozkład.`,
    `Suma TSS NASTĘPNEGO tygodnia (zarys) MUSI mieścić się w przedziale ${nxtLo}–${nxtHi} (cel ${inp.nextWeeklyTssTarget}). Trzymaj sensowną progresję, nie skacz.`,
    `Aby TRAFIĆ w przedział, dobierz WIELKOŚCI sesji — typowo: 3 sesje jakościowe po ~70–90 TSS, 1 LONG ~110–140 TSS, dni Z1/Z2 ~25–65 TSS, OFF=0. Zmniejsz sesje jeśli suma za duża.`,
    `Zsumuj TSS wszystkich 7 dni każdego tygodnia i SPRAWDŹ, że mieści się w przedziale, ZANIM zwrócisz JSON. To wymóg twardy.`,
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

// ── Prompt modyfikacji (ETAP 5.7: czat) ───────────────────────────────────────

export interface ModifyContext {
  ftp: number;
  ctl: number | null;
  raceName: string | null;
  daysToRace: number | null;
}

// Modyfikuje ISTNIEJĄCY plan tygodnia wg prośby użytkownika (nie generuje od zera).
export function buildModifyPrompt(
  currentDays: PlanDay[],
  ctx: ModifyContext,
  message: string
): { system: string; user: string } {
  const planJson = JSON.stringify(
    currentDays.map((d) => ({
      dow: d.dow, type: d.type, label: d.label, tss: d.tss, dur_min: d.dur_min, watt: d.watt, hr: d.hr, zones: d.zones,
    }))
  );

  const system = [
    'Jesteś trenerem kolarstwa VeloIQ modyfikującym istniejący plan tygodniowy zawodnika.',
    `Zawodnik: Adrian — puncheur, FTP ${ctx.ftp}W${ctx.ctl != null ? `, CTL ${Math.round(ctx.ctl)}` : ''}.`,
    'GŁÓWNA SŁABOŚĆ: próg utrzymany 20–60 min — CHROŃ sesje THR/OU, nie usuwaj ich bez wyraźnej prośby.',
    ctx.raceName && ctx.daysToRace != null
      ? `Najbliższy wyścig: ${ctx.raceName} za ${ctx.daysToRace} dni — trzymaj kierunek budowania formy.`
      : 'Brak najbliższego wyścigu w kalendarzu.',
    'Modyfikuj PODANY plan zgodnie z prośbą — zachowaj sens treningowy, nie generuj od zera.',
    'ZASADY (twarde): dokładnie 7 dni Pn–Nd (dow 1..7). Typy: OFF/Z1/Z2/SST/THR/OU/VO2/LONG.',
    'Jeśli user chce wolny dzień → type OFF (tss 0, dur_min 0, watt/hr "–", zones [0,0,0,0,0]); obciążenie rozłóż na inne dni.',
    'OBOWIĄZKOWO 2 dni OFF w tygodniu, nigdy dwa OFF z rzędu. Sesje jakościowe (THR/OU/VO2) nigdy obok siebie.',
    'MINIMALNY czas sesji 45 min (dur_min >= 45) — krótszej nie planuj, daj OFF.',
    'Rozgrzewka min 20 min przed Z2/SST, 25 min przed THR/OU/VO2. zones to % czasu w Z1–Z5, suma ~100.',
    'Label: krótka nazwa (typ + ewentualnie struktura), MAX ~3 słowa, bez zdań.',
    'insight: 1–2 zdania PO POLSKU co zmieniłeś i dlaczego — MUSI zgadzać się z nowym planem.',
    'Zwróć WYŁĄCZNIE JSON (bez markdown, bez tekstu przed/po): {"days":[{...7 dni dow 1..7...}],"insight":"..."}.',
  ].join(' ');

  const user = [
    `Aktualny plan (JSON): ${planJson}`,
    '',
    `Prośba zawodnika: "${message}"`,
    '',
    'Zwróć zmodyfikowany plan jako JSON {days, insight}. Nie dodawaj pola date.',
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
    // Wytnij sam obiekt JSON (od pierwszego { do ostatniego }) — odporne na ewentualny
    // tekst/rozumowanie przed lub po JSON-ie oraz na ogrodzenia ```.
    const cleaned = rawText.replace(/```json|```/g, '');
    const a = cleaned.indexOf('{');
    const b = cleaned.lastIndexOf('}');
    if (a === -1 || b === -1 || b <= a) return { ok: false, error: 'brak obiektu JSON w odpowiedzi' };
    parsed = JSON.parse(cleaned.slice(a, b + 1));
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
