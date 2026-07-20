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

export type DayStructure = OUStructure | WorkStructure;

// Typy sesji, dla których generator MUSI zwrócić structure. Z1/Z2/LONG/OFF = jednolite → null.
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
  const rests = (s.reps - 1) * s.rest_min;
  return isOU(s) ? s.reps * ouBlockMin(s) + rests : s.reps * s.work_min + rests;
}

const TYPE_NAMES: Record<string, string> = {
  OU: 'Over-Under',
  THR: 'Threshold',
  SST: 'Sweet Spot',
  VO2: 'VO2max',
};

// Label GENEROWANY z parametrów (nie przez AI) — "Over-Under 3×12min" zawsze zgadza się z profilem.
export function buildLabel(type: string, s: DayStructure): string {
  const name = TYPE_NAMES[type] ?? type;
  const minutes = isOU(s) ? ouBlockMin(s) : s.work_min;
  return `${name} ${s.reps}×${minutes}min`;
}

// Zakres/cel mocy dnia WYPROWADZONY ze structure (zamiast walidować string AI — derywujemy).
export function structureWatt(s: DayStructure): string {
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
export function parseDayStructure(raw: unknown, type: string): ParseResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'structure nie jest obiektem' };
  const o = raw as Record<string, unknown>;

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
  cooldownDefault: number
): { durMin: number; error: string | null } {
  const main = structureMainMin(s);
  const durMin = warmupDefault + main + cooldownDefault;
  if (durMin < MIN_SESSION_MIN || durMin > MAX_SESSION_MIN) {
    return {
      durMin,
      error: `struktura daje rozgrzewka ${warmupDefault} + część główna ${main} + schłodzenie ${cooldownDefault} = ${durMin} min, poza zakresem ${MIN_SESSION_MIN}–${MAX_SESSION_MIN} — sprawdź strukturę`,
    };
  }
  return { durMin, error: null };
}
