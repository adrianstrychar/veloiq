// Pierwszy człon imienia. athlete.name ze Stravy to zwykle "Imię Nazwisko" — a w zwrotach AI model
// ma używać SAMEGO imienia (nie pełnej formy, nie nazwiska). Puste / null / same spacje → null
// (wtedy prompt pomija zwrot po imieniu, zamiast zgadywać). Jedno źródło logiki dla briefu/insightu/czatu.
export function firstName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const first = name.trim().split(/\s+/)[0];
  return first.length > 0 ? first : null;
}
