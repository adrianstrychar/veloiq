// Pipeline modyfikacji planu tygodnia — WYDZIELONA z app/api/plan/modify/route.ts (PR groundwork).
// computePlanModification liczy zmodyfikowany plan BEZ zapisu (żeby write tools mogły zrobić dry-run
// i pokazać diff przed potwierdzeniem); applyPlanModification wykonuje zapis. Route i write tools
// wołają te same funkcje — ZERO równoległej logiki mutacji planu.
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isAiOutage, AI_UNAVAILABLE_MSG, AI_TOO_LONG_MSG } from '@/lib/ai/ai-error';
import { parseModelJson, MaxTokensError, MalformedJsonError } from '@/lib/ai/parse-json-response';
import { buildModifyPrompt, validateWeek, parseCommandDows, type PlanDay, type ModifyContext } from '@/lib/ai/plan-generate';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface PlanModificationResult {
  days: PlanDay[];
  insight: string; // opis STANU tygodnia po zmianie → zapisywany na karcie planu (weekly_plans.plan_json)
  change: string;  // opis SAMEJ zmiany ("skróciłem wtorek bo…") → tylko do rozmowy, NIE zapisywany
  tssTarget: number;
  skippedPastDows: number[]; // dni minione (date < today), których zmiana została odrzucona
  // fix/plan-modify-structure: uczciwość wobec zawodnika. Elementy prośby, których nie da się zapisać
  // w planie (od modelu), oraz ostrzeżenia serwera (np. wskazany dzień mimo prób się nie zmienił).
  unsupported?: string[];
  warnings?: string[];
}

export type ComputeResult =
  | { ok: true; result: PlanModificationResult }
  | { ok: false; error: string };

const MAX_ATTEMPTS = 3;
const DOW_NAMES = ['', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
// Nazwy typów jednolitych bez structure — label NIE może obiecywać treści, której nie ma w rozpisce.
const UNIFORM_LABEL: Record<string, string> = { Z1: 'Regeneracja', Z2: 'Endurance', LONG: 'Long' };

const numSet = (v: unknown) => new Set<number>(Array.isArray(v) ? v.map(Number).filter((n) => n >= 1 && n <= 7) : []);
const sameStructure = (a: PlanDay['structure'], b: PlanDay['structure']) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// Dzień "ten sam treningowo": typ, czas, TSS i rozpiska. Label celowo pominięty — sama nazwa to nie zmiana.
export const sameTraining = (a: PlanDay, b: PlanDay) =>
  a.type === b.type && a.dur_min === b.dur_min && a.tss === b.tss && sameStructure(a.structure, b.structure);

type Attempt =
  | { kind: 'ok'; result: PlanModificationResult; softIssues: string[] }
  | { kind: 'retry'; error: string; feedback: string | null }
  | { kind: 'fatal'; error: string };

// Liczy zmodyfikowany plan BEZ zapisu. Reużywa całej ścieżki /modify: prompt, walidacja,
// TWARDY ENFORCEMENT lockSet (#43), ochrona structure. NOWE: past-day guard (#44) — dni
// date < today NIE są zmieniane (przywracany oryginał), raportowane w skippedPastDows.
// fix/plan-modify-structure: retry Z INFORMACJĄ ZWROTNĄ (model widzi swój błąd zamiast losować
// od nowa), egzekwowanie structure na zmienianych dniach jakościowych, wykrywanie "zmiany samej
// nazwy" na dniach wskazanych przez zawodnika, label typów jednolitych bez structure z serwera.
export async function computePlanModification(
  currentDays: PlanDay[],
  ctx: ModifyContext,
  message: string,
  weekStart: string,
  todayISO: string
): Promise<ComputeResult> {
  const { system, user: userMsg } = buildModifyPrompt(currentDays, ctx, message);
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMsg }];

  let lastErr = '';
  let lastSoft: PlanModificationResult | null = null; // najlepszy wynik z miękkimi problemami — fallback
  let lastSoftIssues: string[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let rawText = '';
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 6000, // structure (bloki) + reguła spójności minut → model liczy w prozie przed JSON-em
        system,
        messages,
      });
      rawText = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      // stop_reason PRZED parsowaniem: ucięcie → czytelny błąd BEZ retry (modyfikacja bywa częsta/w
      // tle, retry podwajałby koszt); JSON zepsuty mimo end_turn → retry jak dotąd ('brak JSON').
      let parsed: Record<string, unknown>;
      try {
        parsed = parseModelJson<Record<string, unknown>>(response, { maxTokens: 6000 });
      } catch (perr) {
        if (perr instanceof MaxTokensError) { lastErr = AI_TOO_LONG_MSG; break; }
        if (perr instanceof MalformedJsonError) {
          lastErr = 'brak JSON';
          pushFeedback(messages, rawText, 'Odpowiedź nie była poprawnym obiektem JSON. Zwróć WYŁĄCZNIE jeden obiekt JSON.');
          continue;
        }
        throw perr;
      }

      const res = evaluateAttempt(parsed, currentDays, message, weekStart, todayISO);
      if (res.kind === 'fatal') { lastErr = res.error; break; }
      if (res.kind === 'retry') {
        lastErr = res.error;
        if (res.feedback) pushFeedback(messages, rawText, res.feedback);
        continue;
      }
      if (res.softIssues.length === 0) return { ok: true, result: res.result };
      // Miękki problem (wskazany dzień bez zmian treningowych) → jeszcze jedna próba z informacją
      // zwrotną; jeśli to ostatnia, oddajemy wynik z ostrzeżeniem zamiast udawać sukces.
      lastSoft = res.result;
      lastSoftIssues = res.softIssues;
      pushFeedback(messages, rawText, `Problem: ${res.softIssues.join(' ')} Odwzoruj prośbę w polu structure tych dni (kształt BLOKI, jeśli trzeba). Jeśli czegoś naprawdę nie da się zapisać — wpisz to do "unsupported". Zwróć pełny poprawiony JSON.`);
    } catch (err: unknown) {
      // Awaria API (kredyty/limit/sieć) → czytelne zdanie; błędy walidacji zostają surowe.
      lastErr = isAiOutage(err) ? AI_UNAVAILABLE_MSG : err instanceof Error ? err.message : String(err);
    }
  }
  if (lastSoft) {
    return { ok: true, result: { ...lastSoft, warnings: [...(lastSoft.warnings ?? []), ...lastSoftIssues] } };
  }
  return { ok: false, error: lastErr };
}

// Dokleja do rozmowy z modelem jego poprzednią odpowiedź + konkretny błąd → kolejna próba to
// POPRAWKA, nie losowanie od nowa (wcześniej retry wysyłał identyczny prompt).
function pushFeedback(messages: Anthropic.MessageParam[], rawText: string, feedback: string) {
  messages.push({ role: 'assistant', content: rawText.trim() || '(pusta odpowiedź)' });
  messages.push({ role: 'user', content: `${feedback}` });
}

// Walidacja + egzekwowanie reguł serwera na jednej odpowiedzi modelu. Czysta funkcja (bez sieci) →
// testowalna offline.
export function evaluateAttempt(
  parsed: Record<string, unknown>,
  currentDays: PlanDay[],
  message: string,
  weekStart: string,
  todayISO: string
): Attempt {
  const isPast = (date: string) => date < todayISO; // ostry '<' — dziś NIE jest przeszły (#44)

  const v = validateWeek(parsed.days, weekStart, { outline: false });
  if (!v.ok || !v.days) {
    const error = v.error ?? 'walidacja nieudana';
    return { kind: 'retry', error, feedback: `Błąd walidacji: ${error}. Popraw i zwróć pełny JSON.` };
  }

  // ── TWARDY ENFORCEMENT locka (#43) — kłódka = WYŁĄCZNIE jawna rezerwacja dnia wolnego.
  // Lock zapada TYLKO na dniu, który user jawnie zażądał jako OFF (off ∩ userSpecified ∩ command).
  // Nazwany trening ("wtorek Z2") NIE dostaje kłódki — nadużycie psujące suwak (#lock-overuse).
  const off = numSet(parsed.off);
  const unlock = numSet(parsed.unlock);
  const userSpecified = numSet(parsed.userSpecifiedDays);
  const changedByModel = numSet(parsed.changedDays);
  const commandDays = new Set<number>(parseCommandDows(message));
  const lockSet = new Set<number>(Array.from(userSpecified).filter((d) => commandDays.has(d)));
  let days: PlanDay[] = v.days.map((aiDay) => {
    const dow = aiDay.dow;
    const orig = currentDays.find((o) => o.dow === dow);
    if (off.has(dow)) {
      return { ...aiDay, type: 'OFF' as const, label: 'Odpoczynek', tss: 0, dur_min: 0, watt: '–', hr: '–', zones: [0, 0, 0, 0, 0], locked: lockSet.has(dow), structure: null };
    }
    if (unlock.has(dow)) return { ...aiDay, locked: false };
    if (orig?.locked) return { ...orig };
    return { ...aiDay, locked: false };
  });

  // ── OCHRONA STRUCTURE (nie ufamy, że AI ją przepisze) — identyczna jak w /modify ──
  // Model pominął structure na dniu, który treningowo się nie zmienił → przywróć oryginał.
  days = days.map((day) => {
    if (day.structure || day.type === 'OFF') return day;
    const orig = currentDays.find((o) => o.dow === day.dow);
    if (orig?.structure && orig.type === day.type && orig.dur_min === day.dur_min && orig.tss === day.tss) {
      return { ...day, structure: orig.structure, label: orig.label, watt: orig.watt };
    }
    return day;
  });

  // ── LABEL BEZ POKRYCIA (sedno buga "tytuł się zmienia, rozpiska nie") ──
  // Dzień jednolity (Z1/Z2/LONG) bez structure nie ma szczegółów — jego nazwa NIE może obiecywać
  // akcentów. Ten sam typ jak w oryginale → stara nazwa; inny typ → nazwa typu.
  days = days.map((day) => {
    if (day.structure || !(day.type in UNIFORM_LABEL)) return day;
    const orig = currentDays.find((o) => o.dow === day.dow);
    const label = orig && orig.type === day.type && !orig.structure ? orig.label : UNIFORM_LABEL[day.type];
    return label === day.label ? day : { ...day, label };
  });

  // ── PAST-DAY GUARD (#44) — dzień date < today NIE jest zmieniany. Przywróć oryginał;
  // jeśli AI faktycznie próbowało go zmienić (różny typ/czas/TSS) — zaraportuj w skippedPastDows.
  const skippedPastDows: number[] = [];
  days = days.map((day) => {
    if (!isPast(day.date)) return day;
    const orig = currentDays.find((o) => o.dow === day.dow);
    if (!orig) return day;
    if (!sameTraining(orig, day)) skippedPastDows.push(day.dow);
    return { ...orig };
  });

  // ── TWARDE: zmieniany dzień jakościowy MUSI mieć rozpiskę. Bez niej aplikacja pokazałaby
  // generyczny szablon zamiast tego, o co prosił zawodnik.
  const missing: string[] = [];
  for (const day of days) {
    if (!['SST', 'THR', 'OU', 'VO2'].includes(day.type) || day.structure || isPast(day.date)) continue;
    const orig = currentDays.find((o) => o.dow === day.dow);
    if (!orig || !sameTraining(orig, day) || userSpecified.has(day.dow) || changedByModel.has(day.dow)) {
      missing.push(`${DOW_NAMES[day.dow]} (${day.type})`);
    }
  }
  if (missing.length) {
    const error = `brak structure dla zmienianych dni jakościowych: ${missing.join(', ')}`;
    return { kind: 'retry', error, feedback: `Błąd: ${error}. Każdy zmieniany dzień SST/THR/OU/VO2 musi mieć pole structure z dokładną rozpiską. Zwróć pełny poprawiony JSON.` };
  }

  // ── MIĘKKIE: dzień wskazany w prośbie, który treningowo się nie zmienił (zmieniła się co najwyżej
  // nazwa). Typowy objaw opisanego buga. Wyjątki: dzień zablokowany/miniony, OFF→OFF, oraz gdy model
  // jawnie zgłosił, że część prośby jest niewyrażalna (unsupported) — wtedy mówimy to wprost.
  const unsupported = Array.isArray(parsed.unsupported)
    ? parsed.unsupported.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
    : [];
  const requested = new Set<number>([...Array.from(commandDays), ...Array.from(userSpecified)]);
  const softIssues: string[] = [];
  for (const dow of Array.from(requested)) {
    const day = days.find((d) => d.dow === dow);
    const orig = currentDays.find((o) => o.dow === dow);
    if (!day || !orig || orig.locked || isPast(day.date)) continue;
    if (orig.type === 'OFF' && day.type === 'OFF') continue;
    if (sameTraining(orig, day) && unsupported.length === 0) {
      softIssues.push(`Prośba dotyczyła dnia: ${DOW_NAMES[dow]}, ale jego trening się nie zmienił (ten sam typ, czas, TSS i structure).`);
    }
  }

  const insight = typeof parsed.insight === 'string' ? parsed.insight : 'Plan zaktualizowany.';
  // change = opis samej edycji do rozmowy; fallback do insight, gdy model go nie zwrócił.
  const change = typeof parsed.change === 'string' ? parsed.change : insight;
  const tssTarget = days.reduce((s, d) => s + d.tss, 0);
  return {
    kind: 'ok',
    result: { days, insight, change, tssTarget, skippedPastDows, ...(unsupported.length ? { unsupported } : {}) },
    softIssues,
  };
}

// Zapis do weekly_plans — plan_json + PRZELICZONY weekly_tss_target w tej samej operacji
// (standing rule: nigdy stale values).
export async function applyPlanModification(
  supabase: SupabaseClient,
  planId: string,
  result: PlanModificationResult
): Promise<void> {
  await supabase
    .from('weekly_plans')
    .update({ plan_json: { days: result.days, insight: result.insight }, weekly_tss_target: result.tssTarget })
    .eq('id', planId);
}
