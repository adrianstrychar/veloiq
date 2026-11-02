// Tryb startowy: strategia wyścigu (AI, z trasy GPX) → cel mocy na KAŻDY podjazd trasy w jeździe.
// Enzo zapowiada podjazd z celem („trzymaj od 280 do 300 watów”) i mówi, czy tu oszczędzać,
// czy atakować. Fazy strategii to tekst (np. „Podjazd km 23 · 1.2 km · 8%”, „235-250 W (76-81% FTP)”),
// więc parsujemy km i waty; podjazd bez fazy dostaje cel z długości podjazdu i FTP.

import type { RideRoute, RouteClimb } from './gpx';

export type Tier = 'oszczedz' | 'atak' | 'full';

export interface PacingPhase {
  fromKm: number;
  toKm: number;
  low: number;
  high: number;
  tier?: Tier;
  tip?: string;
  climb: boolean;   // faza opisuje konkretny podjazd (a nie odcinek / trzecią część wyścigu)
}

export interface RacePacing {
  raceId: string;
  name: string;
  date: string;
  phases: PacingPhase[];
}

const num = (s: string) => Number(s.replace(',', '.'));
const r5 = (w: number) => Math.round(w / 5) * 5;

/** Fazy strategii (race_plans.tactical_plan.pacing) → przedziały km z celem mocy. */
export function parsePacing(pacing: { phase?: string; tier?: string; watts?: string; tip?: string }[] | null | undefined): PacingPhase[] {
  const out: PacingPhase[] = [];
  for (const p of pacing ?? []) {
    const text = String(p.phase ?? '');
    const w = String(p.watts ?? '');
    let low: number | null = null, high: number | null = null;
    const wr = /(\d{2,4})\s*[-–]\s*(\d{2,4})\s*W/i.exec(w);
    const ws = /(\d{2,4})\s*W/i.exec(w);
    if (wr) { low = +wr[1]; high = +wr[2]; }
    else if (ws) { low = r5(+ws[1] * 0.975); high = r5(+ws[1] * 1.025); }
    if (!low || !high || high < low) continue;

    let fromKm: number | null = null, toKm: number | null = null;
    // „0-43 km” albo „km 30-80”
    const range = /(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*km/i.exec(text)
      ?? /km\s*(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)/i.exec(text);
    const at = /km\s*(\d+(?:[.,]\d+)?)/i.exec(text);
    const isClimb = /podjazd|wspin|ścian|góra|przełęcz|climb/i.test(text) || (!!at && !range);
    if (range) { fromKm = num(range[1]); toKm = num(range[2]); }
    else if (at) {
      fromKm = num(at[1]);
      // „km 23 · 1.2 km” → długość podjazdu z drugiej liczby z „km”
      const len = /·\s*(\d+(?:[.,]\d+)?)\s*km/i.exec(text.slice(at.index + at[0].length));
      toKm = fromKm + (len ? num(len[1]) : 1);
    }
    if (fromKm == null || toKm == null || toKm < fromKm) continue;
    const tier = p.tier === 'oszczedz' || p.tier === 'atak' || p.tier === 'full' ? p.tier : undefined;
    out.push({ fromKm, toKm, low, high, tier, tip: p.tip ? String(p.tip).slice(0, 160) : undefined, climb: isClimb });
  }
  return out;
}

/** Cel na podjazd bez fazy w strategii: z długości podjazdu (czas wysiłku) i FTP, skorygowany o taktykę. */
function defaultClimbPct(lenKm: number, tier: Tier | undefined): number {
  const base = lenKm < 1 ? 1.06 : lenKm < 3 ? 0.98 : lenKm < 8 ? 0.92 : 0.86;
  const adj = tier === 'oszczedz' ? -0.05 : tier === 'atak' ? 0.03 : tier === 'full' ? 0.06 : 0;
  return base + adj;
}

/** Trasa z celami mocy na podjazdach (dla natywnej nawigacji: climbs[].low/high/tier). */
export function applyRaceTargets(route: RideRoute, phases: PacingPhase[], ftp: number): RideRoute {
  const totalKm = route.total / 1000;
  const climbs: RouteClimb[] = route.climbs.map((c) => {
    const sKm = c.start / 1000, eKm = c.end / 1000, lenKm = eKm - sKm;
    // 1) faza strategii o TYM podjeździe (km startu ±1.5 km)
    const exact = phases.find((p) => p.climb && sKm >= p.fromKm - 1.5 && sKm <= p.toKm + 0.5);
    if (exact) return { ...c, low: exact.low, high: exact.high, tier: exact.tier, tip: exact.tip };
    // 2) odcinek strategii, w którym leży podjazd → jego taktyka; 3) końcówka wyścigu = atak
    const seg = phases.find((p) => !p.climb && sKm >= p.fromKm && sKm < p.toKm);
    const tier: Tier | undefined = seg?.tier ?? (sKm >= totalKm * 0.75 ? 'atak' : undefined);
    if (!ftp) return { ...c, tier };
    const pct = defaultClimbPct(lenKm, tier);
    return { ...c, low: r5(ftp * pct * 0.97), high: r5(ftp * pct * 1.03), tier, tip: seg?.tip };
  });
  return { ...route, climbs };
}
