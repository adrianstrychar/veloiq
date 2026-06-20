// Klasyfikacja i grupowanie lapów w strukturę sesji (ETAP 6c)

// ─── PROGI KLASYFIKACJI — do strojenia ────────────────────────────────────────
// Grupowanie idzie po DŁUGOŚCI lapu; intensywność rozróżnia interwał od recovery.
// Zmieniaj tutaj, nie w logice poniżej.
export const LAPS_CONFIG = {
  // Lap krótszy niż tyle sekund = "krótki" (kandydat na interwał). Dłuższe lapy to
  // osobne segmenty ciągłe: rozgrzewka, długi próg, przerwa, powrót.
  SHORT_LAP_SEC: 360, // 6 min
  // Krótki lap poniżej tego ułamka FTP = recovery (przerwa między interwałami).
  RECOVERY_FTP: 0.55, // 55% FTP
  // Blok interwałowy musi zawierać ≥1 lap o mocy ≥ tego ułamka FTP — inaczej dwa
  // łatwe krótkie lapy tworzyłyby fałszywy blok.
  HARD_FTP: 0.85, // 85% FTP
} as const;

export interface LapInput {
  name?: string;
  lap_index?: number;
  distance?: number;            // metry
  moving_time?: number;         // sekundy
  elapsed_time?: number;        // sekundy
  average_watts?: number;
  average_heartrate?: number;
  total_elevation_gain?: number;
}

export type LapClass = 'interval' | 'recovery' | 'steady';

export interface ClassifiedLap {
  lap: LapInput;
  n: number;                    // numer do wyświetlenia
  cls: LapClass;
  durationSec: number;
  watts: number | null;
  hr: number | null;
  km: number | null;
  pctFtp: number | null;
}

export interface BlockSummary {
  count: number;                // liczba interwałów (lapy typu 'interval')
  avgWatts: number | null;
  minWatts: number | null;
  maxWatts: number | null;
  totalTimeSec: number;
  label: string;                // np. "8× ~4min · 259–376W"
}

export type SessionElement =
  | { type: 'single'; lap: ClassifiedLap }
  | { type: 'block'; laps: ClassifiedLap[]; summary: BlockSummary };

function lapDuration(lap: LapInput): number {
  return lap.moving_time ?? lap.elapsed_time ?? 0;
}

export function classifyLap(lap: LapInput, ftp: number | null): LapClass {
  const dur = lapDuration(lap);
  const w = lap.average_watts ?? null;

  // Bez mocy albo bez FTP nie da się ocenić intensywności → steady (płaska karta)
  if (w == null || !ftp) return 'steady';

  // Długi lap = segment ciągły (rozgrzewka/próg/cooldown), nie interwał
  if (dur >= LAPS_CONFIG.SHORT_LAP_SEC) return 'steady';

  // Krótki lap: recovery jeśli słaby, w przeciwnym razie interwał roboczy
  return w < LAPS_CONFIG.RECOVERY_FTP * ftp ? 'recovery' : 'interval';
}

function toClassified(lap: LapInput, i: number, ftp: number | null): ClassifiedLap {
  const dur = lapDuration(lap);
  const w = lap.average_watts != null ? Math.round(lap.average_watts) : null;
  return {
    lap,
    n: lap.lap_index ?? i + 1,
    cls: classifyLap(lap, ftp),
    durationSec: dur,
    watts: w,
    hr: lap.average_heartrate != null ? Math.round(lap.average_heartrate) : null,
    km: lap.distance != null ? lap.distance / 1000 : null,
    pctFtp: w != null && ftp ? Math.round((w / ftp) * 100) : null,
  };
}

function summarizeBlock(run: ClassifiedLap[]): BlockSummary {
  const intervals = run.filter((r) => r.cls === 'interval');
  const watts = intervals.map((r) => r.watts).filter((w): w is number => w != null);
  const avgWatts = watts.length ? Math.round(watts.reduce((a, b) => a + b, 0) / watts.length) : null;
  const minWatts = watts.length ? Math.min(...watts) : null;
  const maxWatts = watts.length ? Math.max(...watts) : null;
  const totalTimeSec = run.reduce((a, r) => a + r.durationSec, 0);

  // Czy interwały mają zbliżony czas? (do etykiety "~Xmin")
  const durs = intervals.map((r) => r.durationSec);
  const minDur = durs.length ? Math.min(...durs) : 0;
  const maxDur = durs.length ? Math.max(...durs) : 0;
  const tight = minDur > 0 && maxDur / minDur <= 1.3;

  const count = intervals.length;
  const durLabel = tight
    ? `~${Math.round(((minDur + maxDur) / 2) / 60)}min`
    : `${Math.round(minDur / 60)}–${Math.round(maxDur / 60)}min`;
  const wattLabel = minWatts != null && maxWatts != null
    ? (minWatts === maxWatts ? `${minWatts}W` : `${minWatts}–${maxWatts}W`)
    : '';

  const label = `${count}× ${durLabel}${wattLabel ? ` · ${wattLabel}` : ''}`;

  return { count, avgWatts, minWatts, maxWatts, totalTimeSec, label };
}

// Grupuje sąsiadujące lapy interval/recovery w bloki interwałowe.
// Lapy steady (rozgrzewka, tempo, długi próg, powrót) zostają jako pojedyncze karty.
export function buildSessionStructure(laps: LapInput[], ftp: number | null): SessionElement[] {
  const classified = laps.map((lap, i) => toClassified(lap, i, ftp));
  const elements: SessionElement[] = [];

  let i = 0;
  while (i < classified.length) {
    if (classified[i].cls === 'steady') {
      elements.push({ type: 'single', lap: classified[i] });
      i++;
      continue;
    }

    // Ciąg sąsiadujących interval/recovery
    let j = i;
    while (j < classified.length && classified[j].cls !== 'steady') j++;
    const run = classified.slice(i, j);
    // Blok ma sens tylko gdy ≥2 lapy i zawiera choć jeden NAPRAWDĘ mocny lap
    // (≥85% FTP) — inaczej dwa łatwe krótkie lapy tworzyłyby fałszywy blok.
    const hasHard = run.some((r) => r.pctFtp != null && r.pctFtp >= LAPS_CONFIG.HARD_FTP * 100);

    if (run.length >= 2 && hasHard) {
      elements.push({ type: 'block', laps: run, summary: summarizeBlock(run) });
    } else {
      for (const r of run) elements.push({ type: 'single', lap: r });
    }
    i = j;
  }

  return elements;
}
