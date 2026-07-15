// Klasyfikacja intencji wiadomości czatu → routing modelu / max_tokens / zestawu tooli / trybu
// odpowiedzi. Heurystyka (0 ms, 0 kosztu) dla jednoznacznych; Haiku fallback dla niejasnych.
// Reguła bezpieczeństwa NADRZĘDNA: sygnał zdrowotny + pytanie → nigdy FACT (min ASSESSMENT).
import type Anthropic from '@anthropic-ai/sdk';

export type Intent = 'FACT' | 'ASSESSMENT' | 'PLANNING' | 'DEEP';
const INTENTS: readonly Intent[] = ['FACT', 'ASSESSMENT', 'PLANNING', 'DEEP'];

const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';

// Model + TWARDY cap max_tokens FINALNEJ odpowiedzi per intencja (rundy tool-use mają osobny,
// komfortowy budżet — patrz route). Cap nie polega na instrukcji: model z dużym budżetem go wykorzysta.
export const INTENT_CONFIG: Record<Intent, { model: string; maxTokens: number }> = {
  FACT: { model: HAIKU, maxTokens: 200 },
  ASSESSMENT: { model: SONNET, maxTokens: 400 },
  PLANNING: { model: SONNET, maxTokens: 700 },
  DEEP: { model: SONNET, maxTokens: 1500 },
};

// Linia trybu doklejana na SAMYM KOŃCU dynamicznego system promptu (najsilniejsza pozycja).
export const INTENT_MODE_LINE: Record<Intent, string> = {
  FACT: 'Tryb odpowiedzi: FACT — odpowiedz JEDNYM zdaniem: konkretna liczba/fakt + minimalny kontekst. Bez wstępu, bez podsumowania, bez pytań zamykających.',
  ASSESSMENT: 'Tryb odpowiedzi: ASSESSMENT — maksymalnie 3 zdania.',
  PLANNING: 'Tryb odpowiedzi: PLANNING — maksymalnie 5 zdań, opcjonalnie krótka lista punktowana.',
  DEEP: 'Tryb odpowiedzi: DEEP — rozbudowana analiza dozwolona (user o nią poprosił), ale konkretnie, bez lania wody.',
};

// Tools dostępne dla FACT — odczyt liczb/faktów/istnienia. Bez write-tooli, bez ciężkich analitycznych
// (get_activity_detail/check_race_calendar/get_fitness_history/get_checkin). get_weekly_plan DODANE:
// "jaki mam plan na jutro" klasyfikuje się jako FACT, a bez tego toola model by halucynował.
export const FACT_TOOL_NAMES = new Set(['get_activities', 'get_athlete_profile', 'get_fitness_status', 'get_races', 'get_weekly_plan']);

// ── Heurystyka (priorytet: DEEP → PLANNING → FACT → ASSESSMENT; pierwsze trafienie wygrywa) ──
const RE_DEEP = /\b(rozpisz|rozbuduj|przeanalizuj|dog[łl][ęe]bn|szczeg[óo][łl]ow|krok po kroku|pe[łl]n[aą]\s+analiz|(wyja[śs]nij|wyt[łl]umacz)\s+dok[łl]adnie)/i;
const RE_PLANNING = /\b(zmie[nń]|zmodyfikuj|prze[łl][óo][żz]|przenie[śs]|dodaj|usu[nń]|odwo[łl]aj|skr[óo][ćc]|wyd[łl]u[żz]|zaproponuj|u[łl][óo][żz]|strategi|taktyk|taper|pacing|przygotuj\s+(mnie\s+)?(do|na))/i;
const RE_PLANNING_DAY = /(poniedzia[łl]|wtor|[śs]rod|czwart|pi[ąa]t|sobot|niedziel)\w*.*\b(z1|z2|off|wolne|trening|interwa[łl])/i;
const RE_FACT = /(^\s*(ile|jaki|jaka|jakie|kiedy|kt[óo]ry)\b|\b(ile km|ile tss|ile godzin|m[óo]j ftp|jaki mam ftp|jaki mam tsb|jaka mam form)\b|\bczy\s+(jecha[łl]|by[łl]|mia[łl]|robi[łl]|mam)\w*)/i;
const RE_ASSESS = /\b(jak\s+(wypad|posz|ocen|moja\s+form|jazda|trening|si[ęe])|dobrze\s+posz|[źz]le\s+posz|co\s+s[ąa]dzisz|jak\s+ci\s+si[ęe])/i;

// Sygnał zdrowotny — override bezpieczeństwa (nigdy FACT, min ASSESSMENT).
const RE_HEALTH = /(bol[iąea]|kontuzj|chor(y|a|e|ob)|przetren|[źz]le\s+si[ęe]\s+czuj|nie\s+mam\s+si[łl]y|uraz)/i;

export function hasHealthSignal(msg: string): boolean {
  return RE_HEALTH.test(msg);
}

export function classifyHeuristic(msg: string): Intent | null {
  const t = msg.toLowerCase();
  if (RE_DEEP.test(t)) return 'DEEP';
  if (RE_PLANNING.test(t) || RE_PLANNING_DAY.test(t)) return 'PLANNING';
  if (RE_FACT.test(t)) return 'FACT';
  if (RE_ASSESS.test(t)) return 'ASSESSMENT';
  return null; // niejednoznaczne → Haiku
}

export interface IntentResult {
  intent: Intent;
  source: 'heuristic' | 'haiku' | 'fallback';
}

// Override zdrowotny: nigdy FACT gdy w wiadomości jest sygnał zdrowia/bólu/kontuzji.
function applyHealthGuard(intent: Intent, msg: string): Intent {
  return hasHealthSignal(msg) && intent === 'FACT' ? 'ASSESSMENT' : intent;
}

export async function classifyIntent(
  messages: Array<{ role: string; content: string }>,
  anthropic: Anthropic,
): Promise<IntentResult> {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

  const heur = classifyHeuristic(lastUser);
  if (heur) {
    return { intent: applyHealthGuard(heur, lastUser), source: 'heuristic' };
  }

  // Fallback Haiku — ostatnia wiadomość + max 2 poprzednie tury dla kontekstu.
  try {
    const ctx = messages.slice(-3).map((m) => `${m.role}: ${m.content}`).join('\n');
    const resp = await anthropic.messages.create({
      model: HAIKU,
      max_tokens: 10,
      system:
        'Klasyfikujesz OSTATNIĄ wiadomość użytkownika (kontekst kolarski) do JEDNEGO słowa: ' +
        'FACT | ASSESSMENT | PLANNING | DEEP. FACT = prosta liczba/fakt/istnienie jazdy. ' +
        'ASSESSMENT = ocena jednej jazdy lub stanu formy. PLANNING = zmiany planu, strategia, propozycje. ' +
        'DEEP = użytkownik wprost prosi o rozbudowaną analizę/wyjaśnienie. Odpowiedz WYŁĄCZNIE jednym z tych słów.',
      messages: [{ role: 'user', content: ctx }],
    });
    const raw = resp.content[0]?.type === 'text' ? resp.content[0].text.trim().toUpperCase() : '';
    const parsed = INTENTS.find((i) => raw.includes(i));
    console.info(`[chat-intent] haiku classify raw="${raw}" → ${parsed ?? 'BRAK'} | in=${resp.usage?.input_tokens} out=${resp.usage?.output_tokens}`);
    if (parsed) return { intent: applyHealthGuard(parsed, lastUser), source: 'haiku' };
  } catch (e) {
    console.warn(`[chat-intent] haiku fallback error: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Błąd Haiku lub nierozpoznana odpowiedź → ASSESSMENT.
  return { intent: applyHealthGuard('ASSESSMENT', lastUser), source: 'fallback' };
}
