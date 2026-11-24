// Czas przejazdu trasy z fizyki jazdy (moc zawodnika, masa, opór toczenia nawierzchni, aerodynamika i nachylenie)
// – dokładniej niż „średnia prędkość”: podjazdy i szuter kosztują czas, zjazdy mają limit prędkości.
import type { SurfaceCode } from '@/lib/ride/gpx';

export type BikeKind = 'road' | 'gravel' | 'mtb' | 'calm';

interface BikeModel { cda: number; crr: [number, number, number, number]; vmaxDown: [number, number, number, number]; bike: number }
// Crr i limit prędkości na zjazdach dla: asfalt, szuter, teren, nieznana
const BIKES: Record<BikeKind, BikeModel> = {
  road:   { cda: 0.30, crr: [0.0040, 0.0120, 0.0250, 0.0060], vmaxDown: [60, 30, 18, 45], bike: 8 },
  gravel: { cda: 0.34, crr: [0.0050, 0.0080, 0.0150, 0.0070], vmaxDown: [55, 42, 25, 45], bike: 9.5 },
  mtb:    { cda: 0.42, crr: [0.0070, 0.0100, 0.0160, 0.0090], vmaxDown: [50, 45, 32, 40], bike: 12 },
  calm:   { cda: 0.45, crr: [0.0060, 0.0110, 0.0200, 0.0080], vmaxDown: [40, 30, 18, 35], bike: 14 },
};

const G = 9.81, RHO = 1.2;

/** Prędkość (m/s) przy mocy P na nachyleniu `grade` (ułamek). P = a·v³ + b·v ma dokładnie jeden dodatni pierwiastek
 *  (także na zjeździe, gdy b < 0) – bisekcja jest pewniejsza niż metoda Newtona przy ujemnym b. */
export function speedFor(P: number, grade: number, mass: number, crr: number, cda: number): number {
  const th = Math.atan(grade);
  const a = 0.5 * RHO * cda;
  const b = mass * G * (Math.sin(th) + crr * Math.cos(th));
  let lo = 0.05, hi = 60;
  for (let i = 0; i < 60; i++) {
    const v = (lo + hi) / 2;
    if (a * v * v * v + b * v - P > 0) hi = v; else lo = v;
  }
  return (lo + hi) / 2;
}

export interface Rider { ftp: number; weight: number }

/** Szacowany czas jazdy (s) po punktach [lat, lon, ele, d] z nawierzchnią odcinkami [od m, kod].
 *  Moc „wytrzymałościowa” ~ 65% FTP na płaskim, do ~ 85% FTP pod górę (tak jeździ się długie trasy). */
export function estimateSeconds(pts: [number, number, number | null, number][], surface: [number, SurfaceCode][], rider: Rider, kind: BikeKind): number {
  const m = BIKES[kind];
  const mass = Math.max(45, rider.weight || 75) + m.bike;
  const ftp = Math.max(120, rider.ftp || 230);
  let t = 0, si = 0;
  // wygładzona wysokość co ≥ 50 m – szum SRTM nie robi z płaskiej drogi piły
  let lastD = pts[0][3], lastE = pts[0][2];
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i][3];
    const seg = d - lastD;
    if (seg < 50 && i < pts.length - 1) continue;
    const e = pts[i][2];
    const grade = e != null && lastE != null && seg > 0 ? Math.max(-0.2, Math.min(0.25, (e - lastE) / seg)) : 0;
    while (si + 1 < surface.length && surface[si + 1][0] <= lastD) si++;
    const sc = surface.length ? surface[si][1] : 3;
    const P = ftp * (grade > 0.02 ? Math.min(0.85, 0.65 + grade * 2) : grade < -0.02 ? 0.35 : 0.65);
    let v = speedFor(P, grade, mass, m.crr[sc], m.cda);
    v = Math.min(v, m.vmaxDown[sc] / 3.6);
    t += seg / v;
    lastD = d; lastE = e ?? lastE;
  }
  // postoje na skrzyżowaniach / światłach: ~ 1 min na 10 km poza terenem
  return Math.round(t * 1.04);
}
