// Generator testów zgodności: ten sam przebieg jazdy przechodzi przez silnik referencyjny
// (lib/ride/flex-engine.ts – ten, który działa w telefonie) i wynik (komunikaty, serie, wysiłki,
// lapy, podsumowanie) trafia jako oczekiwane dane do testów Monkey C silnika na Garmina.
//
//   npx -y tsx garmin/ci/parity/gen.ts > garmin/source/tests/ParityData.mc
//
// Testy uruchamia CI w symulatorze Connect IQ (garmin/ci/build.sh).

import { FlexEngine } from '../../../lib/ride/flex-engine';
import type { WorkoutScript, WorkoutStep } from '../../../lib/ride/workout-script';

type StepArr = [string, number, number, number, number, number, number, number, number, number];
// [czas s, moc W, kadencja (-1 = brak czujnika), tętno (0 = brak), szum 0/1]
type Seg = [number, number, number, number, number];
type Action = [number, 'skip' | 'cancel'];

interface Scenario { id: string; ftp: number; steps: StepArr[]; segs: Seg[]; actions?: Action[] }

const TYPES = ['warmup', 'interval', 'recovery', 'steady', 'cooldown'] as const;
const W = 0, I = 1, R = 2, S = 3, C = 4;

const st = (name: string, type: number, dur: number, lo: number, hi: number, cadLo = 0, cadHi = 0, start = 0, hrLo = 0, hrHi = 0): StepArr =>
  [name, type, dur, lo, hi, cadLo, cadHi, start, hrLo, hrHi];

const scenarios: Scenario[] = [
  {
    // Klasyczne 2×8 min: start pierwszego 20 s po czasie, drugi za mocno (korekta), przerwa krótsza niż plan
    id: 'Threshold2x8', ftp: 300,
    steps: [st('Rozgrzewka', W, 300, 150, 195), st('Interwał 1', I, 480, 290, 310), st('Przerwa', R, 240, 120, 180, 0, 0, 0, 0, 132),
      st('Interwał 2', I, 480, 290, 310), st('Schłodzenie', C, 300, 135, 165)],
    segs: [[320, 170, 88, 120, 1], [480, 301, 92, 165, 1], [200, 140, 85, 128, 1], [480, 336, 94, 172, 1], [310, 145, 80, 125, 1]],
  },
  {
    // Falstart (zryw i postój), potem prawdziwy start; w interwale postój na światłach (auto-pauza)
    id: 'FalstartAutoPause', ftp: 300,
    steps: [st('Rozgrzewka', W, 240, 150, 195), st('Interwał 1', I, 300, 285, 315), st('Przerwa', R, 180, 120, 180), st('Interwał 2', I, 300, 285, 315),
      st('Schłodzenie', C, 120, 135, 165)],
    segs: [[200, 165, 88, 118, 1], [9, 320, 95, 130, 0], [22, 0, 0, 128, 0], [40, 150, 85, 122, 1], [150, 300, 92, 160, 1], [12, 0, 0, 150, 0],
      [152, 302, 92, 166, 1], [185, 140, 84, 130, 1], [305, 298, 91, 168, 1], [130, 150, 80, 128, 1]],
  },
  {
    // Odpuszczenie w trakcie interwału (wcześniejsze przerwanie) i ręczne „następny krok”
    id: 'EarlyStopSkip', ftp: 280,
    steps: [st('Rozgrzewka', W, 180, 140, 180), st('Interwał 1', I, 360, 270, 290), st('Przerwa', R, 180, 110, 170), st('Interwał 2', I, 360, 270, 290),
      st('Przerwa', R, 180, 110, 170), st('Interwał 3', I, 360, 270, 290), st('Schłodzenie', C, 180, 125, 155)],
    segs: [[190, 160, 86, 115, 1], [200, 281, 90, 160, 1], [120, 120, 80, 140, 1], [130, 130, 82, 132, 1], [365, 262, 89, 163, 1], [100, 135, 82, 135, 1],
      [200, 280, 90, 165, 1], [300, 140, 80, 130, 1]],
    actions: [[1150, 'skip'], [1360, 'skip']],
  },
  {
    // Over-under (interwały łańcuchowe, zmiana z zegarem) + kadencja poza zakresem + ręczny falstart
    id: 'OverUnder', ftp: 300,
    steps: [st('Rozgrzewka', W, 120, 150, 195), st('Under 1.1', I, 120, 276, 294, 85, 95), st('Over 1.1', I, 60, 306, 324, 85, 95, 2),
      st('Under 1.2', I, 120, 276, 294, 85, 95, 2), st('Over 1.2', I, 60, 306, 324, 85, 95, 2), st('Przerwa', R, 120, 120, 180),
      st('Under 2.1', I, 120, 276, 294), st('Over 2.1', I, 60, 306, 324, 0, 0, 2), st('Schłodzenie', C, 120, 135, 165)],
    segs: [[125, 170, 88, 120, 1], [120, 285, 78, 150, 1], [60, 316, 78, 160, 1], [120, 284, 90, 158, 1], [60, 315, 92, 166, 1],
      [70, 150, 85, 140, 1], [10, 300, 90, 140, 0], [30, 150, 85, 138, 1], [20, 150, 85, 135, 1], [185, 290, 90, 160, 1], [140, 150, 80, 130, 1]],
    actions: [[564, 'cancel']],
  },
  {
    // Długi blok w strefie z tętnem ponad zakresem (uwaga o tętnie, raporty co 10 min) i sprinty
    id: 'SteadyHrSprints', ftp: 300,
    steps: [st('Rozgrzewka', W, 300, 150, 195, 0, 0, 0, 0, 142), st('Endurance', S, 1500, 195, 225, 0, 0, 2, 129, 149), st('Sprint 1', I, 12, 600, 1100),
      st('Przerwa', R, 150, 120, 180, 0, 0, 0, 0, 132), st('Sprint 2', I, 12, 600, 1100), st('Schłodzenie', C, 300, 135, 165, 0, 0, 0, 0, 136)],
    segs: [[300, 172, 88, 125, 1], [600, 212, 88, 146, 1], [900, 214, 88, 156, 1], [40, 215, 88, 156, 1], [13, 820, 110, 160, 0], [140, 140, 80, 150, 1],
      [14, 790, 112, 165, 0], [320, 148, 80, 130, 1]],
  },
  {
    // Jazda swobodna: wysiłek z chwilowym odpuszczeniem (jeden), krótki zryw (pomijany), wysiłek trwający do końca
    id: 'FreeRideEfforts', ftp: 300,
    steps: [],
    segs: [[300, 180, 85, 120, 1], [140, 305, 90, 160, 1], [20, 235, 88, 162, 1], [100, 300, 90, 166, 1], [180, 150, 80, 135, 1], [50, 340, 95, 150, 1],
      [200, 160, 82, 132, 1], [400, 290, 90, 165, 1], [70, 60, 0, 140, 0], [30, 0, 0, 120, 0], [260, 200, 85, 130, 1], [150, 310, 92, 168, 1]],
  },
  {
    // Bez czujnika kadencji i tętna, przerwa przeciągnięta (przypomnienia „czekam”), po planie wysiłek w jeździe swobodnej
    id: 'NoSensorsWaiting', ftp: 250,
    steps: [st('Rozgrzewka', W, 200, 125, 160), st('Interwał 1', I, 240, 240, 260), st('Przerwa', R, 120, 100, 150), st('Interwał 2', I, 240, 240, 260)],
    segs: [[195, 140, -1, 0, 1], [245, 251, -1, 0, 1], [400, 110, -1, 0, 1], [240, 250, -1, 0, 1], [100, 120, -1, 0, 1], [200, 245, -1, 0, 1], [120, 100, -1, 0, 1]],
  },
];

const noise = (i: number) => ((i * 7919) % 11) - 5;

function run(sc: Scenario) {
  const steps: WorkoutStep[] = sc.steps.map((a) => ({
    name: a[0], type: TYPES[a[1]], durationSec: a[2], powerLow: a[3], powerHigh: a[4],
    ...(a[5] ? { cadenceLow: a[5] } : {}), ...(a[6] ? { cadenceHigh: a[6] } : {}),
    ...(a[7] ? { start: a[7] === 1 ? 'auto' as const : 'time' as const } : {}),
    ...(a[8] ? { hrLow: a[8] } : {}), ...(a[9] ? { hrHigh: a[9] } : {}),
  }));
  const script: WorkoutScript = { version: 1, id: sc.id, name: sc.id, ftp: sc.ftp, lang: 'pl-PL', steps };
  const eng = new FlexEngine(script);
  let i = 0;
  for (const [dur, pw, cad, hr, nz] of sc.segs) {
    for (let k = 0; k < dur; k++, i++) {
      const p = pw > 0 ? Math.max(0, pw + (nz ? noise(i) : 0)) : 0;
      eng.tick({ p, hr: hr > 0 ? hr : null, cad: cad >= 0 ? cad : null });
      for (const [at, what] of sc.actions ?? []) {
        if (at === i) { if (what === 'skip') eng.skipStep(); else eng.cancelStart(); }
      }
    }
  }
  return eng;
}

const q = (s: string) => JSON.stringify(s);
const VRD: Record<string, number> = { ok: 0, high: 1, low: 2 };

const out: string[] = [];
out.push('// PLIK GENEROWANY – nie edytuj ręcznie. Źródło: garmin/ci/parity/gen.ts (silnik referencyjny lib/ride/flex-engine.ts).');
out.push('import Toybox.Lang;');
out.push('import Toybox.Test;');
out.push('');
for (const sc of scenarios) {
  const eng = run(sc);
  const sum = eng.summary();
  const cues = eng.cues.map((c) => `${c.s}, ${q(c.key ?? '')}`);
  const series = eng.series.map((x) => `[${x.n}, ${x.durationSec}, ${x.plannedSec}, ${x.avgPower}, ${x.compliancePct}, ${x.startSec}, ${VRD[x.verdict ?? 'ok']}, ${x.deltaW ?? 0}, ${x.endedEarly ? 1 : 0}, ${x.restBeforeSec ?? -1}, ${x.avgHr ?? -1}]`);
  const efforts = sum.efforts.map((e) => `[${e.startSec}, ${e.durationSec}, ${e.avgPower}]`);
  const laps = eng.laps.map((l) => `${l.startSec}, ${q(l.type)}`);
  out.push('(:test)');
  out.push(`function testParity${sc.id}(logger as Test.Logger) as Boolean {`);
  out.push('    return ParityRun.check(logger,');
  out.push(`        ${sc.ftp},`);
  out.push(`        [${sc.steps.map((a) => `[${q(a[0])}, ${a.slice(1).join(', ')}]`).join(',\n         ')}],`);
  out.push(`        [${sc.segs.map((a) => `[${a.join(', ')}]`).join(', ')}],`);
  out.push(`        [${(sc.actions ?? []).map((a) => `${a[0]}, ${a[1] === 'skip' ? 1 : 2}`).join(', ')}],`);
  out.push(`        [${cues.join(', ')}],`);
  out.push(`        [${series.join(',\n         ')}],`);
  out.push(`        [${efforts.join(', ')}],`);
  out.push(`        [${laps.join(', ')}],`);
  out.push(`        [${sum.durationSec}, ${sum.avgPower}, ${sum.normalizedPower}, ${sum.kJ}, ${sum.compliancePct}, ${sum.avgHr ?? 0}, ${sum.maxHr ?? 0}]);`);
  out.push('}');
  out.push('');
  process.stderr.write(`${sc.id}: ${eng.cues.length} komunikatów, ${eng.series.length} serii, ${sum.efforts.length} wysiłków, ${eng.laps.length} lapów\n`);
  process.stderr.write('   ' + eng.cues.map((c) => `${c.s}:${c.key}`).join(' ') + '\n');
}
process.stdout.write(out.join('\n'));
