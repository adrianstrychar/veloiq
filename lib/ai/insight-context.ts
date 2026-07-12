// Sygnały formy do AI Insight — warstwa interpretacyjna, o której insight ma MÓWIĆ
// (a nie recytować liczb z kafli). Czyste funkcje, testowalne bez I/O. Route dostarcza
// dane (fitness_metrics + recent rides), tu tylko liczymy.
import { createHash } from 'node:crypto';
import type { PlannedWorkout } from '@/lib/ai/insight';

export interface RecentRide {
  activity_date: string;
  normalized_power: number | null;
  avg_hr: number | null;
  tss: number | null;
}

export interface CurrentRide {
  normalized_power: number | null;
  avg_hr: number | null;
  tss: number | null;
  duration_seconds: number | null;
  details_synced_at: string | null;
}

export interface FitnessTrend {
  ctlNow: number | null;
  ctl7ago: number | null;
  tsbNow: number | null;
}

// Efektywność aerobowa = NP/HR. Rośnie, gdy przy tej samej mocy tętno spada (forma ↑).
export function efValue(np: number | null, hr: number | null): number | null {
  if (np == null || hr == null || hr <= 0) return null;
  return np / hr;
}

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Gotowe sygnały (każdy opcjonalny — null gdy brak HR/mocy/historii/e-bike).
export interface FormSignals {
  trend: string | null;      // CTL/TSB 7d
  ef: string | null;         // EF bieżącej vs mediana 4–6 tyg
  hrAtPower: string | null;  // tętno przy podobnej mocy vs dziś
  ring: string | null;       // % wykonania celu dnia
}

const r1 = (n: number) => Math.round(n * 10) / 10;

// EF bieżącej vs mediana z okna (domyślnie ostatnie 42 dni jazd z NP i HR).
function efSignal(cur: CurrentRide, recent: RecentRide[]): string | null {
  const curEf = efValue(cur.normalized_power, cur.avg_hr);
  if (curEf == null) return null;
  // Okno ~6 tyg egzekwuje route (zakres selecta recent rides); tu bierzemy wszystkie z NP+HR.
  const efs = recent.map((r) => efValue(r.normalized_power, r.avg_hr)).filter((e): e is number => e != null);
  const med = median(efs);
  if (med == null || efs.length < 3) return null; // za mało historii → nie zgaduj trendu
  const deltaPct = Math.round(((curEf - med) / med) * 100);
  const dir = deltaPct > 3 ? `WYŻSZA o ${deltaPct}% (przy tej mocy tętno niższe = forma rośnie)`
    : deltaPct < -3 ? `NIŻSZA o ${Math.abs(deltaPct)}% (tętno wyższe niż zwykle — zmęczenie/upał/odwodnienie)`
    : 'na poziomie normy';
  return `Efektywność aerobowa (moc/tętno) ${r1(curEf * 100) / 100}: ${dir} (mediana z ~6 tyg: ${r1(med * 100) / 100}).`;
}

// Tętno przy podobnej mocy: jazdy z NP w paśmie ±8% bieżącej → mediana avg_hr → porównanie.
function hrAtPowerSignal(cur: CurrentRide, recent: RecentRide[]): string | null {
  if (cur.normalized_power == null || cur.avg_hr == null) return null;
  const lo = cur.normalized_power * 0.92;
  const hi = cur.normalized_power * 1.08;
  const hrs = recent
    .filter((r) => r.normalized_power != null && r.avg_hr != null && r.normalized_power >= lo && r.normalized_power <= hi)
    .map((r) => r.avg_hr as number);
  if (hrs.length < 2) return null; // za mało porównywalnych jazd
  const medHr = median(hrs);
  if (medHr == null) return null;
  const diff = Math.round(cur.avg_hr - medHr);
  const note = diff <= -3 ? `${Math.abs(diff)} bpm NIŻEJ niż zwykle przy tej mocy (dobra oznaka)`
    : diff >= 3 ? `${diff} bpm WYŻEJ niż zwykle (większy koszt tętna)`
    : 'jak zwykle przy tej mocy';
  return `Przy podobnej mocy (NP ~${cur.normalized_power}W) tętno dziś ${cur.avg_hr} bpm — ${note} (mediana z ~${hrs.length} jazd: ${Math.round(medHr)} bpm).`;
}

export function buildFormSignals(
  cur: CurrentRide,
  recent: RecentRide[],
  trend: FitnessTrend,
  pct: number | null,
  isEbike: boolean
): FormSignals {
  // Trend CTL/TSB — zawsze gdy są metryki (niezależny od mocy/HR).
  let trendStr: string | null = null;
  if (trend.ctlNow != null) {
    const delta = trend.ctl7ago != null ? r1(trend.ctlNow - trend.ctl7ago) : null;
    const dirTxt = delta == null ? '' : delta > 0.5 ? ` (rośnie +${delta}/tydzień)` : delta < -0.5 ? ` (spada ${delta}/tydzień)` : ' (stabilna)';
    const tsbTxt = trend.tsbNow != null ? `, TSB ${Math.round(trend.tsbNow)} (${trend.tsbNow > 5 ? 'świeżość' : trend.tsbNow < -15 ? 'głębokie zmęczenie' : 'produktywne zmęczenie'})` : '';
    trendStr = `Forma: CTL ${Math.round(trend.ctlNow)}${dirTxt}${tsbTxt}.`;
  }
  // EF i HR@moc — tylko z wiarygodną mocą (nie e-bike).
  const ef = isEbike ? null : efSignal(cur, recent);
  const hrAtPower = isEbike ? null : hrAtPowerSignal(cur, recent);
  const ring = pct != null ? `Wykonanie celu dnia z planu: ${Math.round(pct)}%.` : null;
  return { trend: trendStr, ef, hrAtPower, ring };
}

// Fingerprint wejść cache: zmiana details/planu/pct/kluczowych metryk → regeneracja.
export function insightFingerprint(args: {
  detailsSyncedAt: string | null;
  planned: PlannedWorkout | null;
  pct: number | null;
  tss: number | null;
  np: number | null;
  avgHr: number | null;
  durationSec: number | null;
}): string {
  const planKey = args.planned
    ? JSON.stringify([args.planned.type, args.planned.dur_min, args.planned.tss, args.planned.structure ?? null])
    : 'noplan';
  const payload = JSON.stringify({
    d: args.detailsSyncedAt ?? 'none',
    p: planKey,
    pct: args.pct == null ? 'none' : Math.round(args.pct), // kubełek 1% — mikro-drgania nie regenerują
    t: args.tss, np: args.np, hr: args.avgHr, dur: args.durationSec,
  });
  return createHash('sha256').update(payload).digest('hex');
}
