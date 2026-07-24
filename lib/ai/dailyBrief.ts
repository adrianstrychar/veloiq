// Brief dnia trenera (ETAP CHAT część 3) — konwersacyjny opener czatu, NIE dyrektywa treningowa.
// 2–4 zdania z realnych danych (świeżość, dzisiejsza sesja, najbliższy start, świeży rekord),
// zakończone otwartym pytaniem. Model: Haiku (tier #104). Osobny od daily-insight (tamten broni
// planu w 2 zdaniach; brief wita i zaprasza do rozmowy). Filozofia spójna: nie namawiać do docisku.

export interface BriefInputs {
  tsb: number;
  todaySession: { type: string; label: string } | null; // null = dzień otwarty
  isRest: boolean;                                        // dziś OFF / brak sesji
  race: { name: string; days: number } | null;
  freshRecord: string | null;                            // np. "moc 20 min 314 W" jeśli padł w 7 dni
}

export function buildDailyBriefPrompt(x: BriefInputs): { system: string; user: string } {
  const system = [
    'Jesteś trenerem kolarstwa i piszesz do zawodnika (Adrian) na "Ty" — ciepło, zwięźle, jak kolega.',
    'Napisz BRIEF DNIA: 2–4 krótkie zdania, konwersacyjny opener czatu (nie wykład).',
    'Zacznij od stanu (świeżość/gotowość), wspomnij dzisiejszą sesję, dorzuć najbliższy start jeśli jest',
    'i świeży rekord jeśli padł. Zakończ JEDNYM otwartym pytaniem zapraszającym do rozmowy',
    '(np. "O czym dziś pogadamy?").',
    'Nie namawiaj do zwiększania intensywności ani "dorzucenia" — broń dzisiejszego planu; świeżość',
    'bywa celem (tapering), nie zaproszeniem do wysiłku. Bez markdown, bez wyliczanek liczb, bez żargonu.',
    'Zwróć sam tekst briefu.',
  ].join('\n');

  const tsbWord = x.tsb < -10 ? 'mocno zmęczony' : x.tsb < 5 ? 'lekko zmęczony' : 'wypoczęty';
  const todayLine = x.isRest
    ? 'Dziś: dzień wolny / regeneracja.'
    : x.todaySession
    ? `Dziś w planie: ${x.todaySession.type} — "${x.todaySession.label}".`
    : 'Dziś: brak zaplanowanej sesji (dzień otwarty).';

  const user = [
    `Świeżość (TSB): ${x.tsb >= 0 ? '+' : ''}${Math.round(x.tsb)} (${tsbWord}).`,
    todayLine,
    x.race ? `Najbliższy start: "${x.race.name}" za ${x.race.days} dni.` : 'Brak nadchodzącego startu w kalendarzu.',
    x.freshRecord ? `Świeży rekord (ostatnie 7 dni): ${x.freshRecord}.` : 'Brak świeżego rekordu w ostatnich 7 dniach.',
    '',
    'Napisz brief dnia (2–4 zdania) zakończony jednym otwartym pytaniem.',
  ].join('\n');

  return { system, user };
}
