// Generator planu (ETAP 5.1b) — dwa tygodnie naraz: bieżący SZCZEGÓŁ + następny ZARYS.

import {
  parseDayStructure,
  checkStructureDuration,
  buildLabel,
  structureWatt,
  isStructuredType,
  type DayStructure,
} from '@/lib/structure';
import { sessionStructure } from '@/lib/workout';
import { buildTaperGuidance, type RacePriority } from '@/lib/race-taper';

// RACE = dzień startu (nie trening). Dyskryminator dnia jak OFF/Z2; metadane startu (nazwa,
// szacunki) niesie osobny obiekt `race` na PlanDay, bo nie mieszczą się w polach treningowych.
export const WORKOUT_TYPES = ['OFF', 'Z1', 'Z2', 'SST', 'THR', 'OU', 'VO2', 'LONG', 'RACE'] as const;
export type WorkoutType = (typeof WORKOUT_TYPES)[number];

// Metadane dnia startu — liczone server-side (estimateRaceDay), nie przez AI.
export interface RaceMeta {
  name: string;
  priority: RacePriority;
  distanceKm: number | null;
  elevationM: number | null;
  discipline: string | null;
  estTimeMin: number;   // szacowany czas jazdy
  estTss: number;       // szacowany TSS (tylda — realne dane Strava zastąpią po starcie)
}

export interface PlanDay {
  dow: number;        // 1=Pn ... 7=Nd
  date: string;       // ISO, doliczany server-side
  type: WorkoutType;
  label: string;      // dla dni ze structure GENEROWANY server-side (buildLabel), nie przez AI
  tss: number;
  dur_min: number;
  watt: string;       // dla dni ze structure DERYWOWANY (structureWatt); inaczej "255–275W" lub "–"
  hr: string;         // "155–168" lub "–"
  zones: number[];    // [Z1,Z2,Z3,Z4,Z5] %
  outline: boolean;   // true = zarys (tylko type+label+~tss+~dur)
  locked?: boolean;   // ręczna zmiana usera — generator/modify/suwak NIE rusza (ustawiane server-side)
  // Parametry substruktury sesji (SST/THR/OU/VO2). null/brak = dzień jednolity albo stary plan
  // sprzed kontraktu → render/insight używają fallbacku. Jedno źródło prawdy dla label+profil+insight.
  structure?: DayStructure | null;
  // Metadane startu — obecne WYŁĄCZNIE gdy type==='RACE'. Wstrzykiwane server-side.
  race?: RaceMeta | null;
}

// Kontekst wyścigu dla generatora — wybór wyścigu i jego pozycja w oknie liczone w route.
export interface RaceContext {
  name: string;
  date: string;              // ISO
  priority: RacePriority;
  distanceKm: number | null;
  elevationM: number | null;
  discipline: string | null;
  daysToRace: number;        // od dziś (kontekst ogólny)
  raceDowCurrent: number | null; // dow (1-7) startu w BIEŻĄCYM (szczegółowym) tygodniu, else null
  taperInCurrent: boolean;   // czy bieżący tydzień jest tygodniem startowym (taper aktywny)
}

export interface GeneratorInputs {
  weekStart: string;          // ISO poniedziałek (tydzień bieżący)
  ftp: number;
  mass: number | null;
  vo2max: number | null;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  race: RaceContext | null;   // null = brak wyścigu w zasięgu → budowanie
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
  // Tryb taperu (tydzień startowy w bieżącym tygodniu) ZNOSI reguły budowania — inaczej model
  // próbuje POGODZIĆ "min 2 sesje jakościowe + progresja CTL" z redukcją taperu i grzęźnie w
  // sprzecznym rozumowaniu, wyczerpując budżet tokenów zanim wyemituje JSON (zaobserwowane).
  const isTaper = !!(inp.race && inp.race.taperInCurrent && inp.race.raceDowCurrent != null);
  const system = [
    'Jesteś doświadczonym trenerem kolarstwa. Budujesz horyzont DWÓCH tygodni:',
    'BIEŻĄCY tydzień w pełnym SZCZEGÓLE oraz NASTĘPNY tydzień jako ZARYS (kierunek, dopnie się po sesjach).',
    isTaper
      ? 'Zawodnik: Adrian — puncheur (67 kg). BIEŻĄCY tydzień to TYDZIEŃ STARTOWY (tapering) — NIE stosuj reguł budowania: pomiń wymóg 2 sesji jakościowych i progresji CTL. Jedynym źródłem struktury bieżącego tygodnia jest OPIS TAPERU niżej — wypełnij dni dokładnie wg niego.'
      : 'Zawodnik: Adrian — puncheur. GŁÓWNA SŁABOŚĆ: próg utrzymany 20–60 min. To priorytet rozwojowy: w BIEŻĄCYM tygodniu zaplanuj min. 2 sesje jakościowe (THR/SST/OU) celujące w utrzymany wysiłek progowy 20–60 min.',
    'ZASADY ROZGRZEWKI (wlicz w dur_min i w rozkład stref): min 20 min spokojnej rozgrzewki przed Z2/SST,',
    'min 25 min przed THR/OU/VO2. Każda jakościowa sesja ma rozgrzewkę + część główną + schłodzenie.',
    'TWARDA REGUŁA dla zones[] (tylko tydzień bieżący): rozgrzewka i schłodzenie MUSZĄ być widoczne w strefach.',
    'Dla THR/OU/VO2 udział Z1+Z2 (zones[0]+zones[1]) >= round(25 / dur_min * 100)%.',
    'Dla Z2/SST udział Z1+Z2 >= round(20 / dur_min * 100)%. Przykład: THR 90 min → Z1+Z2 >= 28%.',
    isTaper
      ? 'NIE buduj progresywnie i NIE wymuszaj układu 2 OFF — tydzień startowy rządzi się OPISEM TAPERU niżej (liczba i rozkład dni wolnych wynika z niego). Dzień startu (RACE) zostaw jako OFF, serwer go wypełni.'
      : 'Buduj progresywnie względem CTL. Zostaw regenerację: dni OFF/Z1 i jedną długą LONG w weekend. OBOWIĄZKOWO 2 dni OFF w tygodniu. Jeden zwykle w poniedziałek (regeneracja po weekendzie), drugi w środku tygodnia (czwartek lub piątek — przed lub po sesji jakościowej). Nigdy dwa OFF z rzędu. Sesje jakościowe (THR/OU/VO2) nigdy bezpośrednio obok siebie — zawsze Z1/Z2/OFF między nimi.',
    'MINIMALNY czas sesji to 45 min (dur_min >= 45). Sesje poniżej 45 min nie mają sensu treningowego — jeśli budżet jest za mały, lepiej dać OFF niż krótką sesję. Nie planuj Z1/Z2/regeneracji poniżej 45 min.',
    'Typy: OFF=wolne, Z1=regeneracja, Z2=endurance, SST=sweet spot, THR=threshold, OU=over-under, VO2=vo2max, LONG=długa.',
    'STRUKTURA SESJI (tylko tydzień bieżący): każdy dzień SST/THR/OU/VO2 MUSI mieć pole "structure" z PARAMETRAMI interwałów (liczby całkowite, waty absolutne):',
    'SST/THR/VO2: {"reps":N,"work_min":M,"work_w":waty,"rest_min":P} = N interwałów po M min na work_w watów, przerwy P min Z1 między interwałami.',
    'OU: {"reps":bloki,"cycles":cykle,"under_min":min,"under_w":waty,"over_min":min,"over_w":waty,"rest_min":P} — jeden blok = cycles × (under_min + over_min) min, np. 3 cykle (3min under + 1min over) = blok 12 min; rest_min = przerwa Z1 między blokami. over_w > under_w.',
    'Dla OFF/Z1/Z2/LONG: "structure": null (sesje jednolite, bez substruktury).',
    'TWARDA REGUŁA SPÓJNOŚCI CZASU (dni ze structure): dur_min = rozgrzewka + suma części głównej (interwały/bloki + przerwy między nimi) + schłodzenie 10 min, tolerancja ±2 min.',
    'Rozgrzewka do tej reguły: 20 min dla SST, 25 min dla THR/OU/VO2. Policz i SPRAWDŹ przed zwróceniem JSON — niespójność = BŁĘDNY plan.',
    'TYDZIEŃ ZARYSU (next): podaj TYLKO type + label + orientacyjny tss + przybliżony dur_min.',
    'NIE podawaj watt/hr/zones/structure dla zarysu (zostaw puste — zostaną znormalizowane). To kierunek, nie rozpiska.',
    'FORMAT LABELA: dla dni ze structure NIE podawaj label — serwer wygeneruje go z parametrów.',
    'Dla pozostałych dni: krótka nazwa sesji, MAX ~3 słowa. ŻADNEGO opisu po myślniku, żadnych zdań — opis "dlaczego/po co" idzie WYŁĄCZNIE do insight, nie do label.',
    'Przykłady poprawnych labeli: "Long gravel", "Endurance", "Regeneracja aktywna", "Odpoczynek"; w zarysie też np. "Threshold 2×15min".',
    'INSIGHT (oba tygodnie): MAX 1-2 zdania, prosty codzienny język. Krótko: co to za tydzień i na co zwrócić uwagę.',
    'NIE tłumacz każdej sesji po kolei, nie pisz o TSS ani szczegółów — to ma być zwięzła myśl, nie rozprawka.',
    'KRYTYCZNE: wszystkie obliczenia (TSS, minuty, strefy) wykonaj PO CICHU i ZWIĘŹLE. NIE rozpisuj planu prozą dzień po dniu przed JSON — długie rozumowanie ucina odpowiedź. Cała odpowiedź to JEDEN obiekt JSON — zero tekstu przed "{" i po "}", bez markdown.',
  ].join(' ');

  // Faza tygodnia zależy od wyścigu: TYDZIEŃ STARTOWY → tapering ze strukturą wstecz od startu
  // (znosi dawne bezwarunkowe "Faza budowania"); poza taperem → budowanie z kontekstem startu.
  let raceLine: string;
  if (inp.race && inp.race.taperInCurrent && inp.race.raceDowCurrent != null) {
    raceLine = buildTaperGuidance(inp.race.name, inp.race.priority, inp.race.raceDowCurrent);
  } else if (inp.race) {
    raceLine = `Najbliższy wyścig: ${inp.race.name} (ranga ${inp.race.priority}) za ${inp.race.daysToRace} dni (${inp.race.date}). Poza fazą taperu — buduj formę, ale bez wyniszczających bloków tuż przed startem.`;
  } else {
    raceLine = 'Brak nadchodzącego wyścigu w zasięgu — budowanie ogólnej formy.';
  }

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
    '  "current": {"days":[{"dow":1,"type":"OFF|Z1|Z2|SST|THR|OU|VO2|LONG","label":"... (pomiń dla dni ze structure)",' +
      '"tss":0,"dur_min":0,"hr":"155–168 lub –","zones":[Z1,Z2,Z3,Z4,Z5],' +
      '"structure":{...wg kontraktu wyżej} lub null,"watt":"255–275W lub – (tylko dni bez structure)"}, ...7 dni dow 1..7...],' +
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
  lockedDows: number[]; // dni (dow 1..7) zablokowane ręcznie w oryginale — nie ruszaj bez jawnej prośby
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
      structure: d.structure ?? null, race: d.race ?? null,
    }))
  );

  const raceDay = currentDays.find((d) => d.type === 'RACE');

  const system = [
    'Jesteś trenerem kolarstwa VeloIQ modyfikującym istniejący plan tygodniowy zawodnika.',
    `Zawodnik: Adrian — puncheur, FTP ${ctx.ftp}W${ctx.ctl != null ? `, CTL ${Math.round(ctx.ctl)}` : ''}.`,
    'GŁÓWNA SŁABOŚĆ: próg utrzymany 20–60 min — CHROŃ sesje THR/OU, nie usuwaj ich bez wyraźnej prośby.',
    raceDay
      ? `TYDZIEŃ STARTOWY: dow ${raceDay.dow} to WYŚCIG "${raceDay.label}" (type RACE) — to faza taperingu/szczytowania, NIE budowania.`
      : ctx.raceName && ctx.daysToRace != null
      ? `Najbliższy wyścig: ${ctx.raceName} za ${ctx.daysToRace} dni — trzymaj kierunek budowania formy.`
      : 'Brak najbliższego wyścigu w kalendarzu.',
    raceDay
      ? `Dzień dow ${raceDay.dow} (RACE) PRZEPISZ BEZ ZMIAN (type, race, tss, dur_min) — nie zamieniaj go na trening ani OFF, chyba że user JAWNIE prosi o zmianę wyścigu. Chroń tapering: nie dokładaj ciężkich sesji tuż przed startem.`
      : 'Modyfikuj PODANY plan zgodnie z prośbą — zachowaj sens treningowy, nie generuj od zera.',
    'ZASADY (twarde): dokładnie 7 dni Pn–Nd (dow 1..7). Typy: OFF/Z1/Z2/SST/THR/OU/VO2/LONG/RACE.',
    'Jeśli user chce wolny dzień → type OFF (tss 0, dur_min 0, watt/hr "–", zones [0,0,0,0,0]).',
    'Dni, które user JAWNIE wskazał jako wolne (też wielodniowe, np. cały weekend So+Nd), wypisz w polu "off".',
    'NIE przenoś obciążenia z dnia OFF na inne dni — suma TSS tygodnia ma SPAŚĆ (wolne realnie zmniejsza obciążenie).',
    `DNI ZABLOKOWANE (dow): [${ctx.lockedDows.join(', ') || 'brak'}] — NIE zmieniaj ich, chyba że prośba JAWNIE wskazuje dany dzień.`,
    'Komenda OGÓLNA (np. "zwiększ godziny") — respektuj wszystkie locki, zmieniaj tylko dni niezablokowane.',
    'Komenda JAWNA dla dnia (np. "dołóż trening w sobotę", "odwołaj wolny weekend") — możesz zmienić wskazany dzień.',
    'Domyślnie celuj w 2 nieprzylegające OFF, ale JAWNA prośba użytkownika MA PRIORYTET — jeśli prosi o konkretne wolne dni (np. wolny weekend = So+Nd), ustaw je OFF NAWET gdy przylegają; nie redukuj do jednego, nie dorzucaj trzeciego. Sesje jakościowe (THR/OU/VO2) nie obok siebie.',
    'MINIMALNY czas sesji 45 min (dur_min >= 45) — krótszej nie planuj, daj OFF.',
    'Rozgrzewka min 20 min przed Z2/SST, 25 min przed THR/OU/VO2. zones to % czasu w Z1–Z5, suma ~100.',
    'STRUKTURA: dni SST/THR/OU/VO2 mają pole "structure" z parametrami interwałów — SST/THR/VO2: {"reps","work_min","work_w","rest_min"}; OU: {"reps","cycles","under_min","under_w","over_min","over_w","rest_min"} (blok = cycles×(under_min+over_min) min, rest_min = przerwa Z1 między blokami).',
    'Dni NIEZMIENIANE: przepisz structure BEZ ZMIAN. Dni zmieniane na SST/THR/OU/VO2: podaj nowe structure spójne z dur_min (rozgrzewka 20 SST / 25 THR-OU-VO2 + część główna + schłodzenie 10 = dur_min ±2). Dni OFF/Z1/Z2/LONG: structure null.',
    'Label: dla dni ze structure zostanie wygenerowany przez serwer (możesz pominąć). Dla pozostałych: krótka nazwa, MAX ~3 słowa, bez zdań.',
    'insight: 1–2 zdania PO POLSKU opisujące AKTUALNY tydzień PO zmianie — co to za tydzień i na co zwrócić uwagę (jak przy generacji planu, opis STANU). NIE pisz "zmieniłem/skróciłem" — to opis planu, nie edycji. MUSI zgadzać się z nowym planem.',
    'change: 1–2 zdania PO POLSKU co KONKRETNIE zmieniłeś i dlaczego (np. "Skróciłem wtorkowe interwały, bo brakowało regeneracji po weekendzie."). To idzie do rozmowy z zawodnikiem, NIE na kartę planu.',
    'userSpecifiedDays: WYŁĄCZNIE dni (dow), które user JAWNIE wymienił w prośbie (np. "wtorek Z2, środa wolna" → [2,3]). NIE dokładaj tu dni, które tylko przebudowałeś dla równowagi TSS — te idą do changedDays. Serwer blokuje (lock) TYLKO userSpecifiedDays.',
    'Zwróć WYŁĄCZNIE JSON (bez markdown): {"days":[...7 dni dow 1..7...],"insight":"...","change":"...","changedDays":[dow przebudowane w planie],"userSpecifiedDays":[dow jawnie wymienione przez usera],"unlock":[dow do odblokowania],"off":[dow jawnie wskazane jako wolne]}.',
  ].join(' ');

  const user = [
    `Aktualny plan (JSON): ${planJson}`,
    '',
    `Prośba zawodnika: "${message}"`,
    '',
    'Zwróć zmodyfikowany plan jako JSON {days, insight, change}. Nie dodawaj pola date.',
  ].join('\n');

  return { system, user };
}

// Leksykon: dni tygodnia (dow 1..7) faktycznie WYSTĘPUJĄCE w surowym tekście komendy usera.
// Diakrytyki normalizowane (sroda=środa), case-insensitive, dopasowanie po rdzeniu (wtorek/wtorki).
// UŻYCIE: walidacja lock set — serwer lockuje TYLKO userSpecifiedDays ∩ parseCommandDows(message),
// więc dzień nieobecny w tekście NIE zostanie zablokowany, choćby AI wrzucił go do userSpecifiedDays.
// Przecięcie jest jednostronne (może lock set tylko zwęzić) → over-locking niemożliwy z konstrukcji.
// Under-locking przy egzotycznym sformułowaniu = łagodna degradacja (dzień po prostu skalowalny).
const DOW_PATTERNS: Array<[RegExp, number[]]> = [
  [/weekend/, [6, 7]],
  [/\brobocz|dni\s+robocze/, [1, 2, 3, 4, 5]],
  [/\bponiedzial|\bpn\b/, [1]],
  [/\bwtor|\bwt\b/, [2]],
  [/\bsrod[aey]|\bsr\b/, [3]],
  [/\bczwart|\bczw\b/, [4]],
  [/\bpiat|\bpt\b/, [5]],
  [/\bsobot|\bsob\b/, [6]],
  [/\bniedziel|\bndz\b|\bnd\b/, [7]],
];

export function parseCommandDows(message: string): number[] {
  const norm = message
    .toLowerCase()
    .replace(/ł/g, 'l')                    // ł nie jest łączonym diakrytykiem — ręcznie
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');      // usuń pozostałe diakrytyki (ą,ć,ę,ś,ó,ż,ź,ń)
  const dows = new Set<number>();
  for (const [re, list] of DOW_PATTERNS) if (re.test(norm)) list.forEach((d) => dows.add(d));
  return Array.from(dows).sort((a, b) => a - b);
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
// requireStructure=true (generator): dzień SST/THR/OU/VO2 bez poprawnego structure = błąd → retry,
// jak przy TSS. Bez flagi (modify, tolerancyjnie): structure walidowane gdy jest, brak → null (fallback).
export function validateWeek(
  rawDays: unknown,
  weekStart: string,
  opts: { outline: boolean; requireStructure?: boolean }
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

    let structure: DayStructure | null = null;
    let race: RaceMeta | null = null;

    if (type === 'RACE') {
      // Dzień startu — nie trening. tss/dur zachowane (wstrzyknięte server-side), reszta martwa.
      // W trybie modify AI ma przepisać RACE bez zmian; carry meta z surowego dnia jeśli jest.
      watt = '–'; hr = '–'; zones = [0, 0, 0, 0, 0];
      const rawRace = d.race as Record<string, unknown> | null | undefined;
      if (rawRace && typeof rawRace.name === 'string') {
        race = {
          name: rawRace.name,
          priority: (['A', 'B', 'C'].includes(String(rawRace.priority)) ? rawRace.priority : 'A') as RacePriority,
          distanceKm: rawRace.distanceKm != null ? Number(rawRace.distanceKm) : null,
          elevationM: rawRace.elevationM != null ? Number(rawRace.elevationM) : null,
          discipline: typeof rawRace.discipline === 'string' ? rawRace.discipline : null,
          estTimeMin: Math.max(0, Math.round(Number(rawRace.estTimeMin) || 0)),
          estTss: Math.max(0, Math.round(Number(rawRace.estTss) || 0)),
        };
      }
    } else if (opts.outline) {
      // ZARYS: tylko type + label + tss + ~dur. Reszta pusta. Bez kontroli stref, bez structure.
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
      // SUBSTRUKTURA (SST/THR/OU/VO2): parametry z AI → walidacja kształtu + spójności czasu.
      // Label i watt dnia DERYWOWANE ze structure (jedna prawda) — to co pisze AI jest ignorowane.
      if (isStructuredType(type)) {
        if (d.structure != null) {
          const p = parseDayStructure(d.structure, type);
          if (!p.ok) return { ok: false, error: `dzień ${dow} (${type}): structure — ${p.error}` };
          const ss = sessionStructure(type);
          const durErr = checkStructureDuration(p.structure, durMin, ss.warmupDefault, ss.cooldownDefault);
          if (durErr) return { ok: false, error: `dzień ${dow} (${type}): ${durErr}` };
          structure = p.structure;
          watt = structureWatt(structure);
        } else if (opts.requireStructure) {
          return { ok: false, error: `dzień ${dow} (${type}): brak wymaganego pola structure` };
        }
      }
    }

    days.push({
      dow,
      date: dateForDow(weekStart, dow),
      type,
      label: structure
        ? buildLabel(type, structure)
        : race
        ? race.name
        : typeof d.label === 'string' && d.label.trim() ? d.label.trim() : type,
      tss,
      dur_min: durMin,
      watt,
      hr,
      zones,
      outline: opts.outline,
      structure,
      race,
    });
  }

  return { ok: true, days };
}

// Indeks '}' domykającego obiekt zaczynający się na cleaned[start]==='{' (świadomy stringów
// i escape'ów). -1 gdy niedomknięty (np. odpowiedź ucięta na max_tokens).
function matchBrace(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

// Wyciąga finalny obiekt planu z odpowiedzi. Model mimo zakazu potrafi rozumować w prozie
// pełnej nawiasów {} i SZKICÓW JSON-a z "current" — dlatego kandydaci to wystąpienia
// '"current"' od OSTATNIEGO (finalny JSON jest na końcu), każdy balansowany i parsowany;
// pierwszy poprawny wygrywa. Fallback bez kotwicy: pierwszy { … ostatni } (stare zachowanie).
function extractPlanObject(rawText: string): unknown | null {
  const cleaned = rawText.replace(/```json|```/g, '');
  let idx = cleaned.lastIndexOf('"current"');
  while (idx !== -1) {
    const start = cleaned.lastIndexOf('{', idx);
    if (start !== -1) {
      const end = matchBrace(cleaned, start);
      if (end !== -1) {
        try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* szkic — szukaj dalej */ }
      }
    }
    idx = cleaned.lastIndexOf('"current"', idx - 1);
  }
  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(cleaned.slice(a, b + 1)); } catch { return null; }
}

// Waliduje odpowiedź {current, next}.
export function validateTwoWeekPlan(
  rawText: string,
  currentWeekStart: string,
  nextWeek: string
): TwoWeekValidation {
  const parsed = extractPlanObject(rawText);
  if (parsed === null) return { ok: false, error: 'brak poprawnego obiektu JSON w odpowiedzi' };

  const obj = parsed as {
    current?: { days?: unknown; insight?: unknown };
    next?: { days?: unknown; insight?: unknown };
  };

  if (!obj.current || !obj.next) {
    return { ok: false, error: 'brak klucza current lub next' };
  }

  const cur = validateWeek(obj.current.days, currentWeekStart, { outline: false, requireStructure: true });
  if (!cur.ok || !cur.days) return { ok: false, error: `bieżący: ${cur.error}` };

  const nxt = validateWeek(obj.next.days, nextWeek, { outline: true });
  if (!nxt.ok || !nxt.days) return { ok: false, error: `następny: ${nxt.error}` };

  return {
    ok: true,
    current: { days: cur.days, insight: typeof obj.current.insight === 'string' ? obj.current.insight.trim() : '' },
    next: { days: nxt.days, insight: typeof obj.next.insight === 'string' ? obj.next.insight.trim() : '' },
  };
}
