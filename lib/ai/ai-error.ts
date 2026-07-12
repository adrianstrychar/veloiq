// Wspólna obsługa błędów API Anthropic dla wszystkich AI-endpointów (chat, insight,
// daily-insight, generator/modyfikator planu). Wzorzec jak /streams: błąd AI NIE psuje
// karty i NIE wygląda jak "błąd połączenia z serwerem" — user dostaje czytelne zdanie,
// a prawdziwa przyczyna nie jest maskowana gołym 500.

export const AI_UNAVAILABLE_MSG = 'Trener AI chwilowo niedostępny, spróbuj za chwilę.';
export const AI_GENERIC_MSG = 'Nie udało się przygotować odpowiedzi AI — spróbuj ponownie.';

// Outage = wszystko, co znaczy "to nie wina requestu": brak kredytów (400 z komunikatem
// o billingu), auth/limit/przeciążenie/5xx, błąd połączenia (brak statusu HTTP).
export function isAiOutage(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | null;
  const status = e?.status;
  const msg = (e?.message ?? '').toLowerCase();
  if (status == null) return true; // APIConnectionError / timeout — brak odpowiedzi HTTP
  if (status === 400 && (msg.includes('credit') || msg.includes('billing'))) return true;
  return [401, 403, 408, 429, 500, 502, 503, 529].includes(status);
}

export function aiErrorMessage(err: unknown): string {
  return isAiOutage(err) ? AI_UNAVAILABLE_MSG : AI_GENERIC_MSG;
}
