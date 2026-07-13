// Rekonstrukcja historii FTP: silnik 28-dniowy przeliczony WSTECZ tygodniowo z best_efforts
// (kompletne dla starych jazd — streams niepotrzebne). Zastępuje seedowane punkty realnymi.
// Oś startuje od PIERWSZEGO WIARYGODNEGO PUNKTU (estimateFtp != null) — dynamicznie, zero
// sztywnych dat, zero pustych tygodni przed danymi (naprawa buga "kalendarz od stycznia").
//
// ENVELOPE (wariant C, wersja DOWODOWA) — running-max, schodzi tylko przy DOWODZIE spadku:
//  Rozróżnia (a) BRAK mocnych jazd (regeneracja — FTP nie ma jak się potwierdzić, forma trzyma) od
//  (b) mocne jazdy SŁABSZE niż szczyt (realny spadek). Sygnał dowodu = max INTENSITY_FACTOR w oknie:
//  jeśli była twarda jazda (IF ≥ 0.85 = testowałeś próg/wyścig) a zrekonstruowany FTP mimo to NIŻSZY
//  → "próbowałeś mocno, wyszło słabiej" = spadek → SCHODŹ (≤2.5%/tydz, podłoga = raw). Brak twardej
//  jazdy (IF < 0.85, sam tempo/endurance) = regeneracja → HOLD bezterminowo (choćby 6 tygodni).
//  (IF wybrane zamiast best20: best20 = max 28-dniowy, więc STARY szczytowy wysiłek zostaje w oknie
//   i fałszywie udaje "near-peak" mimo braku nowego twardego wysiłku — na realnych danych czerwca
//   best20 dawał fałszywy zjazd 296→274, a max IF czerwca = 0.80 poprawnie mówił "regeneracja".)
import { estimateFtp, type EffortRide } from '@/lib/ftp-engine';

// Wejście rekonstrukcji: jazda z krzywą mocy + intensity_factor (sygnał "twardej jazdy" do envelope).
export interface ReconRide extends EffortRide { intensity_factor?: number | null }

export interface ReconPoint {
  date: string;   // 'YYYY-MM-DD'
  raw: number;    // surowy silnik 28d (poszarpany)
  ftp: number;    // envelope (dowodowy) — linia real na wykresie
  rides: number;  // jazd z krzywą w oknie (diagnostyka)
}

export const RECON_CONFIG = {
  WINDOW_DAYS: 28,                // okno silnika FTP
  STEP_DAYS: 7,                  // krok tygodniowy
  HARD_IF: 0.85,                 // dowód testowania progu: max intensity_factor w oknie ≥ 0.85 (twarda jazda)
  ENVELOPE_DECAY_PER_WEEK: 0.025, // miękkie zejście ≤2.5%/tydz gdy dowód spadku; bez dowodu = hold
} as const;

const DAY = 86_400_000;
function dayMs(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);

export function reconstructFtp(rides: ReconRide[], today: string): ReconPoint[] {
  const usable = rides.filter((r) => r.best_efforts && Object.keys(r.best_efforts).length > 0);
  if (usable.length === 0) return [];
  const oldest = usable.reduce((mn, r) => Math.min(mn, dayMs(r.activity_date)), Infinity);
  const todayMs = dayMs(today);

  // Surowe punkty tygodniowe od (najstarsza + 27 dni); zbieramy dopiero od pierwszego niepustego.
  // maxIF = max intensity_factor w oknie (dowód twardej jazdy — czy testowano próg) → wejście envelope.
  const raws: { date: string; raw: number; maxIF: number; rides: number }[] = [];
  let started = false;
  for (let t = oldest + (RECON_CONFIG.WINDOW_DAYS - 1) * DAY; t <= todayMs; t += RECON_CONFIG.STEP_DAYS * DAY) {
    const win = usable.filter((r) => { const d = dayMs(r.activity_date); return d > t - RECON_CONFIG.WINDOW_DAYS * DAY && d <= t; });
    const est = estimateFtp(win);
    if (est == null) { if (!started) continue; else continue; } // brak wiarygodnego punktu → nie fabrykujemy
    started = true;
    const maxIF = win.reduce((mx, r) => Math.max(mx, r.intensity_factor ?? 0), 0);
    raws.push({ date: isoOf(t), raw: est.ftp, maxIF, rides: est.rides });
  }

  const env = smoothEnvelope(raws.map((p) => p.raw), raws.map((p) => p.maxIF));
  return raws.map((p, i) => ({ date: p.date, raw: p.raw, ftp: Math.round(env[i]), rides: p.rides }));
}

// Envelope wariant C DOWODOWY (czysta, testowalna). Wejścia równoległe: raw (FTP silnika 28d) i
// maxIF (max intensity_factor w oknie — dowód twardej jazdy). Running-max; schodzi ≤2.5%/tydz TYLKO
// gdy maxIF ≥ HARD_IF (była twarda jazda) a raw < env. Brak twardej jazdy = regeneracja → HOLD. Podłoga = raw.
export function smoothEnvelope(raw: number[], maxIF: number[]): number[] {
  const { HARD_IF, ENVELOPE_DECAY_PER_WEEK } = RECON_CONFIG;
  const out: number[] = [];
  let env = raw.length ? raw[0] : 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] >= env) {
      env = raw[i];                                  // nowe (lub równe) maksimum
    } else if (maxIF[i] >= HARD_IF) {
      env = Math.max(raw[i], env - ENVELOPE_DECAY_PER_WEEK * env); // twarda jazda słabsza → schodź, podłoga raw
    } // brak twardej jazdy (regeneracja) → env bez zmian (hold)
    out.push(env);
  }
  return out;
}
