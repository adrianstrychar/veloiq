// Silnik estymaty FTP z 28-dniowej krzywej mocy (best_efforts per jazda).
// Czysty moduł bez I/O — wejście: jazdy z oknami mocy, wyjście: estymata + diagnostyka.
// Zasady: outlier-rejecting (pojedyncze anomalie czujnika), profile-aware (ratio 5/20 min
// decyduje o współczynniku 20min→FTP, NIE sztywne 0.95).

export interface EffortRide {
  activity_date: string;
  type: string | null;
  best_efforts: Record<string, number | null> | null;
}

export interface WindowStat {
  max: number | null;     // najlepsza wartość okna w 28 dniach (po odrzuceniu anomalii)
  n: number;              // ile jazd miało to okno
  rejected: number[];     // odrzucone anomalie (do diagnostyki/testów)
}

export interface FtpEstimate {
  ftp: number;
  best5: number;
  best20: number;
  best60: number | null;
  ratio: number;          // best5 / best20 — profil zawodnika
  coefficient: number;    // zastosowany współczynnik 20min→FTP
  floor60Applied: boolean; // czy podłoga "FTP ≥ najlepsza godzina" podniosła wynik
  windows: Record<string, WindowStat>;
  rides: number;          // jazdy z niepustą krzywą w oknie
}

// Minimalna liczba jazd z krzywą, żeby estymata miała sens (mniej = szum jednej jazdy).
const MIN_RIDES = 3;

const KEY_WINDOWS = ['5min', '8min', '10min', '20min', '30min', '1h'] as const;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Odrzucanie POJEDYNCZYCH anomalii od góry (tylko góra ma znaczenie — silnik używa maksimów;
// niskie wartości to "brak wysiłku w tej jeździe", nie anomalia). Metoda: MAD z potwierdzeniem
// osamotnienia. Wartość odpada tylko gdy JEDNOCZEŚNIE:
//  (a) v > mediana + 4×MAD — statystycznie nietypowa (MAD zamiast odchylenia std., bo przy
//      5–20 jazdach w oknie pojedynczy skok czujnika rozsadziłby std; MAD jest na niego odporny,
//      a trim percentylowy jest źle określony przy tak małych n),
//  (b) v > 1.15 × druga najlepsza — OSAMOTNIONA na szczycie. To odróżnia skok czujnika od
//      realnej formy: prawdziwy wysiłek jest powtarzalny między jazdami (wyścig + trening dają
//      zbliżone szczyty), skok czujnika występuje raz. Sam MAD odrzucałby prawdziwy mocny
//      wyścig wśród spokojnych jazd Z2 — warunek (b) to blokuje.
// Warunki sprawdzane iteracyjnie od najwyższej wartości; n<3 → bez odrzucania (za mało tła).
export function rejectTopAnomalies(values: number[]): { kept: number[]; rejected: number[] } {
  if (values.length < 3) return { kept: values, rejected: [] };
  const kept = [...values].sort((a, b) => b - a);
  const rejected: number[] = [];
  for (;;) {
    if (kept.length < 3) break;
    const m = median(kept);
    const mad = median(kept.map((v) => Math.abs(v - m)));
    const madFloor = Math.max(mad, 0.02 * m); // MAD=0 przy identycznych wartościach → minimalna tolerancja 2%
    const top = kept[0];
    const second = kept[1];
    if (top > m + 4 * madFloor && top > 1.15 * second) {
      rejected.push(kept.shift()!);
    } else {
      break;
    }
  }
  return { kept, rejected };
}

// Współczynnik 20min→FTP zależny od profilu (ratio best5/best20).
// Fizjologia: moc 20 min = komponent tlenowy (≈FTP) + rozłożony wkład beztlenowy (W').
// Puncheur (wysokie ratio — duże W') dokłada do 20 min więcej "jednorazowej" energii
// beztlenowej, więc jego 20 min ZAWYŻA próg → współczynnik niższy. Diesel (niskie ratio,
// małe W') jedzie 20 min niemal czystym progiem → współczynnik wyższy.
// Poziom mapy wyżej niż testowe 0.95 Allena/Coggana, bo wejściem NIE jest maksymalny
// test 20 min po protokole wyczerpania W', tylko najlepsze 20 min z NORMALNYCH jazd
// 28 dni — z natury submaksymalne, więc mniej zawyżone względem progu.
// Mapa liniowa, klamrowana: r ≤ 1.10 → 0.98; r ≥ 1.50 → 0.90.
// KALIBRACJA (2026-07-06, realne okno 28 dni, FTP mierzone 295 W): best5 344, best20 300,
// r = 1.147 → k = 0.972 → estymata 292 W (błąd −3 W, w widełkach 290–306).
export function coefficientForRatio(ratio: number): number {
  const r = Math.max(1.0, Math.min(1.6, ratio));
  if (r <= 1.10) return 0.98;
  if (r >= 1.50) return 0.90;
  return Math.round((0.98 - ((r - 1.10) / 0.40) * 0.08) * 1000) / 1000;
}

// Estymata FTP z jazd okna. null = za mało danych (mniej niż MIN_RIDES jazd z krzywą
// albo brak kluczowych okien 5/20 min) — caller zostawia poprzednią estymatę.
export function estimateFtp(rides: EffortRide[]): FtpEstimate | null {
  // E-bike wykluczony z definicji (moc silnika nie istnieje w systemie); pusta krzywa = brak danych.
  const usable = rides.filter(
    (r) => r.type !== 'EBikeRide' && r.best_efforts && Object.keys(r.best_efforts).length > 0
  );
  if (usable.length < MIN_RIDES) return null;

  const windows: Record<string, WindowStat> = {};
  for (const w of KEY_WINDOWS) {
    const values = usable
      .map((r) => r.best_efforts![w])
      .filter((v): v is number => v != null && v > 0);
    if (values.length === 0) {
      windows[w] = { max: null, n: 0, rejected: [] };
      continue;
    }
    const { kept, rejected } = rejectTopAnomalies(values);
    windows[w] = { max: kept.length ? Math.max(...kept) : null, n: values.length, rejected };
  }

  const best5 = windows['5min']?.max ?? null;
  const best20 = windows['20min']?.max ?? null;
  const best60 = windows['1h']?.max ?? null;
  if (best5 == null || best20 == null) return null;

  const ratio = Math.round((best5 / best20) * 1000) / 1000;
  const coefficient = coefficientForRatio(ratio);
  let ftp = Math.round(best20 * coefficient);

  // Podłoga fizjologiczna: FTP nie może być niższe niż moc UTRZYMANA przez godzinę
  // (z definicji progu). Chroni przed niedoszacowaniem, gdy 20 min w oknie jest "miękkie"
  // (trening interwałowy rozbija długie okna), a godzina z długiej jazdy — solidna.
  let floor60Applied = false;
  if (best60 != null && best60 > ftp) {
    ftp = best60;
    floor60Applied = true;
  }
  // Sufit: FTP nigdy powyżej mocy 20 min (współczynnik ≤ 1 z definicji).
  ftp = Math.min(ftp, best20);

  return { ftp, best5, best20, best60, ratio, coefficient, floor60Applied, windows, rides: usable.length };
}

// ── Reguła hybrydy wyświetlania ────────────────────────────────────────────────
// Wyświetlane FTP aktualizuje się gdy: (a) minęło ≥14 dni od ostatniej zmiany, LUB
// (b) |estymata − wyświetlane| przekracza próg ASYMETRYCZNY: ≥5 W w górę / ≥8 W w dół.
// Asymetria celowa: wzrost przyjmujemy szybko (strefy treningowe mają gonić formę),
// spadek ostrożnie (dołek mocy to często zmęczenie, nie utrata formy — nie obniżaj
// stref po ciężkim tygodniu).

export type FtpUpdateReason = 'rise' | 'drop' | 'stale14d';

export interface FtpDisplayDecision {
  update: boolean;
  reason: FtpUpdateReason | null;
  deltaW: number;
}

export const FTP_RISE_THRESHOLD_W = 5;
export const FTP_DROP_THRESHOLD_W = 8;
export const FTP_STALE_DAYS = 14;

export function decideFtpDisplayUpdate(
  displayedW: number,
  displayedAtIso: string,
  estimateW: number,
  nowIso: string
): FtpDisplayDecision {
  const deltaW = estimateW - displayedW;
  if (deltaW >= FTP_RISE_THRESHOLD_W) return { update: true, reason: 'rise', deltaW };
  if (deltaW <= -FTP_DROP_THRESHOLD_W) return { update: true, reason: 'drop', deltaW };
  const days = (new Date(nowIso).getTime() - new Date(displayedAtIso).getTime()) / 86400000;
  if (days >= FTP_STALE_DAYS && deltaW !== 0) return { update: true, reason: 'stale14d', deltaW };
  return { update: false, reason: null, deltaW };
}
