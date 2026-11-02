// Podsumowanie Enzo po jeździe: seria po serii (moc i ocena względem planu) + jedna rada na następny raz.
// Deterministyczne (bez AI) – działa offline, od razu po treningu, także głosem Enzo (nagrane klipy).

import type { SeriesResult } from './ride-engine';

export type DebriefTip = 'even' | 'fade' | 'high' | 'low' | 'ok';

export interface Debrief {
  lines: { n: number; durationSec: number; avgPower: number; verdict: 'ok' | 'high' | 'low'; deltaW: number; endedEarly: boolean }[];
  tip: DebriefTip;
  tipText: string;
  /** Pełny tekst (głos systemowy / gdy brak nagrań). */
  text: string;
}

export const TIP_TEXT: Record<DebriefTip, string> = {
  even: 'Równo jak w zegarku. Tak trzymaj!',
  fade: 'Moc spadała z serii na serię. Następnym razem zacznij spokojniej.',
  high: 'Jechałeś mocniej niż plan. Pilnuj zakresu, to też jest trening.',
  low: 'Trochę zabrakło mocy. Zadbaj o sen i jedzenie przed treningiem.',
  ok: 'Dobra robota. Teraz odpoczynek i porządny posiłek.',
};

const VERDICT_TEXT = { ok: 'idealnie w zakresie', high: 'mocniej niż plan', low: 'poniżej planu' } as const;

/** null = brak serii (jazda swobodna / plan bez interwałów) – nie ma czego podsumowywać seria po serii. */
export function buildDebrief(series: SeriesResult[]): Debrief | null {
  if (!series.length) return null;
  const lines = series.map((x) => ({
    n: x.n, durationSec: x.durationSec, avgPower: x.avgPower,
    verdict: (x.verdict ?? 'ok') as 'ok' | 'high' | 'low', deltaW: x.deltaW ?? 0, endedEarly: x.endedEarly,
  }));
  const k = lines.length;
  const highs = lines.filter((l) => l.verdict === 'high').length;
  const lows = lines.filter((l) => l.verdict === 'low' || l.endedEarly).length;
  const first = lines[0].avgPower, last = lines[k - 1].avgPower;
  let tip: DebriefTip = 'ok';
  // spadek mocy: ≥3 serie, ostatnia ≥ 5 % słabsza od pierwszej i poniżej planu (albo przerwana)
  if (k >= 3 && last < first * 0.95 && (lines[k - 1].verdict === 'low' || lines[k - 1].endedEarly)) tip = 'fade';
  else if (highs * 2 >= k && highs > lows) tip = 'high';
  else if (lows * 2 >= k) tip = 'low';
  else if (highs === 0 && lows === 0) tip = 'even';
  const parts = lines.map((l) =>
    `Seria ${l.n}: ${l.avgPower} W – ${l.endedEarly ? 'przerwana' : VERDICT_TEXT[l.verdict]}${l.verdict !== 'ok' && l.deltaW ? ` (${l.verdict === 'high' ? '+' : '−'}${l.deltaW} W)` : ''}.`);
  return { lines, tip, tipText: TIP_TEXT[tip], text: ['Podsumujmy trening.', ...parts, TIP_TEXT[tip]].join(' ') };
}
