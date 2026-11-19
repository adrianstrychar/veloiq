// Krótka nazwa treningu (Strava, lista jazd, ekran jazdy): rodzaj + główne serie, np.
// „Threshold 2×20 min”, „Long · 2×20 min + 4×(3 min + 20 s)”, „VO2max 5×4 min”, „Endurance”.
// Liczona z KROKÓW skryptu (te same, które prowadził Enzo) – działa też dla treningu wklejonego
// w czacie i dla starych jazd bez typu dnia.

import type { WorkoutStep } from './workout-script';

export const TYPE_NAMES: Record<string, string> = {
  Z1: 'Regeneracja', Z2: 'Endurance', LONG: 'Long', SST: 'Sweet Spot', THR: 'Threshold', OU: 'Over-Under', VO2: 'VO2max',
};

function category(pct: number, sec: number): string {
  if (pct >= 1.3 && sec < 45) return 'Sprinty';
  if (pct >= 1.06) return 'VO2max';
  if (pct >= 0.95) return 'Threshold';
  if (pct >= 0.88) return 'Sweet Spot';
  if (pct >= 0.76) return 'Tempo';
  return 'Endurance';
}

export function fmtDurShort(sec: number): string {
  if (sec < 120 && sec % 60 !== 0) return `${sec} s`;
  return `${Math.round(sec / 60)} min`;
}

interface Group { sig: string; count: number; work: number; pct: number; headSec: number }

/** Serie interwałów: interwał + interwały tuż po nim (bez przerwy) = jedna seria; identyczne serie grupowane. */
export function intervalGroups(steps: WorkoutStep[], ftp: number): Group[] {
  const series: WorkoutStep[][] = [];
  steps.forEach((st, i) => {
    if (st.type !== 'interval') return;
    const chained = i > 0 && steps[i - 1].type === 'interval' && st.start !== 'auto' && series.length > 0;
    if (chained) series[series.length - 1].push(st);
    else series.push([st]);
  });
  const groups = new Map<string, Group>();
  for (const parts of series) {
    const total = parts.reduce((a, p) => a + p.durationSec, 0);
    // długi łańcuch (over-under) opisujemy jego całkowitą długością
    const sig = parts.length === 1 ? fmtDurShort(parts[0].durationSec)
      : parts.length <= 3 ? `(${parts.map((p) => fmtDurShort(p.durationSec)).join(' + ')})` : fmtDurShort(total);
    const head = parts[0];
    const pct = ftp > 0 ? (head.powerLow + head.powerHigh) / 2 / ftp : 0;
    const g = groups.get(sig) ?? { sig, count: 0, work: 0, pct, headSec: head.durationSec };
    g.count++; g.work += total;
    groups.set(sig, g);
  }
  return Array.from(groups.values()).sort((a, b) => b.work - a.work);
}

/** Krótka nazwa treningu. type = typ dnia z planu (THR, SST…), gdy znany. */
export function shortWorkoutName(steps: WorkoutStep[], ftp: number, type?: string | null): string {
  if (!steps.length) return 'Jazda swobodna';
  const groups = intervalGroups(steps, ftp).slice(0, 2);
  const total = steps.reduce((a, s) => a + s.durationSec, 0);
  const typeName = type ? TYPE_NAMES[type] : undefined;
  if (!groups.length) return typeName ?? (total >= 3 * 3600 ? 'Long' : 'Endurance');
  const part = (g: Group) => `${g.count > 1 ? `${g.count}×` : ''}${g.sig.replace(/^\((.*)\)$/, g.count > 1 ? '($1)' : '$1')}`;
  const main = groups[0];
  const cat = typeName ?? category(main.pct, main.headSec);
  // Long / Endurance z akcentami: „Long · 2×20 min + …”; trening interwałowy: „Threshold 2×20 min”
  const sep = typeName && (type === 'LONG' || type === 'Z2' || type === 'Z1') ? ' · ' : ' ';
  let name = `${cat}${sep}${groups.map(part).join(' + ')}`;
  if (name.length > 48) name = `${cat}${sep}${part(main)}`;
  return name;
}
