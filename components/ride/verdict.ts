// Ocena serii zrozumiała dla każdego: w zakresie / mocniej / słabiej (zamiast „% w zakresie”).
import type { SeriesResult } from '@/lib/ride/ride-engine';

export function verdictLabel(x: SeriesResult, short = false): string {
  if (!x.verdict) return short ? '–' : '';
  if (x.verdict === 'high') return short ? `↑ +${x.deltaW ?? 0} W` : `mocniej niż plan (+${x.deltaW ?? 0} W)`;
  if (x.verdict === 'low') return short ? `↓ −${x.deltaW ?? 0} W` : `poniżej planu (−${x.deltaW ?? 0} W)`;
  return short ? '✓ w zakresie' : 'idealnie w zakresie';
}

export const verdictColor = (x: SeriesResult) =>
  x.verdict === 'high' ? 'var(--over)' : x.verdict === 'low' ? 'var(--amber)' : x.verdict === 'ok' ? 'var(--ok)' : 'var(--muted)';
