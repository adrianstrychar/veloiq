// Pierścień realizacji celu dnia — czyste funkcje (bez React, testowalne live).
// Cel zależy od typu dnia; 100% ZAWSZE osiągalne za idealne wykonanie (twardy wymóg produktu).
// Okno mocy liczone po ELAPSED (streams indeksują i×dt = elapsed) — nigdy moving_time.
import { hasWatts, zoneDistribution } from '@/lib/streams-view';
import { sessionStructure } from '@/lib/workout';
import { isStructuredType, isOU } from '@/lib/structure';
import type { StreamsJson } from '@/lib/strava/streams';
import type { PlannedWorkout } from '@/lib/ai/insight';

const WINDOW_BAND = 0.10; // ±10% wokół celu (skalibrowane na realnej jeździe: 94% dla dowiezionej sesji)

export type RingReason = 'ebike' | 'no_power' | 'no_ftp' | 'no_structure' | 'bad_target';

// Unia dyskryminowana: available:true gwarantuje pct/doneMin/targetMin (bez `!` w UI).
export type ExecutionRing =
  | { available: false; reason?: RingReason }
  | { available: true; pct: number; doneMin: number; targetMin: number };

// Sekundy próbek w oknie mocy [centerW×(1−band), centerW×(1+band)] — PO CAŁEJ jeździe (elapsed).
// Bez segmentacji lapów: streams są elapsed-indexed z konstrukcji, więc moving_time nie ma jak wejść.
export function timeInPowerWindowSec(streams: StreamsJson, centerW: number, band = WINDOW_BAND): number {
  const lo = centerW * (1 - band);
  const hi = centerW * (1 + band);
  let cnt = 0;
  for (const w of streams.series.watts) {
    if (w != null && w >= lo && w <= hi) cnt++;
  }
  return cnt * streams.dt;
}

// Sekundy w strefach o indeksach `zoneIdxs` (0=Z1 … 5=Z6). Z zoneDistribution (30 s wygładzone,
// spójne z PowerZoneBar). "Z2 lub wyżej" = indeksy 1..5; "tylko Z1" = [0].
function timeInZonesSec(streams: StreamsJson, ftp: number, zoneIdxs: number[]): number {
  const dist = zoneDistribution(streams, ftp);
  const cnt = zoneIdxs.reduce((a, i) => a + dist[i], 0);
  return cnt * streams.dt;
}

const ratio = (doneSec: number, targetMin: number): ExecutionRing => {
  const doneMin = doneSec / 60;
  const pct = Math.min(100, Math.round((doneMin / targetMin) * 100));
  return { available: true, pct, doneMin: Math.round(doneMin), targetMin: Math.round(targetMin) };
};

// Główna: cel + wykonanie wg typu dnia. Zwraca available:false (ring ukryty) zamiast fałszywego 0%.
export function computeExecutionRing(
  planned: PlannedWorkout,
  streams: StreamsJson,
  ftp: number | null,
  isEbike: boolean
): ExecutionRing {
  if (isEbike) return { available: false, reason: 'ebike' };
  if (!hasWatts(streams)) return { available: false, reason: 'no_power' };

  const type = planned.type;

  // ── Strukturalne (SST/THR/VO2/OU): okno mocy wokół celu, cel = zaplanowane minuty robocze.
  //    FTP niepotrzebne — work_w/over_w są absolutne. structure=null (legacy/zarys) → ukryj.
  if (isStructuredType(type)) {
    const s = planned.structure;
    if (!s) return { available: false, reason: 'no_structure' };

    let centerW: number;
    let targetMin: number;
    if (isOU(s)) {
      centerW = s.over_w;                       // okno wokół OVER (nie under) — twardy bodziec bloku
      targetMin = s.reps * s.cycles * s.over_min;
    } else {
      centerW = s.work_w;
      targetMin = s.reps * s.work_min;
    }
    if (targetMin <= 0) return { available: false, reason: 'bad_target' };
    return ratio(timeInPowerWindowSec(streams, centerW), targetMin);
  }

  // ── Jednolite (Z1/Z2/LONG): cel = minuty strefy głównej; wykonanie = czas w strefie (lub wyżej).
  //    FTP wymagane (typ→strefa). Rekonstrukcja warmup/cooldown DOKŁADNIE jak buildExpanded.
  if (ftp == null || ftp <= 0) return { available: false, reason: 'no_ftp' };

  if (type === 'Z1') {
    // Regeneracja: cel = cały dur_min (brak warmup/cooldown), wykonanie = TYLKO Z1
    // (jazda mocniej niż Z1 łamie cel regeneracji — nie liczy się jako realizacja).
    if (planned.dur_min <= 0) return { available: false, reason: 'bad_target' };
    return ratio(timeInZonesSec(streams, ftp, [0]), planned.dur_min);
  }

  if (type === 'Z2' || type === 'LONG') {
    // Cel = dur_min − warmup − cooldown (strefa główna, bez rozgrzewki/chłodzenia) → 100% osiągalne.
    const ss = sessionStructure(type);
    const wUsed = planned.warmup ?? ss.warmupDefault;
    const cUsed = planned.cooldown ?? ss.cooldownDefault;
    const targetMin = planned.dur_min - wUsed - cUsed;
    if (targetMin <= 0) return { available: false, reason: 'bad_target' };
    // Wykonanie = Z2 lub wyżej (indeksy 1..5) — rozgrzewka wchodzi stopniowo (niżej, odpada),
    // a jazda mocniej niż Z2 to wciąż bodziec tlenowy (realizacja, nie kara).
    return ratio(timeInZonesSec(streams, ftp, [1, 2, 3, 4, 5]), targetMin);
  }

  // Nieznany typ (nie powinien dojść — fetchPlannedDay odfiltrowuje OFF) → ukryj.
  return { available: false, reason: 'bad_target' };
}
