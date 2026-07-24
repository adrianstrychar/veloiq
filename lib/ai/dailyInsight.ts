// AI Insight "na dziś" wg modelu A: plan jest domyślną prawdą, Insight jest jego OBROŃCĄ,
// nie recenzentem. Domyślnie tłumaczy PO CO dzisiejszy trening (w kontekście wczoraj + fazy).
// Korekta = WYJĄTEK z twardym uzasadnieniem z danych (TSB, rampa CTL) + ASYMETRIA:
// ku odpoczynkowi przy przemęczeniu — dozwolona; ku wysiłkowi — prawie nigdy, w taperze NIGDY.
// Bez WHOOP jedyne "dane" to PMC (TSB/rampa) + kalendarz startów (okno taperu z race-taper #58).
import { taperDaysFor, type RacePriority } from '@/lib/race-taper';

export interface DailyInsightMetrics {
  date: string;
  ctl: number;
  atl: number;
  tsb: number;
  peakCtl: number;
  ctlRamp: number; // zmiana CTL w 7 dni
}

// Slim dzień planu — do "PO CO ten trening". label jest generowany ze structure (#session-detail),
// więc niesie już strukturę ("Over-Under 3×12min") — Insight ma go tłumaczyć, nie kwestionować.
export interface PlanDaySlim {
  type: string;
  label: string;
}

// Wczoraj: co ZAPLANOWANO + co WYKONANO (dopasowana jazda dnia). Do rozumowania
// "wczoraj THR → dziś Z2 to celowa regeneracja".
export interface YesterdayContext {
  plan: PlanDaySlim | null;
  executed: { type: string | null; tss: number | null; name: string | null } | null;
}

export interface RaceContext {
  name: string;
  daysToRace: number;    // date startu − dziś (dni)
  priority: RacePriority;
  taperDays: number;     // taperDaysFor(priority) — okno szczytowania
  inTaper: boolean;      // daysToRace w oknie taperu → WETO na intensywność
  nearRace: boolean;     // przed oknem taperu, ale start się zbliża → przypomnienie, bez weta
}

// ── PARAMETRY (jedyne miejsce do strojenia) ──────────────────────────────────
export const NEAR_RACE_HORIZON_DAYS = 14; // "start się zbliża" (przed oknem taperu)
export const HIGH_TSB_FOR_PUSH = 20;      // próg "bardzo wypoczęty" dla wyjątku docisku
// Typy obciążające — po nich lekki dzień jest CELOWĄ regeneracją (nie "lekki bez powodu").
const HARD_TYPES = new Set(['THR', 'VO2', 'OU', 'SST', 'LONG']);
const EASY_TYPES = new Set(['OFF', 'Z1', 'Z2']);

// Kontekst startu z daty i rangi. Okno taperu = twarde weto na docisk (reuse #58).
export function buildRaceContext(name: string, priority: RacePriority, daysToRace: number): RaceContext {
  const taperDays = taperDaysFor(priority);
  const inTaper = taperDays > 0 && daysToRace >= 0 && daysToRace <= taperDays;
  const nearRace = !inTaper && daysToRace >= 0 && daysToRace <= NEAR_RACE_HORIZON_DAYS;
  return { name, daysToRace, priority, taperDays, inTaper, nearRace };
}

export interface Directives {
  taperVeto: boolean;        // w oknie taperu → ZAKAZ zachęty do intensywności, niezależnie od TSB
  nearRaceReminder: boolean; // start blisko, przed taperem → przypomnij, nie namawiaj
  pushConsiderable: boolean; // WĄSKI wyjątek: delikatny docisk dozwolony
}

// TWARDE REGUŁY W KODZIE (nie zdane na model): asymetria wyliczana z danych, nie z samopoczucia.
export function computeDirectives(
  m: DailyInsightMetrics,
  today: PlanDaySlim | null,
  yesterday: YesterdayContext | null,
  race: RaceContext | null
): Directives {
  const taperVeto = !!race && race.inTaper;
  const nearRaceReminder = !!race && race.nearRace;

  const yType = yesterday?.executed?.type ?? yesterday?.plan?.type ?? null;
  const yesterdayHard = !!yType && HARD_TYPES.has(yType);
  const todayEasy = !!today && EASY_TYPES.has(today.type);

  // Docisk sugerowany TYLKO gdy dane twardo go bronią: bardzo wysoki TSB + forma nie rośnie
  // + dzień dziś lekki BEZ powodu (wczoraj nie było ciężko) + brak startu w pobliżu.
  // Nawet wtedy: delikatnie, jako opcja. Nigdy w taperze/blisko startu.
  const pushConsiderable =
    !taperVeto &&
    !nearRaceReminder &&
    m.tsb >= HIGH_TSB_FOR_PUSH &&
    m.ctlRamp <= 0 &&
    todayEasy &&
    !yesterdayHard;

  return { taperVeto, nearRaceReminder, pushConsiderable };
}

function round(n: number): number {
  return Math.round(n);
}

// ── HARD-CHECK NA WYJŚCIU (gwarancja w kodzie, nie zaufanie do modelu) ─────────
// Błąd Insightu w tygodniu startowym A może zepsuć wyścig — więc nawet jeśli model
// mimo instrukcji napisze zachętę do docisku w oknie taperu, KOD podmienia tekst na
// bezpieczny fallback. Wykrywamy NIEZANEGOWANE wystąpienie tokenu "docisku".
const PUSH_TOKENS = [
  'wciśnij gaz', 'wciśnij', 'dociśnij', 'dociskaj', 'docisk', 'mocniej', 'szarżuj',
  'dorzuć', 'dorzucaj', 'dołóż', 'dokładaj', 'podbij', 'podkręć', 'przyspiesz',
  'intensywniej', 'większą intensywność', 'wyciśnij', 'wykręć', 'więcej gazu',
  'więcej bodźca', 'ostrzej', 'cięższ', 'mocny akcent',
];
// Słowo negujące BEZPOŚREDNIO przed tokenem (wąskie okno) → wystąpienie jest zanegowane
// ("nie dorzucaj", "bez docisku") i NIE liczy się jako zachęta. Wąsko, by nie przepuścić docisku.
const NEG_WORD = /^(nie|bez|zamiast|unikaj|żadnego|żadnej|żadnych|niż)$/;

export function mentionsPushIntensity(text: string): boolean {
  const t = text.toLowerCase();
  for (const tok of PUSH_TOKENS) {
    let idx = t.indexOf(tok);
    while (idx !== -1) {
      const before = t.slice(Math.max(0, idx - 28), idx);
      const prevWord = before.match(/(\S+)\s*$/)?.[1] ?? '';
      if (!NEG_WORD.test(prevWord)) return true; // niezanegowany docisk
      idx = t.indexOf(tok, idx + tok.length);
    }
  }
  return false;
}

function taperFallback(race: RaceContext): string {
  return `Start "${race.name}" za ${race.daysToRace} dni — jesteś w taperze. Trzymaj się dzisiejszego lekkiego planu; świeżość, którą czujesz, to cel szczytowania, a nie powód, żeby cokolwiek dokładać.`;
}

// Bramka bezpieczeństwa wyjścia. Ranga A + okno taperu + wykryty docisk → podmiana.
// Zwraca tekst (ew. fallback) i flagę vetoed (do logowania/telemetrii).
export function enforceInsightSafety(
  text: string,
  m: DailyInsightMetrics,
  today: PlanDaySlim | null,
  yesterday: YesterdayContext | null,
  race: RaceContext | null
): { text: string; vetoed: boolean } {
  const d = computeDirectives(m, today, yesterday, race);
  if (race && race.priority === 'A' && d.taperVeto && mentionsPushIntensity(text)) {
    return { text: taperFallback(race), vetoed: true };
  }
  return { text, vetoed: false };
}

export function buildDailyInsightPrompt(
  m: DailyInsightMetrics,
  today: PlanDaySlim | null,
  yesterday: YesterdayContext | null,
  race: RaceContext | null
): { system: string; user: string } {
  const d = computeDirectives(m, today, yesterday, race);

  // Reguły dnia — treść zależna od danych, budowana w KODZIE. Model tylko je wykonuje.
  const rules: string[] = [];
  if (d.taperVeto && race) {
    rules.push(
      `WETO TAPEROWE: jesteś w oknie taperu przed startem "${race.name}" (za ${race.daysToRace} dni, ranga ${race.priority}). ` +
        'ZAKAZ jakiejkolwiek zachęty do intensywności czy "dorzucenia", NIEZALEŻNIE od TSB. ' +
        'Broń odpoczynku stanowczo: świeżość, którą czujesz, to CEL taperu — nie dorzucaj. Wysoki TSB = tapering działa, a nie zaproszenie do wysiłku.'
    );
  } else if (d.nearRaceReminder && race) {
    rules.push(
      `START "${race.name}" za ${race.daysToRace} dni (jeszcze przed oknem taperu). ` +
        'Przypomnij o nadchodzącym starcie i trzymaniu planu. NIE namawiaj do dodatkowych bodźców.'
    );
  }
  if (d.pushConsiderable) {
    rules.push(
      'Wyjątek — docisk dozwolony DELIKATNIE: TSB bardzo wysoki, forma nie rośnie, dzisiejszy dzień jest lekki bez wyraźnego powodu i nie ma startu w pobliżu. ' +
        'Możesz zasugerować odrobinę więcej bodźca — jako OPCJĘ, nie nakaz. Nie każ się niszczyć.'
    );
  } else {
    rules.push('NIE sugeruj zwiększania intensywności. Broń dzisiejszego planu i wytłumacz jego sens w kontekście wczoraj i fazy sezonu.');
  }

  const system = [
    'Jesteś trenerem kolarstwa i OBROŃCĄ planu treningowego. Mówisz do zawodnika (Adrian) na "Ty".',
    'IMIĘ: jeśli zwracasz się po imieniu, użyj DOKŁADNIE "Adrian" — NIGDY nie skracaj, nie zdrabniaj ani nie twórz wariantów (np. NIE "Adi").',
    'Plan jest domyślną prawdą. Twoja domyślna rola: wytłumaczyć PO CO jest dzisiejszy trening w kontekście wczorajszego i fazy sezonu — bronić struktury planu, nie recenzować jej.',
    'Sugestia zmiany planu to WYJĄTEK wymagający twardego uzasadnienia z danych (TSB, rampa CTL), a nie norma.',
    'ASYMETRIA (twarda reguła): korekta ku odpoczynkowi przy sygnale przemęczenia — dozwolona; korekta ku większemu wysiłkowi — prawie nigdy, a w oknie startowym NIGDY.',
    'NIGDY nie doradzaj intensywności dlatego, że zawodnik jest świeży lub "dobrze się czuje". Świeżość NIE jest powodem do docisku — bywa CELEM (tapering). Samopoczucie nie jest danymi.',
    'TSB jest BARIERĄ, nie zachętą: niski TSB / wysoka rampa = ku ostrożności i odpoczynkowi; wysoki TSB = plan zakłada tę świeżość celowo (zwłaszcza przed startem), a nie "dociśnij".',
    'Mów prostym, ciepłym językiem jak do kolegi — bez żargonu, bez skrótów, bez markdown, bez wyliczanek liczb. Maksymalnie dwa krótkie zdania. Zwróć sam tekst.',
    'REGUŁY NA DZIŚ (bezwzględne, wyprowadzone z danych):',
    ...rules.map((r) => `- ${r}`),
  ].join('\n');

  const rampWord = m.ctlRamp > 1 ? 'rośnie' : m.ctlRamp < -1 ? 'spada' : 'stoi w miejscu';
  // Opis TSB skupiony na stronie ZMĘCZENIA (bariera). Strona świeżości NIE jest licencją —
  // sygnalizujemy, że przy starcie świeżość bywa zaplanowana.
  const tsbNote =
    m.tsb < -10 ? ' (mocno zmęczony — sygnał ostrożności)' :
    m.tsb < 5 ? ' (lekko zmęczony)' :
    ' (wypoczęty — jeśli to okno startowe, ta świeżość jest zaplanowana; sama w sobie nie jest powodem do docisku)';

  const todayLine = today
    ? `DZIŚ w planie: ${today.type} — "${today.label}".`
    : 'DZIŚ: brak zaplanowanego treningu (dzień otwarty).';

  const yPlan = yesterday?.plan ? `${yesterday.plan.type} — "${yesterday.plan.label}"` : 'brak / OFF';
  const yExec = yesterday?.executed
    ? `${yesterday.executed.name ?? yesterday.executed.type ?? 'jazda'}${yesterday.executed.tss != null ? `, TSS ${round(yesterday.executed.tss)}` : ''}`
    : 'brak jazdy';
  const yesterdayLine = `WCZORAJ: plan ${yPlan}; wykonanie ${yExec}.`;

  const raceLine = race
    ? `START: "${race.name}" za ${race.daysToRace} dni (ranga ${race.priority})${race.inTaper ? ' — JESTEŚ W OKNIE TAPERU' : race.nearRace ? ' — zbliża się, przed oknem taperu' : ''}.`
    : 'START: brak nadchodzącego startu.';

  const user = [
    `Metryki na dziś (dane z ${m.date}):`,
    `- Forma (CTL) ${round(m.ctl)} (szczyt sezonu ${round(m.peakCtl)}), w 7 dni ${rampWord} (${m.ctlRamp >= 0 ? '+' : ''}${m.ctlRamp}).`,
    `- Zmęczenie (ATL) ${round(m.atl)}.`,
    `- Świeżość (TSB) ${m.tsb >= 0 ? '+' : ''}${round(m.tsb)}${tsbNote}.`,
    todayLine,
    yesterdayLine,
    raceLine,
    '',
    'Napisz maksymalnie dwa zdania: domyślnie wytłumacz po co dziś ten trening (broń planu w kontekście wczoraj i fazy). Sugeruj zmianę tylko jeśli dane twardo to uzasadniają, z asymetrią ku odpoczynkowi.',
  ].join('\n');

  return { system, user };
}
