// Adapter: dzień z planu VeloIQ (weekly_plans.plan_json.days[]) → skrypt treningu dla RideEngine.
// Jedno źródło prawdy z resztą aplikacji: dni ze `structure` budujemy Z PARAMETRÓW (te same waty
// co w rozpisce/profilu planu), stare dni bez structure — z profilu buildWorkout().expanded.

import type { PlanDayRow } from '@/lib/planned-day';
import { buildWorkout, sessionStructure } from '@/lib/workout';
import { isOU } from '@/lib/structure';
import type { StepType, WorkoutScript, WorkoutStep } from './workout-script';

const TOL = 0.03; // ±3% wokół wata z planu = zakres, w którym silnik nie koryguje

const TYPE_NAMES: Record<string, string> = { Z1: 'Regeneracja', Z2: 'Z2', LONG: 'Długa jazda', SST: 'Sweet Spot', THR: 'Threshold', OU: 'Over-Under', VO2: 'VO2max' };

function step(name: string, type: StepType, min: number, lo: number, hi: number, start?: 'auto' | 'time'): WorkoutStep {
  return { name, type, durationSec: Math.round(min * 60), powerLow: Math.round(lo), powerHigh: Math.round(hi), ...(start ? { start } : {}) };
}
const around = (w: number) => [w * (1 - TOL), w * (1 + TOL)] as const;

/** null = dzień bez treningu (OFF / brak planu) → aplikacja proponuje jazdę swobodną. */
export function planDayToScript(day: PlanDayRow | null | undefined, ftp: number, id: string): WorkoutScript | null {
  if (!day || day.type === 'OFF' || !(day.dur_min > 0)) return null;
  const pct = (p: number) => (ftp * p) / 100;
  const ss = sessionStructure(day.type);
  const wu = day.warmup ?? ss.warmupDefault;
  const cd = day.cooldown ?? ss.cooldownDefault;
  const steps: WorkoutStep[] = [];
  const warm = () => wu > 0 && steps.push(step('Rozgrzewka', 'warmup', wu, pct(50), pct(65)));
  const cool = () => cd > 0 && steps.push(step('Schłodzenie', 'cooldown', cd, pct(45), pct(55)));
  const rest = (min: number) => steps.push(step('Przerwa', 'recovery', min, pct(40), pct(60)));

  const s = day.structure;
  if (s) {
    warm();
    if (isOU(s)) {
      for (let b = 0; b < s.reps; b++) {
        for (let c = 0; c < s.cycles; c++) {
          const [ulo, uhi] = around(s.under_w);
          const [olo, ohi] = around(s.over_w);
          // w bloku OU tylko pierwszy "under" startuje automatycznie; reszta płynnie z zegarem
          steps.push(step(`Under ${b + 1}.${c + 1}`, 'interval', s.under_min, ulo, uhi, c === 0 ? undefined : 'time'));
          steps.push(step(`Over ${b + 1}.${c + 1}`, 'interval', s.over_min, olo, ohi, 'time'));
        }
        if (b < s.reps - 1) rest(s.rest_min);
      }
    } else {
      const [lo, hi] = around(s.work_w);
      for (let i = 0; i < s.reps; i++) {
        steps.push(step(`Interwał ${i + 1}`, 'interval', s.work_min, lo, hi));
        if (i < s.reps - 1) rest(s.rest_min);
      }
    }
    cool();
  } else {
    // Stare dni / typy jednolite: profil z buildWorkout (Z1/Z2/LONG i fallback interwałów).
    const { expanded } = buildWorkout({ type: day.type, label: day.label, dur_min: day.dur_min, warmup: day.warmup, cooldown: day.cooldown }, ftp);
    let n = 0;
    for (const e of expanded) {
      const w = e.watts ?? pct(e.pctFtp);
      if (e.kind === 'warmup') steps.push(step('Rozgrzewka', 'warmup', e.min, pct(50), pct(65)));
      else if (e.kind === 'cooldown') steps.push(step('Schłodzenie', 'cooldown', e.min, pct(45), pct(55)));
      else if (e.kind === 'rest') rest(e.min);
      else if (e.kind === 'steady') {
        const z = day.type === 'Z1' ? [45, 55] : e.pctFtp >= 76 ? [76, 85] : day.type === 'LONG' ? [56, 72] : [56, 75];
        steps.push(step(e.pctFtp >= 76 ? 'Akcent Z3' : TYPE_NAMES[day.type] ?? 'Jazda', 'steady', e.min, pct(z[0]), pct(z[1]), 'time'));
      } else if (e.label) {
        // zgrupowany blok (>8 powtórzeń bez structure) – jedziemy go jako jeden równy krok
        const [lo, hi] = around(w);
        steps.push(step(e.label, 'steady', e.min, lo, hi, 'time'));
      } else {
        const [lo, hi] = around(w);
        n++;
        steps.push(step(e.kind === 'work' ? `Interwał ${n}` : e.kind === 'over' ? 'Over' : 'Under', 'interval', e.min, lo, hi,
          e.kind === 'over' ? 'time' : undefined));
      }
    }
  }

  return { version: 1, id, name: day.label || TYPE_NAMES[day.type] || day.type, ftp, lang: 'pl-PL', steps };
}
