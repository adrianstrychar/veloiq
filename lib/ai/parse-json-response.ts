// Wspólne, świadome parsowanie odpowiedzi modelu, które ZWRACA JSON (strategy / plan-generate /
// plan-modify). Sedno: sprawdź `stop_reason` PRZED `JSON.parse`. Ucięcie na limicie tokenów to NIE
// jest "zepsuty JSON" — to osobny, oczekiwany przypadek. Bez tego goły SyntaxError uciekał do 502
// (#Dług defensywny). Teraz: dwa TYPOWANE błędy, które wołający rozróżnia i obsługuje świadomie
// (strategy → auto-retry z wyższym limitem; generate/modify → czytelny błąd).

// Strukturalny minimalny kształt odpowiedzi Anthropic — celowo luźny, żeby mockować w testach
// zwykłym obiektem (bez importu typów SDK).
export interface ModelResponseLike {
  stop_reason?: string | null;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
}

// Odpowiedź ucięta na limicie tokenów (stop_reason === 'max_tokens'). Niesie zużycie tokenów do logu.
export class MaxTokensError extends Error {
  readonly outputTokens: number | null;
  readonly maxTokens: number | null;
  constructor(outputTokens: number | null, maxTokens: number | null = null) {
    super(`odpowiedź modelu ucięta na limicie tokenów (output=${outputTokens ?? '?'}, max=${maxTokens ?? '?'})`);
    this.name = 'MaxTokensError';
    this.outputTokens = outputTokens;
    this.maxTokens = maxTokens;
  }
}

// JSON zepsuty MIMO normalnego zakończenia (stop_reason !== 'max_tokens'). Odrębny przypadek od
// ucięcia — model naprawdę zwrócił śmieć/nie-JSON, nie zabrakło mu miejsca. Nie mylić z MaxTokensError.
export class MalformedJsonError extends Error {
  readonly snippet: string;
  constructor(snippet: string, cause?: unknown) {
    super(`odpowiedź modelu nie zawiera poprawnego JSON (${cause instanceof Error ? cause.message : 'brak obiektu {…}'})`);
    this.name = 'MalformedJsonError';
    this.snippet = snippet.slice(0, 200);
  }
}

function textOf(resp: ModelResponseLike): string {
  const b = resp.content?.[0];
  return b && b.type === 'text' && typeof b.text === 'string' ? b.text : '';
}

// Rzuca MaxTokensError, jeśli odpowiedź ucięta. Cheap, komponowalny — endpoint z własnym parserem
// (np. plan-generate z brace-aware ekstrakcją) woła to PRZED swoją walidacją.
export function assertNotTruncated(resp: ModelResponseLike, maxTokens: number | null = null): void {
  if (resp.stop_reason === 'max_tokens') {
    throw new MaxTokensError(resp.usage?.output_tokens ?? null, maxTokens);
  }
}

// Domyślna ekstrakcja: pierwszy '{' … ostatni '}' (jak dotąd w strategy/plan-modify). Model potrafi
// opakować JSON w prozę mimo instrukcji — wycinamy obiekt. null = brak nawiasów.
function defaultExtract(text: string): string | null {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  return text.slice(a, b + 1);
}

// Pełny bezpieczny parser: (1) guard ucięcia → MaxTokensError; (2) ekstrakcja; (3) JSON.parse →
// MalformedJsonError zamiast gołego SyntaxError. `extract` pozwala wstrzyknąć niestandardowy wycinacz.
export function parseModelJson<T = unknown>(
  resp: ModelResponseLike,
  opts: { maxTokens?: number | null; extract?: (text: string) => string | null } = {}
): T {
  assertNotTruncated(resp, opts.maxTokens ?? null);
  const text = textOf(resp);
  const slice = (opts.extract ?? defaultExtract)(text);
  if (slice == null) throw new MalformedJsonError(text);
  try {
    return JSON.parse(slice) as T;
  } catch (err) {
    throw new MalformedJsonError(slice, err);
  }
}

// Retry SELEKTYWNY z HARDCAPEM (tylko strategy): odpal `run(base)`; przy ucięciu odpal RAZ z limitem
// podbitym o `bumpFactor` (+50%), ale NIE powyżej `capMaxTokens` (bezpieczny sufit modelu). Reguły:
//  • retry TYLKO gdy jest headroom (`bumped > base`) — jeśli base już na/nad capem, ucięcie → od razu
//    błąd, ZERO retry (bez sensu ponawiać na tym samym limicie);
//  • dokładnie JEDNA druga próba — jej ucięcie propaguje do wołającego (→ czytelny błąd), bez 3. calla;
//  • błąd inny niż ucięcie (MalformedJsonError, awaria API) NIE jest ponawiany.
// `run(maxTokens, attempt)` dostaje limit do użycia i numer próby (0/1). `onRetry` do logu produkcyjnego.
export async function withMaxTokensRetry<T>(
  opts: { baseMaxTokens: number; capMaxTokens: number; bumpFactor?: number },
  run: (maxTokens: number, attempt: number) => Promise<T>,
  onRetry?: (err: MaxTokensError, nextMaxTokens: number) => void
): Promise<T> {
  const { baseMaxTokens, capMaxTokens, bumpFactor = 1.5 } = opts;
  const bumped = Math.min(Math.round(baseMaxTokens * bumpFactor), capMaxTokens);
  try {
    return await run(baseMaxTokens, 0);
  } catch (err) {
    if (err instanceof MaxTokensError && bumped > baseMaxTokens) {
      onRetry?.(err, bumped);
      return await run(bumped, 1); // druga i OSTATNIA próba; jej MaxTokensError leci wyżej (brak 3. calla)
    }
    throw err; // brak headroomu (już na capie) lub błąd nie-ucięcia → propaguj, bez retry
  }
}
