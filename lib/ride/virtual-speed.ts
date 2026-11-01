// Wirtualna prędkość i dystans na trenażerze – jak w Zwift: płaska droga, model mocy z bezwładnością
// (rozpędzanie i wybieg). Celowo „hojna” aerodynamika (CdA 0,28), żeby liczby mobilizowały:
// 200 W ≈ 35 km/h, 300 W ≈ 40 km/h. Ten sam model liczy natywny silnik na iPhonie (WorkoutEngine.vStep).

export const VS_CDA = 0.28;
export const VS_CRR = 0.004;
export const VS_RHO = 1.225;
export const VS_BIKE_KG = 9;
export const VS_RIDER_KG = 75;

export class VirtualSpeed {
  v = 0;      // m/s
  dist = 0;   // m
  private readonly m: number;
  constructor(riderKg = VS_RIDER_KG) { this.m = riderKg + VS_BIKE_KG; }
  /** Jedna sekunda jazdy z mocą p (W). Zwraca prędkość w m/s. */
  step(p: number): number {
    const m = this.m, dt = 0.1;
    for (let i = 0; i < 10; i++) {
      const drive = Math.max(0, p) / Math.max(this.v, 1);
      const resist = 0.5 * VS_RHO * VS_CDA * this.v * this.v + VS_CRR * m * 9.81;
      this.v = Math.max(0, this.v + ((drive - resist) / (m + 1)) * dt);
      if (this.v < 0.3 && p <= 0) this.v = 0;
      this.dist += this.v * dt;
    }
    return this.v;
  }
}

/** Dystans narastająco (m) dla zapisu 1 Hz – moc w W, sekunda po sekundzie. */
export function virtualDistances(power: number[], riderKg = VS_RIDER_KG): number[] {
  const vs = new VirtualSpeed(riderKg);
  return power.map((p) => { vs.step(p); return vs.dist; });
}

interface Pt { p?: number; lat?: number; lon?: number }
const hav = (a: Pt, b: Pt) => {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat! - a.lat!) * r, dLon = (b.lon! - a.lon!) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat! * r) * Math.cos(b.lat! * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Dystans narastająco (m) dla zapisu: z GPS, a bez GPS (trenażer) – wirtualny z mocy. */
export function rideDistances(samples: Pt[]): number[] {
  if (!samples.some((x) => x.lat != null && x.lon != null)) return virtualDistances(samples.map((x) => x.p ?? 0));
  let d = 0; let prev: Pt | null = null;
  return samples.map((x) => {
    if (x.lat != null && x.lon != null) {
      if (prev) { const k = hav(prev, x); if (k < 60) d += k; }   // skoki GPS > 60 m/s pomijamy
      prev = x;
    }
    return d;
  });
}
