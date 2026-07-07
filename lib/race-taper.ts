// Silnik taperingu i szacowania dnia startu (feat/race-aware-plan) — czysty, bez I/O.
// Dwa zadania: (1) deterministyczny szacunek czasu/TSS dnia wyścigu z dystansu+przewyższenia,
// (2) struktura tygodnia startowego wstecz od dnia startu, głębokość zależna od rangi (A/B/C).
// Wszystko parametryzowane — kalibracja przed kolejnymi startami A bez przepisywania generatora.

export type RacePriority = 'A' | 'B' | 'C';

// ── KONFIGURACJA (jedyne miejsce do strojenia) ───────────────────────────────
// Głębokość taperu w dniach wg rangi. User kalibruje tutaj przed startami A (Nannup).
export const TAPER_CONFIG = {
  taperDaysA: 6, // priorytet A: pełny taper 6 dni z asymetrią
  taperDaysB: 3, // priorytet B: mini-taper 3 dni
  // C i dalekie starty: 0 → normalne budowanie.
} as const;

// Model szacowania czasu: prędkość bazowa wg dyscypliny + kara za przewyższenie.
// KALIBRACJA (2026-07-06, Winterberg 110km/1800m/gravel/FTP295 → cel ~4:15 / ~285 TSS):
// effSpeed = base / (1 + (elevM/distKm) * ELEV_K); IF wg rangi. Sprawdzone: 4:15 / 286 TSS.
const SPEED_KMH: Record<string, number> = { gravel: 29, road: 33, mtb: 22 };
const DEFAULT_SPEED_KMH = 27;         // nieznana dyscyplina — konserwatywnie
const ELEV_K = 0.0075;                // waga kary za m przewyższenia na km dystansu
// IF wg rangi: start A to najdłuższy, najbardziej rozłożony wysiłek → najniższe IF.
const IF_BY_PRIORITY: Record<RacePriority, number> = { A: 0.82, B: 0.85, C: 0.87 };

export interface RaceEstimate {
  estTimeMin: number;   // szacowany czas jazdy (min)
  estTss: number;       // szacowany TSS (tylda — realne dane Strava zastąpią po starcie)
  ifUsed: number;       // przyjęte IF
  speedKmh: number;     // efektywna prędkość po korekcie przewyższenia
}

// Szacunek dnia startu z dystansu, przewyższenia, dyscypliny i rangi. FTP niepotrzebne —
// TSS z definicji = czas_h × IF² × 100 (IF już jest ułamkiem FTP). Braki danych → null.
export function estimateRaceDay(
  distanceKm: number | null,
  elevationM: number | null,
  discipline: string | null,
  priority: RacePriority
): RaceEstimate | null {
  if (distanceKm == null || distanceKm <= 0) return null;
  const base = SPEED_KMH[discipline ?? ''] ?? DEFAULT_SPEED_KMH;
  const elevPerKm = elevationM != null && elevationM > 0 ? elevationM / distanceKm : 0;
  const speedKmh = base / (1 + elevPerKm * ELEV_K);
  const timeH = distanceKm / speedKmh;
  const ifUsed = IF_BY_PRIORITY[priority];
  const estTss = Math.round(timeH * ifUsed * ifUsed * 100);
  return { estTimeMin: Math.round(timeH * 60), estTss, ifUsed, speedKmh: Math.round(speedKmh * 10) / 10 };
}

// Ile dni taperu dla danej rangi (0 = brak, budowanie normalne).
export function taperDaysFor(priority: RacePriority): number {
  if (priority === 'A') return TAPER_CONFIG.taperDaysA;
  if (priority === 'B') return TAPER_CONFIG.taperDaysB;
  return 0;
}

// ── Struktura taperu wstecz od dnia startu ────────────────────────────────────
// offset = liczba dni PRZED startem (0 = dzień startu). Zwraca instrukcję dla danego offsetu.
// ASYMETRIA (priorytet A): objętość tniemy WCZEŚNIE (−4..−6), intensywność trzymamy do −3.
// Uzasadnienie fizjologiczne: puncheur 67kg / wysokie W/kg przepłukuje się długim, miękkim
// taperem — traci ostrość (punch). Wczesne cięcie objętości daje rezerwę na 4h+ (adresuje
// słabość threshold endurance), a bodziec ostrości na −3 chroni moc na 1800 m przewyższenia.
function taperDayInstructionA(offset: number): string | null {
  switch (offset) {
    case 0: return null; // dzień startu = RACE, wstrzykiwany server-side
    // Primer = LEKKI dzień typu Z2. Przyspieszenia to otwarcie nóg, NIE sesja VO2/THR — opisz je
    // w insight, nie rób z dnia treningu jakościowego (VO2 24h przed startem = błąd taperu).
    case 1: return 'primer: type Z2, dur_min 40–60, structure null. Dodaj 3–4× 30–60s przyspieszeń — OPISZ w insight, NIE type VO2/THR. To otwarcie nóg, nie trening.';
    case 2: return 'type OFF lub Z1 30 min (regeneracja przed primerem) — bez intensywności';
    case 3: return 'ostatni bodziec ostrości: type THR lub VO2, 3–4× 3min, MAŁA objętość (asymetria: intensywność trzymana TYLKO do −3)';
    case 4: return 'redukcja objętości ~50%: type Z2 45–60 min, bez akcentów';
    case 5: return 'type Z1/Z2 lekko lub OFF';
    case 6: return 'ostatnia sesja jakościowa bloku (type SST lub THR umiarkowany), potem objętość spada';
    default: return null;
  }
}

// Priorytet B: mini-taper 3 dni. Start B = mocny trening + sprawdzian, nie pełne szczytowanie.
function taperDayInstructionB(offset: number): string | null {
  switch (offset) {
    case 0: return null; // RACE
    case 1: return 'primer: type Z2, dur_min ~40, structure null. 3× 40s przyspieszeń OPISZ w insight, NIE type VO2/THR.';
    case 2: return 'type Z1/Z2 lekko 45–60 min lub OFF';
    case 3: return 'redukcja objętości ~30%, można zostawić 1 krótki akcent (SST/THR umiarkowany)';
    default: return null;
  }
}

export function taperInstruction(priority: RacePriority, offset: number): string | null {
  if (priority === 'A') return taperDayInstructionA(offset);
  if (priority === 'B') return taperDayInstructionB(offset);
  return null;
}

// Cel TSB w dniu startu wg rangi (informacyjnie do promptu).
export function targetTsbFor(priority: RacePriority): string {
  if (priority === 'A') return '+15 do +25';
  if (priority === 'B') return '+5 do +12';
  return '~0';
}

// Współczynnik redukcji objętości treningowej tygodnia startowego (do celu TSS band).
// Race-day TSS jest liczony osobno (wstrzykiwany), to dotyczy tylko dni treningowych.
export function taperVolumeFactor(priority: RacePriority): number {
  if (priority === 'A') return 0.5;
  if (priority === 'B') return 0.8;
  return 1;
}

// Typy dozwolone w ostatnich 48h przed startem A (−1 primer, −2 regeneracja) + sam dzień startu.
// Wszystko inne (THR/VO2/OU/SST/LONG) na tych dniach = intensywność/objętość niszcząca szczytowanie.
const TAPER_ALLOWED_LAST_48H = new Set(['OFF', 'Z1', 'Z2', 'RACE']);

// TWARDA WALIDACJA SERWEROWA ostatnich 48h przed startem A. Nie ufamy, że prompt wystarczy —
// model potrafi wstawić VO2 na −1 (zaobserwowane w Test 1). Naruszenie → retry generatora,
// dokładnie jak przy przekroczeniu sumy TSS. Tylko ranga A (pełne szczytowanie); B/C łagodniej.
// Zwraca komunikat błędu albo null gdy OK. Dni −1/−2 spoza tygodnia (dow<1) pomijane.
export function taperLast48hViolation(
  days: { dow: number; type: string }[],
  raceDow: number,
  priority: RacePriority
): string | null {
  if (priority !== 'A') return null;
  for (const offset of [1, 2]) {
    const dow = raceDow - offset;
    if (dow < 1) continue;
    const d = days.find((x) => x.dow === dow);
    if (d && !TAPER_ALLOWED_LAST_48H.has(d.type)) {
      return `dzień −${offset} przed startem (dow ${dow}) ma typ ${d.type} — w ostatnich 48h dozwolone tylko Z1/Z2/OFF (primer z akcentami w opisie, nie sesja jakościowa)`;
    }
  }
  return null;
}

// Buduje blok promptu: struktura tygodnia startowego dzień po dniu (dow), wstecz od startu.
// raceDow = dzień startu w generowanym tygodniu (1=Pn..7=Nd). Dni przed startem w TYM tygodniu
// dostają instrukcję wg offsetu; offsety spoza tygodnia (taper sięga poprzedniego) pomijamy tu.
export function buildTaperGuidance(
  raceName: string,
  priority: RacePriority,
  raceDow: number
): string {
  const taperDays = taperDaysFor(priority);
  const lines: string[] = [
    `TYDZIEŃ STARTOWY — wyścig "${raceName}" (ranga ${priority}) w dniu dow ${raceDow}. To NIE jest tydzień budowania — to ${priority === 'A' ? 'pełny tapering (szczytowanie)' : 'mini-taper'}.`,
    `dow ${raceDow} = dzień startu: zostaw jako OFF (tss 0, dur_min 0) — serwer wstawi tam wyścig z szacowanym obciążeniem. NIE planuj na ten dzień treningu.`,
    `Cel TSB w dniu startu: ${targetTsbFor(priority)}. Struktura dni PRZED startem (wstecz):`,
  ];
  for (let offset = 1; offset <= taperDays; offset++) {
    const dow = raceDow - offset;
    if (dow < 1) break; // taper sięga poprzedniego tygodnia — poza zakresem tego tygodnia
    const instr = taperInstruction(priority, offset);
    if (instr) lines.push(`  dow ${dow} (−${offset} do startu): ${instr}`);
  }
  const earliest = raceDow - taperDays;
  if (earliest > 1) {
    lines.push(`  dow 1..${earliest - 1}: przed fazą taperu — normalne, ale już z myślą o starcie (bez wyniszczających bloków).`);
  }
  if (priority === 'A') {
    lines.push('ASYMETRIA (twarda reguła): objętość redukuj WCZEŚNIE (−4..−6), intensywność/ostrość trzymaj TYLKO do −3. Nie wypłukuj punchu długim miękkim taperem.');
    lines.push('ZAKAZ INTENSYWNOŚCI w ostatnich 48h (offset −1 i −2): ŻADNEGO type VO2/THR/OU/SST/LONG na tych dniach — wyłącznie Z1/Z2/OFF. Ciężka sesja tuż przed startem niszczy szczytowanie.');
  }
  return lines.join('\n');
}
