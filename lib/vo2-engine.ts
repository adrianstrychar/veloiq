// Silnik estymaty VO2max z 5-min mocy (feat/vo2-engine) — bliźniak ftp-engine.
// Czysty moduł bez I/O. Wejście: te same jazdy z best_efforts co silnik FTP (okno 28 dni).
//
// WZÓR: ACSM leg-cycling metabolic equation (American College of Sports Medicine,
// "Guidelines for Exercise Testing and Prescription"): VO2 (mL/kg/min) = 7 + 10.8 × W / masa_kg.
//   7    = spoczynek 3.5 + jazda bez obciążenia 3.5;
//   10.8 = koszt tlenowy na wat na kg (założona sprawność brutto ~21%).
// Stosowane przy NAJLEPSZEJ mocy 5-min: 5-min max ≈ moc wywołująca VO2max (wysiłki 5-min
// elicytują ~VO2max). To ESTYMATA, nie pomiar: zakłada standardową sprawność i że 5-min max
// = moc @VO2max — stąd widełki ±4 (sprawność 18–24% + zmienność wysiłku). NIE wymaga wieku/płci
// (w przeciwieństwie do Storera), których w profilu nie mamy.
import { rejectTopAnomalies, type EffortRide } from '@/lib/ftp-engine';

const VO2_BASE = 7;
const VO2_COEF = 10.8;
const VO2_BAND = 4;          // widełki ±4 mL/kg/min
const MIN_5MIN_EFFORTS = 1;  // min. 1 wysiłek 5-min w oknie, inaczej null (kafel ukryty)

export interface Vo2Estimate {
  vo2: number;
  inputPower: number;   // moc 5-min użyta jako wejście (max po odrzuceniu anomalii)
  lo: number;
  hi: number;
  n: number;            // ile jazd miało 5-min w oknie
  rejected: number[];   // odrzucone anomalie (diagnostyka/testy)
}

// Estymata VO2max z best_efforts okna 28 dni + masa. null = brak masy albo brak 5-min (kafel ukryty).
// WEJŚCIE odporne: max PO odrzuceniu anomalii (rejectTopAnomalies z ftp-engine) — pojedynczy skok
// czujnika (np. 450W) jest wycinany i NIE rusza estymaty (VO2max wolnozmienny). Wybrane zamiast
// mediany top-3, bo jest STABILNIEJSZE: outlier ma zerowy wpływ (mediana top-3 przesuwa wynik,
// gdy skok wypycha realny szczyt na pozycję środkową). Moc 5-min i tak już przeszła outlier-rejection
// w silniku FTP — to druga warstwa.
export function estimateVo2(rides: EffortRide[], weightKg: number | null): Vo2Estimate | null {
  if (!weightKg || weightKg <= 0) return null;
  // E-bike wykluczony (moc z silnika); best_efforts e-bike i tak puste (syncBestEfforts je pomija).
  const powers = rides
    .filter((r) => r.type !== 'EBikeRide' && r.best_efforts)
    .map((r) => r.best_efforts!['5min'])
    .filter((v): v is number => v != null && v > 0);
  if (powers.length < MIN_5MIN_EFFORTS) return null;

  const { kept, rejected } = rejectTopAnomalies(powers); // <3 wartości → zwraca bez zmian (sparse OK)
  const inputPower = Math.max(...(kept.length ? kept : powers));
  const vo2 = Math.round(VO2_BASE + (VO2_COEF * inputPower) / weightKg);
  return { vo2, inputPower, lo: vo2 - VO2_BAND, hi: vo2 + VO2_BAND, n: powers.length, rejected };
}
