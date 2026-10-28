// VeloIQ – format "skryptu treningu" wykonywanego przez natywny RideEngine na telefonie.
// Serwer (AI) przygotowuje skrypt, telefon go tylko wykonuje: liczy średnie, sprawdza reguły i mówi.

export type StepType = 'warmup' | 'interval' | 'recovery' | 'steady' | 'cooldown';

export interface WorkoutStep {
  name: string;
  type: StepType;
  durationSec: number;
  powerLow: number;  // W
  powerHigh: number; // W
  cadenceLow?: number;
  cadenceHigh?: number;
  /** Własny komunikat na start kroku (np. wygenerowany przez AI). Nadpisuje domyślny. */
  cueStart?: string;
  /** 'auto' = interwał startuje, gdy zawodnik ruszy (wykrywanie po mocy); 'time' = z zegarem.
   *  Domyślnie: interwały ≥ 60 s (poza pierwszym krokiem) → 'auto'. */
  start?: 'auto' | 'time';
  /** Zakres tętna kroku (bpm). recovery: hrHigh = próg „zregenerowany”. Brak = bez komunikatów o tętnie. */
  hrLow?: number;
  hrHigh?: number;
}

export interface WorkoutRules {
  smoothingSec?: number;     // okno średniej do oceny (domyślnie 10)
  outOfRangeSec?: number;    // ile sekund poza zakresem zanim padnie korekta (8)
  cooldownSec?: number;      // minimalna przerwa między korektami (30)
  graceSec?: number;         // ile sekund od startu kroku bez korekt – czas na "wejście" (10)
  praiseAfterSec?: number;   // po ilu sekundach w zakresie pochwała, raz na krok (90)
  cadenceGraceSec?: number;  // ile sekund z kadencją poza zakresem przed uwagą (15)
  hrDriftBpm?: number;       // wzrost tętna vs 1. seria przy tej samej mocy, który zgłaszamy (5)
  // tryb elastyczny
  armLeadSec?: number;       // zapowiedź przed planowanym startem interwału (60)
  autoStartPct?: number;     // próg startu: ułamek dolnej granicy celu (0.85)
  autoStartSec?: number;     // ile sekund nad progiem = start (4)
  waitRemindSec?: number;    // przypomnienie, gdy przerwa się przeciąga (120)
  autoPauseWatts?: number;   // poniżej = postój (30)
  autoPauseSec?: number;     // ile sekund postoju = auto-pauza interwału (5)
  earlyStopPct?: number;     // spadek poniżej tego ułamka dolnej granicy = odpuszczam (0.6)
  earlyStopSec?: number;     // ile sekund = przerwanie interwału (15)
  effortStartPct?: number;   // jazda swobodna: start wysiłku, ułamek FTP (0.9)
  effortEndPct?: number;     // koniec wysiłku (0.75)
  effortMinSec?: number;     // minimalny wysiłek do zapisania (60)
  // korekty mocy liczone na średniej (nie na chwilowych skokach)
  corrWindowMinSec?: number; // okno średniej: długość kroku / 6, min (20)
  corrWindowMaxSec?: number; // … max (60)
  corrGraceMinSec?: number;  // bez korekt na starcie kroku: 10% kroku, min (20)
  corrGraceMaxSec?: number;  // … max (60)
  cooldownMaxSec?: number;   // przerwa między korektami: długość kroku / 4, max (180)
  deadbandW?: number;        // tolerancja poza zakresem, W (10)
  deadbandPct?: number;      // … albo % środka zakresu, co większe (0.03)
  minDeltaW?: number;        // mniejszych poprawek nie mówimy (10)
  earlyStopAvgSec?: number;  // przerwanie oceniane na średniej z N s (10)
  // tętno
  hrMarginBpm?: number;      // margines ponad zakres (3)
  hrAlertSec?: number;       // ile sekund ponad zakresem = komunikat (60)
  hrGraceSec?: number;       // bez uwag o tętnie na starcie kroku – tętno się dopiero ustala (240)
  hrCooldownSec?: number;    // przerwa między uwagami o tętnie (300)
  statusEverySec?: number;   // raport „średnia + tętno” w długich krokach co N s (600)
  statusMinStepSec?: number; // od jakiej długości kroku raporty (1200)
}

/** Szablony komunikatów. Placeholdery: {n} {total} {name} {dur} {low} {high} {avg} {pct} {delta} {cad} {cadLow} {cadHigh} */
export type PhraseKey =
  | 'intervalStart' | 'recoveryStart' | 'warmupStart' | 'steadyStart' | 'cooldownStart'
  | 'tooHigh' | 'tooLow' | 'recoveryTooHigh' | 'cadenceLow' | 'cadenceHigh'
  | 'half' | 'lastMinute' | 'praise' | 'intervalEnd' | 'hrDrift'
  | 'powerLost' | 'powerBack' | 'hrLost' | 'hrBack'
  | 'armNext' | 'tenSec' | 'goNow' | 'waiting' | 'autoStart' | 'restInfo' | 'autoPause' | 'autoResume'
  | 'earlyStop' | 'seriesEnd' | 'seriesPrev' | 'hrUp' | 'planDone' | 'freeStart' | 'effort'
  | 'hrHigh' | 'hrRecovered' | 'status' | 'readiness' | 'condition' | 'count' | 'drink' | 'eat';

export interface WorkoutScript {
  version: 1;
  id: string;
  name: string;
  ftp: number;
  lang?: string; // 'pl-PL'
  steps: WorkoutStep[];
  rules?: WorkoutRules;
  phrases?: Partial<Record<PhraseKey, string>>;
  /** Odprawa na rozgrzewce: gotowość z PMC i model tętna (HR = hrA + hrB·W) z ostatnich jazd. */
  briefing?: RideBriefing;
}

export interface RideBriefing {
  readiness?: number;                    // 0–100 (jak pierścień na pulpicie)
  readyColor?: 'green' | 'yellow' | 'red';
  readyState?: string;                   // „Dobra gotowość”…
  yTss?: number;                         // TSS wczoraj
  hrA?: number; hrB?: number;            // oczekiwane tętno przy mocy W: hrA + hrB·W
}

// ---------- Builder: z prostego opisu planu (procenty FTP) na skrypt w watach ----------

export interface PlanBlock {
  name?: string;
  type: StepType;
  minutes: number;
  pctLow: number;  // % FTP
  pctHigh: number; // % FTP
  cadence?: [number, number];
  cue?: string;
  start?: 'auto' | 'time';
}

export function repeatSet(times: number, work: PlanBlock, rest: PlanBlock, skipLastRest = true): PlanBlock[] {
  const out: PlanBlock[] = [];
  for (let i = 0; i < times; i++) {
    out.push(work);
    if (!(skipLastRest && i === times - 1)) out.push(rest);
  }
  return out;
}

export function buildWorkoutScript(opts: {
  id: string;
  name: string;
  ftp: number;
  blocks: PlanBlock[];
  rules?: WorkoutRules;
  phrases?: WorkoutScript['phrases'];
}): WorkoutScript {
  const w = (pct: number) => Math.round((opts.ftp * pct) / 100 / 5) * 5;
  return {
    version: 1,
    id: opts.id,
    name: opts.name,
    ftp: opts.ftp,
    lang: 'pl-PL',
    rules: opts.rules,
    phrases: opts.phrases,
    steps: opts.blocks.map((b) => ({
      name: b.name ?? b.type,
      type: b.type,
      durationSec: Math.round(b.minutes * 60),
      powerLow: w(b.pctLow),
      powerHigh: w(b.pctHigh),
      cadenceLow: b.cadence?.[0],
      cadenceHigh: b.cadence?.[1],
      cueStart: b.cue,
      start: b.start,
    })),
  };
}

export function validateWorkoutScript(s: WorkoutScript): string[] {
  const errors: string[] = [];
  if (s.version !== 1) errors.push('version must be 1');
  // pusta lista kroków = jazda swobodna (samo nagrywanie + wykrywanie wysiłków)
  s.steps?.forEach((st, i) => {
    if (st.durationSec <= 0) errors.push(`step ${i}: durationSec <= 0`);
    if (st.powerLow > st.powerHigh) errors.push(`step ${i}: powerLow > powerHigh`);
    if (st.cadenceLow && st.cadenceHigh && st.cadenceLow > st.cadenceHigh) errors.push(`step ${i}: cadenceLow > cadenceHigh`);
  });
  return errors;
}
