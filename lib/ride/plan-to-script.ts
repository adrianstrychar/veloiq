// Adapter: dzień z planu VeloIQ (weekly_plans.plan_json.days[]) → skrypt treningu dla RideEngine.
// Jedno źródło prawdy z resztą aplikacji: dni ze `structure` budujemy Z PARAMETRÓW (te same waty
// co w rozpisce/profilu planu), stare dni bez structure — z profilu buildWorkout().expanded.

import type { PlanDayRow } from '@/lib/planned-day';
import { buildWorkout, sessionStructure, blockStepKind } from '@/lib/workout';
import { isOU, isBlocks, type BlockStep } from '@/lib/structure';
import type { StepType, WorkoutScript, WorkoutStep } from './workout-script';

const TOL = 0.03; // ±3% wokół wata z planu = zakres, w którym silnik nie koryguje

const TYPE_NAMES: Record<string, string> = { Z1: 'Regeneracja', Z2: 'Z2', LONG: 'Długa jazda', SST: 'Sweet Spot', THR: 'Threshold', OU: 'Over-Under', VO2: 'VO2max' };

function step(name: string, type: StepType, min: number, lo: number, hi: number, start?: 'auto' | 'time'): WorkoutStep {
  return { name, type, durationSec: Math.round(min * 60), powerLow: Math.round(lo), powerHigh: Math.round(hi), ...(start ? { start } : {}) };
}
const around = (w: number) => [w * (1 - TOL), w * (1 + TOL)] as const;

/** null = dzień bez treningu (OFF / brak planu) → aplikacja proponuje jazdę swobodną. */
/** Zakres tętna kroku jako ułamek HRmax: [dół, góra]. Interwały – bez (tam decyduje moc, tętno się spóźnia). */
function hrShare(st: WorkoutStep, ftp: number): [number | undefined, number] | null {
  if (st.type === 'warmup') return [undefined, 0.75];
  if (st.type === 'cooldown') return [undefined, 0.72];
  if (st.type === 'recovery') return [undefined, 0.7]; // próg „zregenerowany”
  if (st.type !== 'steady') return null;
  const pct = (st.powerLow + st.powerHigh) / 2 / ftp;
  return pct < 0.56 ? [undefined, 0.68] : pct < 0.76 ? [0.68, 0.79] : pct < 0.88 ? [0.79, 0.87] : pct < 0.95 ? [0.84, 0.91] : null;
}

/** Tętno do kroków: z HRmax zawodnika, a bez niego – z zakresu dnia w planie (tylko jazda w strefie). */
function addHr(steps: WorkoutStep[], ftp: number, hrmax?: number | null, dayHr?: string) {
  const m = /(\d{2,3})\s*[–-]\s*(\d{2,3})/.exec(dayHr ?? '');
  for (const st of steps) {
    const sh = hrShare(st, ftp);
    if (!sh) continue;
    if (hrmax && hrmax > 120) {
      if (sh[0]) st.hrLow = Math.round(hrmax * sh[0]);
      st.hrHigh = Math.round(hrmax * sh[1]);
    } else if (m && st.type === 'steady' && (st.powerLow + st.powerHigh) / 2 / ftp < 0.76) {
      st.hrLow = +m[1]; st.hrHigh = +m[2];
    }
  }
}

export function planDayToScript(day: PlanDayRow | null | undefined, ftp: number, id: string, hrmax?: number | null): WorkoutScript | null {
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
    if (isBlocks(s)) {
      // Bloki: każdy krok 1:1 (sekundy, waty, kadencja). Rodzaj kroku z %FTP — ta sama klasyfikacja
      // co w profilu planu (blockStepKind), więc głos mówi o tym, co zawodnik widzi w rozpisce.
      let n = 0;
      let prevWork = false;
      for (const b of s.blocks) {
        const total = b.repeat;
        for (let r = 0; r < b.repeat; r++) {
          b.steps.forEach((st: BlockStep, j) => {
            const kind = blockStepKind((st.w / ftp) * 100);
            const suffix = total > 1 ? ` ${r + 1}/${total}` : '';
            const cad = st.cad ? { cadenceLow: st.cad[0], cadenceHigh: st.cad[1] } : {};
            if (kind === 'rest') {
              steps.push({ ...step(st.name ?? 'Przerwa', 'recovery', st.sec / 60, pct(40), Math.max(pct(60), st.w * 1.05)), ...cad });
              prevWork = false;
            } else if (kind === 'steady') {
              steps.push({ ...step(st.name ?? TYPE_NAMES[day.type] ?? 'Jazda', 'steady', st.sec / 60, st.w * 0.93, st.w * 1.06, 'time'), ...cad });
              prevWork = false;
            } else {
              n++;
              // Sprint (<30 s) = wysiłek maksymalny: brak górnej granicy w praktyce, żeby głos nie
              // krzyczał "za mocno" przy 900 W, gdy plan mówi 700 W.
              const short = st.sec < 30;
              const lo = short ? st.w * 0.85 : st.w * (1 - TOL);
              const hi = short ? st.w * 1.6 : st.w * (1 + TOL);
              const name = `${st.name ?? b.name ?? 'Interwał'}${st.name || b.name ? suffix : ` ${n}`}`;
              // praca tuż po pracy (piramida, 40/20 bez przerwy) idzie z zegarem, nie czeka na start
              steps.push({ ...step(name, 'interval', st.sec / 60, lo, hi, prevWork || j > 0 ? 'time' : undefined), ...cad });
              prevWork = true;
            }
          });
        }
      }
    } else if (isOU(s)) {
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
      // WorkStructure (N równych interwałów)
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

  addHr(steps, ftp, hrmax, day.hr);
  return { version: 1, id, name: day.label || TYPE_NAMES[day.type] || day.type, ftp, lang: 'pl-PL', steps };
}
