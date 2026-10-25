// Kontrakt substruktury sesji (feat/session-detail) — JEDNO ŹRÓDŁO PRAWDY.
// AI zwraca PARAMETRY (nie segmenty, nie label); kod buduje z nich label, waty dnia,
// rozpiskę tekstową i profil. Rozjazd label↔profil↔insight niemożliwy z konstrukcji.
// Moduł celowo bez importów — współdzielony przez generator (server), render (client) i insight.

// OU: reps bloków, każdy = cycles × (under_min @ under_w + over_min @ over_w),
// między blokami rest_min minut Z1. Np. 3 bloki × 3 cykle (3min@285W + 1min@330W), przerwa 5 min.
export interface OUStructure {
  reps: number;
  cycles: number;
  under_min: number;
  under_w: number;
  over_min: number;
  over_w: number;
  rest_min: number;
}

// SST / THR / VO2: reps interwałów po work_min minut @ work_w watów, przerwy rest_min minut Z1.
export interface WorkStructure {
  reps: number;
  work_min: number;
  work_w: number;
  rest_min: number;
}

// BLOKI (fix/plan-modify-structure): ogólny kształt dla wszystkiego, czego nie da się wyrazić jako
// "N równych interwałów" — piramidy, 40/20, sprinty w Z2, tempo w długiej, mieszane serie, kadencja.
// Opisuje CZĘŚĆ GŁÓWNĄ (rozgrzewka/schłodzenie dalej z sessionStructure, żeby suwak godzin działał
// bez zmian). Blok = `repeat` × sekwencja kroków; przerwy to zwykłe kroki o niskiej mocy.
// Czas w SEKUNDACH (sprint 15 s jest niewyrażalny w minutach). Dozwolony dla KAŻDEGO typu poza OFF.
export interface BlockStep {
  sec: number;              // czas kroku w sekundach
  w: number;                // moc docelowa (waty absolutne)
  name?: string;            // krótka nazwa kroku, np. "Sprint", "Tempo", "Przerwa"
  cad?: [number, number];   // opcjonalny zakres kadencji (rpm)
}
export interface StructureBlock {
  repeat: number;
  steps: BlockStep[];
  name?: string;            // krótka nazwa bloku, np. "Sprinty", "Piramida"
}
export interface BlocksStructure {
  blocks: StructureBlock[];
}

export type DayStructure = OUStructure | WorkStructure | BlocksStructure;

export function isBlocks(s: DayStructure): s is BlocksStructure {
  return 'blocks' in s;
}
export function isWork(s: DayStructure): s is WorkStructure {
  return 'work_min' in s;
}

// Typy sesji, dla których generator MUSI zwrócić structure. Z1/Z2/LONG/OFF = jednolite → null
// (Z1/Z2/LONG MOGĄ mieć structure w kształcie BLOKÓW — np. Z2 ze sprintami, LONG z tempem).
export const STRUCTURED_TYPES = ['SST', 'THR', 'OU', 'VO2'] as const;
export function isStructuredType(type: string): boolean {
  return (STRUCTURED_TYPES as readonly string[]).includes(type);
}

export function isOU(s: DayStructure): s is OUStructure {
  return 'cycles' in s;
}

// Długość jednego bloku OU w minutach — Z DEFINICJI cycles × (under + over).
// AI nie podaje długości bloku wprost, więc "blok 10 min przy cyklu 4 min" jest niewyrażalny.
export function ouBlockMin(s: OUStructure): number {
  return s.cycles * (s.under_min + s.over_min);
}

// Minuty części głównej: bloki/interwały + przerwy między nimi (bez rozgrzewki/schłodzenia).
export function structureMainMin(s: DayStructure): number {
  if (isBlocks(s)) return Math.round(blocksMainSec(s) / 60);
  const rests = (s.reps - 1) * s.rest_min;
  return isOU(s) ? s.reps * ouBlockMin(s) + rests : s.reps * s.work_min + rests;
}

// ── Bloki: pomocnicze ─────────────────────────────────────────────────────────

export function blockSec(b: StructureBlock): number {
  return b.repeat * b.steps.reduce((a, st) => a + st.sec, 0);
}
export function blocksMainSec(s: BlocksStructure): number {
  return s.blocks.reduce((a, b) => a + blockSec(b), 0);
}

// "15s", "4min", "4m30s", "1h20min" — zwięzły zapis czasu kroku.
export function fmtSec(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const r = sec % 60;
  if (h > 0) return `${h}h${m ? `${m}min` : ''}`;
  return r ? `${m}m${r}s` : `${m}min`;
}

// Najmocniejszy krok struktury (waty) — rdzeń bodźca.
export function blocksMaxW(s: BlocksStructure): number {
  return Math.max(...s.blocks.flatMap((b) => b.steps.map((st) => st.w)));
}

// Kroki "robocze" bloków: moc >= 80% najmocniejszego kroku (przerwy i wypełniacze odpadają).
// Używane przez execution ring i opisy — ta sama definicja wszędzie.
export function blocksWorkSteps(s: BlocksStructure): Array<{ step: BlockStep; repeat: number }> {
  const max = blocksMaxW(s);
  return s.blocks.flatMap((b) => b.steps.filter((st) => st.w >= max * 0.8).map((step) => ({ step, repeat: b.repeat })));
}

function stepTxt(st: BlockStep): string {
  const cad = st.cad ? ` ${st.cad[0]}–${st.cad[1]}rpm` : '';
  return `${fmtSec(st.sec)}@${st.w}W${cad}`;
}

export function describeBlock(b: StructureBlock): string {
  const inner = b.steps.map(stepTxt).join(' + ');
  const name = b.name ? `${b.name}: ` : '';
  if (b.repeat === 1) return `${name}${inner}`;
  return b.steps.length === 1 ? `${name}${b.repeat}×${inner}` : `${name}${b.repeat}×(${inner})`;
}

// Pełny, jednoznaczny opis struktury tekstem — diff w czacie, insight, prompt. Jedna funkcja,
// żeby zawodnik w diffie widział DOKŁADNIE to, co potem pojedzie.
export function describeStructure(s: DayStructure): string {
  if (isBlocks(s)) return s.blocks.map(describeBlock).join(' → ');
  if (isOU(s)) {
    return `${s.reps}× blok [${s.cycles}×(${s.under_min}min@${s.under_w}W + ${s.over_min}min@${s.over_w}W)], przerwy ${s.rest_min}min`;
  }
  return `${s.reps}×${s.work_min}min@${s.work_w}W, przerwy ${s.rest_min}min`;
}

const TYPE_NAMES: Record<string, string> = {
  OU: 'Over-Under',
  THR: 'Threshold',
  SST: 'Sweet Spot',
  VO2: 'VO2max',
};

// Label GENEROWANY z parametrów (nie przez AI) — "Over-Under 3×12min" zawsze zgadza się z profilem.
// Nazwy dla typów jednolitych, gdy niosą bloki (Z2 ze sprintami itp.).
const UNIFORM_NAMES: Record<string, string> = { Z1: 'Regeneracja', Z2: 'Endurance', LONG: 'Long' };

// Krótki opis bloku do labela: nazwany → nazwa; powtarzany → "N×czas pierwszego kroku";
// pojedynczy nienazwany krok (wypełniacz, np. 60 min Z2) → pomijany.
function blockLabelPart(b: StructureBlock): string | null {
  if (b.name) return b.repeat > 1 ? `${b.repeat}×${b.name}` : b.name;
  if (b.repeat > 1) return `${b.repeat}×${fmtSec(b.steps[0].sec)}`;
  if (b.steps.length > 1) return b.steps.map((st) => fmtSec(st.sec)).join('/');
  return null;
}

export function buildLabel(type: string, s: DayStructure): string {
  if (isBlocks(s)) {
    const uniform = UNIFORM_NAMES[type];
    const name = TYPE_NAMES[type] ?? uniform ?? type;
    // wypełniacz w typie jednolitym nie jest treścią; w typie jakościowym pierwszy blok jest bodźcem
    const parts = s.blocks.map(blockLabelPart).filter((x): x is string => !!x);
    if (parts.length === 0) {
      // np. THR jako jeden ciągły blok 40 min → "Threshold 40min"
      return uniform ? name : `${name} ${fmtSec(blocksMainSec(s))}`;
    }
    const shown = parts.length > 2 ? `${parts.slice(0, 2).join(' + ')} +…` : parts.join(' + ');
    return uniform ? `${name} + ${shown}` : `${name} ${shown}`;
  }
  const name = TYPE_NAMES[type] ?? type;
  const minutes = isOU(s) ? ouBlockMin(s) : s.work_min;
  return `${name} ${s.reps}×${minutes}min`;
}

// Zakres/cel mocy dnia WYPROWADZONY ze structure (zamiast walidować string AI — derywujemy).
export function structureWatt(s: DayStructure): string {
  if (isBlocks(s)) {
    const ws = blocksWorkSteps(s).map((x) => x.step.w);
    const lo = Math.min(...ws), hi = Math.max(...ws);
    return lo === hi ? `${hi}W` : `${lo}–${hi}W`;
  }
  return isOU(s) ? `${s.under_w}–${s.over_w}W` : `${s.work_w}W`;
}

// ── Walidacja surowego obiektu z AI ───────────────────────────────────────────

type ParseResult = { ok: true; structure: DayStructure } | { ok: false; error: string };

function posInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Parsuje i waliduje structure per typ: wymagane pola, dodatnie liczby całkowite,
// OU dodatkowo over_w > under_w. Kształt zły → błąd (generator dostaje retry).
// Limity bloków — łapią śmieci od modelu, nie ograniczają sensownych sesji.
const BLK = { maxBlocks: 20, maxRepeat: 60, maxSteps: 12, minSec: 5, maxSec: 6 * 3600, minW: 30, maxW: 2500, maxName: 30 };

function parseBlocks(o: Record<string, unknown>): ParseResult {
  const raw = o.blocks;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'blocks musi być niepustą tablicą' };
  if (raw.length > BLK.maxBlocks) return { ok: false, error: `za dużo bloków (${raw.length} > ${BLK.maxBlocks})` };
  const blocks: StructureBlock[] = [];
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i] as Record<string, unknown> | null;
    if (typeof b !== 'object' || b === null) return { ok: false, error: `blok ${i + 1} nie jest obiektem` };
    const repeat = b.repeat == null ? 1 : posInt(b.repeat);
    if (repeat === null || repeat > BLK.maxRepeat) return { ok: false, error: `blok ${i + 1}: repeat musi być liczbą 1–${BLK.maxRepeat}` };
    if (!Array.isArray(b.steps) || b.steps.length === 0 || b.steps.length > BLK.maxSteps) {
      return { ok: false, error: `blok ${i + 1}: steps musi mieć 1–${BLK.maxSteps} kroków` };
    }
    const steps: BlockStep[] = [];
    for (let j = 0; j < b.steps.length; j++) {
      const st = b.steps[j] as Record<string, unknown> | null;
      if (typeof st !== 'object' || st === null) return { ok: false, error: `blok ${i + 1}, krok ${j + 1}: nie jest obiektem` };
      const sec = posInt(st.sec);
      const w = posInt(st.w);
      if (sec === null || sec < BLK.minSec || sec > BLK.maxSec) return { ok: false, error: `blok ${i + 1}, krok ${j + 1}: sec musi być liczbą całkowitą ${BLK.minSec}–${BLK.maxSec} (jest: ${JSON.stringify(st.sec)})` };
      if (w === null || w < BLK.minW || w > BLK.maxW) return { ok: false, error: `blok ${i + 1}, krok ${j + 1}: w musi być liczbą całkowitą ${BLK.minW}–${BLK.maxW} watów (jest: ${JSON.stringify(st.w)})` };
      const step: BlockStep = { sec, w };
      if (typeof st.name === 'string' && st.name.trim()) step.name = st.name.trim().slice(0, BLK.maxName);
      if (Array.isArray(st.cad) && st.cad.length === 2) {
        const lo = posInt(st.cad[0]), hi = posInt(st.cad[1]);
        if (lo !== null && hi !== null && lo >= 30 && hi <= 160 && lo <= hi) step.cad = [lo, hi];
      }
      steps.push(step);
    }
    const block: StructureBlock = { repeat, steps };
    if (typeof b.name === 'string' && b.name.trim()) block.name = b.name.trim().slice(0, BLK.maxName);
    blocks.push(block);
  }
  return { ok: true, structure: { blocks } };
}

export function parseDayStructure(raw: unknown, type: string): ParseResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'structure nie jest obiektem' };
  const o = raw as Record<string, unknown>;

  // Bloki — dla każdego typu z jazdą (OFF/RACE nie niosą struktury).
  if ('blocks' in o) {
    if (type === 'OFF' || type === 'RACE') return { ok: false, error: `typ ${type} nie przyjmuje structure` };
    return parseBlocks(o);
  }

  if (type === 'OU') {
    const fields = ['reps', 'cycles', 'under_min', 'under_w', 'over_min', 'over_w', 'rest_min'] as const;
    const vals: Record<string, number> = {};
    for (const f of fields) {
      const n = posInt(o[f]);
      if (n === null) return { ok: false, error: `pole "${f}" musi być dodatnią liczbą całkowitą (jest: ${JSON.stringify(o[f])})` };
      vals[f] = n;
    }
    if (vals.over_w <= vals.under_w) {
      return { ok: false, error: `over_w (${vals.over_w}W) musi być większe niż under_w (${vals.under_w}W)` };
    }
    return { ok: true, structure: vals as unknown as OUStructure };
  }

  if (type === 'SST' || type === 'THR' || type === 'VO2') {
    const fields = ['reps', 'work_min', 'work_w', 'rest_min'] as const;
    const vals: Record<string, number> = {};
    for (const f of fields) {
      const n = posInt(o[f]);
      if (n === null) return { ok: false, error: `pole "${f}" musi być dodatnią liczbą całkowitą (jest: ${JSON.stringify(o[f])})` };
      vals[f] = n;
    }
    return { ok: true, structure: vals as unknown as WorkStructure };
  }

  return { ok: false, error: `typ ${type} nie przyjmuje structure` };
}

// Sensowny zakres długości sesji strukturalnej. MIN = próg z promptu (sesja <45 min bez sensu
// treningowego), teraz realnie egzekwowany. MAX = rozsądny sufit pojedynczej sesji interwałowej.
export const MIN_SESSION_MIN = 45;
export const MAX_SESSION_MIN = 240;
// Długa jazda z blokami (np. 4h z 3×20 tempo) legalnie przekracza sufit sesji interwałowej.
export const MAX_LONG_SESSION_MIN = 480;
export function maxSessionMin(type: string): number {
  return type === 'LONG' ? MAX_LONG_SESSION_MIN : MAX_SESSION_MIN;
}

// RECONCILE: dur_min JEST sumą segmentów (rozgrzewka + część główna + schłodzenie), nie osobną
// daną — model bywa niespójny w arytmetyce, więc generator liczy dur_min ze structure zamiast mu
// ufać. Zwrócony durMin nadpisuje wartość modelu. STRAŻNIK (zamiast starej walidacji spójności):
// jeśli zrekonstruowany czas jest absurdalny (poza [MIN,MAX]), to struktura jest bez sensu
// (reps/work poza skalą) — odrzuć z ROZBICIEM, żeby od razu było widać, że winna jest struktura,
// nie źle podany czas. Świadomie BEZ sufitów per-pole: łapiemy skutek (czas), nie zgadujemy granic
// każdego pola (długie VO2 / nietypowy blok mogą je legalnie przekroczyć).
export function reconcileStructureDuration(
  s: DayStructure,
  warmupDefault: number,
  cooldownDefault: number,
  maxMin: number = MAX_SESSION_MIN
): { durMin: number; error: string | null } {
  const main = structureMainMin(s);
  const durMin = warmupDefault + main + cooldownDefault;
  if (durMin < MIN_SESSION_MIN || durMin > maxMin) {
    return {
      durMin,
      error: `struktura daje rozgrzewka ${warmupDefault} + część główna ${main} + schłodzenie ${cooldownDefault} = ${durMin} min, poza zakresem ${MIN_SESSION_MIN}–${maxMin} — sprawdź strukturę`,
    };
  }
  return { durMin, error: null };
}
