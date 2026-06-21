// Krótki insight o BIEŻĄCEJ formie (nie o pojedynczej jeździe) — wzorzec jak lib/ai/insight.ts.
// Liczony z ostatniego wiersza PMC + ostatniej jazdy. Zwraca prompt PL.

export interface DailyInsightMetrics {
  date: string;
  ctl: number;
  atl: number;
  tsb: number;
  peakCtl: number;
  ctlRamp: number; // zmiana CTL w 7 dni
}

export interface DailyInsightActivity {
  name: string | null;
  activity_date: string;
  type: string | null;
  distance_km: number | null;
  tss: number | null;
}

export function buildDailyInsightPrompt(
  m: DailyInsightMetrics,
  lastActivity: DailyInsightActivity | null
): { system: string; user: string } {
  const system = [
    'Jesteś trenerem kolarstwa rozmawiającym z zawodnikiem (Adrian) na "Ty".',
    'Zadanie: JEDNO krótkie zdanie (maksymalnie dwa) o jego DZISIEJSZEJ formie na podstawie metryk PMC.',
    'Mów prostym językiem, jak do kolegi — bez żargonu, bez skrótów, bez markdown, bez liczb-wyliczanek.',
    'Powiedz jak się dziś czuje i co z tym zrobić (mocniej / spokojnie / odpoczynek). Zwięźle, ciepło.',
    'Zwróć sam tekst — maksymalnie dwa zdania.',
  ].join(' ');

  const fresh = m.tsb >= 5 ? 'świeży' : m.tsb >= -10 ? 'lekko zmęczony' : 'mocno zmęczony';
  const rampWord = m.ctlRamp > 1 ? 'rośnie' : m.ctlRamp < -1 ? 'spada' : 'stoi w miejscu';

  const actLine = lastActivity
    ? `Ostatnia jazda: ${lastActivity.name ?? lastActivity.type ?? 'jazda'} (${lastActivity.activity_date}), ${lastActivity.distance_km ?? '—'} km, TSS ${lastActivity.tss != null ? Math.round(lastActivity.tss) : '—'}.`
    : 'Brak danych o ostatniej jeździe.';

  const user = [
    `Metryki na dziś (dane z ${m.date}):`,
    `- Forma (CTL): ${Math.round(m.ctl)} (szczyt sezonu ${Math.round(m.peakCtl)}), w 7 dni ${rampWord} (${m.ctlRamp >= 0 ? '+' : ''}${m.ctlRamp}).`,
    `- Zmęczenie (ATL): ${Math.round(m.atl)}.`,
    `- Świeżość (TSB): ${m.tsb >= 0 ? '+' : ''}${Math.round(m.tsb)} — czyli ${fresh}.`,
    actLine,
    '',
    'Napisz maksymalnie dwa krótkie zdania o jego dzisiejszej formie i co z nią zrobić.',
  ].join('\n');

  return { system, user };
}
