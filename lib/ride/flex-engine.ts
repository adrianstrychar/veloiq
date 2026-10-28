// VeloIQ – silnik treningu w trybie ELASTYCZNYM (referencja logiki; 1:1 portowana do Swift WorkoutEngine).
//
// Różnica względem sztywnego zegara: interwały ze startem "auto" nie odpalają się z zegarem.
// Silnik zapowiada je (T-60 s), czuwa i wykrywa faktyczny start po mocy – cofając początek do pierwszej
// sekundy wzrostu. Plan przesuwa się razem z zawodnikiem. Dodatkowo: auto-pauza (postój w interwale),
// wykrywanie wcześniejszego przerwania, podsumowania serii i przerw, a po planie – jazda swobodna
// z automatycznym wykrywaniem wysiłków. Deterministyczny: tick() = jedna sekunda.

import type { WorkoutScript, WorkoutStep } from './workout-script';

export interface Sample { p?: number | null; hr?: number | null; cad?: number | null }
export interface Cue { s: number; text: string; kind: CueKind; key?: string; vars?: Record<string, string | number> }
export type CueKind = 'step' | 'arm' | 'countdown' | 'correction' | 'cadence' | 'info' | 'praise' | 'summary' | 'pause' | 'effort';
export type Phase = 'running' | 'armed' | 'waiting' | 'autoPaused' | 'free';

export interface SeriesResult {
  n: number; durationSec: number; plannedSec: number; avgPower: number; compliancePct: number;
  avgHr?: number; endedEarly: boolean; restBeforeSec?: number; startSec: number;
}
export interface Effort { startSec: number; durationSec: number; avgPower: number }

export interface FlexRules {
  armLeadSec: number;       // zapowiedź przed planowanym startem (60)
  autoStartPct: number;     // próg startu: % dolnej granicy celu (0.85)
  autoStartSec: number;     // ile sekund nad progiem = start (4)
  waitRemindSec: number;    // przypomnienie, gdy przerwa się przeciąga (120)
  autoPauseWatts: number;   // poniżej = "stoję" (30)
  autoPauseSec: number;     // ile sekund postoju = auto-pauza (5)
  resumeSec: number;        // ile sekund nad progiem = wznowienie (2)
  earlyStopPct: number;     // spadek poniżej % dolnej granicy = odpuszczam (0.6)
  earlyStopSec: number;     // ile sekund = przerwanie interwału (15)
  effortStartPct: number;   // jazda swobodna: start wysiłku, % FTP (0.9)
  effortEndPct: number;     // koniec wysiłku (0.75)
  effortMinSec: number;     // minimalny wysiłek do zapisania (60)
  // reguły korekt (jak w trybie sztywnym)
  smoothingSec: number; outOfRangeSec: number; cooldownSec: number; graceSec: number;
  praiseAfterSec: number; cadenceGraceSec: number; hrDriftBpm: number;
  corrWindowMinSec: number; corrWindowMaxSec: number; corrGraceMinSec: number; corrGraceMaxSec: number;
  cooldownMaxSec: number; deadbandW: number; deadbandPct: number; minDeltaW: number; earlyStopAvgSec: number;
  hrMarginBpm: number; hrAlertSec: number; hrGraceSec: number; hrCooldownSec: number;
  statusEverySec: number; statusMinStepSec: number;
}

export const DEFAULT_FLEX_RULES: FlexRules = {
  armLeadSec: 60, autoStartPct: 0.85, autoStartSec: 6, waitRemindSec: 120,
  autoPauseWatts: 30, autoPauseSec: 5, resumeSec: 2, earlyStopPct: 0.6, earlyStopSec: 40, earlyStopAvgSec: 10,
  effortStartPct: 0.9, effortEndPct: 0.75, effortMinSec: 60,
  smoothingSec: 10, outOfRangeSec: 15, cooldownSec: 60, graceSec: 10, praiseAfterSec: 90, cadenceGraceSec: 20, hrDriftBpm: 5,
  corrWindowMinSec: 20, corrWindowMaxSec: 60, corrGraceMinSec: 20, corrGraceMaxSec: 60, cooldownMaxSec: 180,
  deadbandW: 10, deadbandPct: 0.03, minDeltaW: 10,
  hrMarginBpm: 3, hrAlertSec: 60, hrGraceSec: 240, hrCooldownSec: 300, statusEverySec: 600, statusMinStepSec: 1200,
};

export const FLEX_PHRASES: Record<string, string> = {
  armNext: 'Za minutę interwał {n} z {total}. {dur}, {low} do {high} watów. Zacznij, kiedy będziesz gotowy.',
  tenSec: 'Dziesięć sekund.',
  goNow: 'Możesz startować.',
  waiting: 'Czekam na start interwału {n}. Przerwa trwa już {rest}.',
  autoStart: 'Start! {dur}, trzymaj {low} do {high} watów.',
  restInfo: 'Przerwa trwała {rest}.',
  autoPause: 'Pauza interwału. Zostało {left}.',
  autoResume: 'Wznawiam. Zostało {left}.',
  earlyStop: 'Interwał przerwany po {done}.',
  seriesEnd: 'Seria {n} z {total} zrobiona. {dur}, średnio {avg} watów, {pct} procent w zakresie.',
  seriesPrev: 'Poprzednia {prev}.',
  hrUp: 'Tętno o {d} uderzeń wyżej niż w pierwszej serii.',
  intervalStart: 'Interwał {n} z {total}. {dur}, cel {low} do {high} watów. Start!',
  recoveryStart: 'Przerwa {dur}. Kręć luźno, poniżej {high} watów.',
  warmupStart: 'Rozgrzewka, {dur}. Spokojnie, {low} do {high} watów.',
  steadyStart: '{name}. {dur}, trzymaj {low} do {high} watów.',
  cooldownStart: 'Schłodzenie, {dur}. Luźno, poniżej {high} watów.',
  tooHigh: 'Za mocno. Odpuść {delta} watów.',
  tooLow: 'Za słabo. Dodaj {delta} watów.',
  recoveryTooHigh: 'To odpoczynek. Zejdź poniżej {high} watów.',
  cadenceLow: 'Kadencja {cad}. Podnieś do {cadLow}.',
  cadenceHigh: 'Kadencja {cad}. Zejdź do {cadHigh}.',
  half: 'Połowa. Średnio {avg} watów.',
  lastMinute: 'Ostatnia minuta. Trzymaj.',
  praise: 'Idealnie. Tak trzymaj.',
  planDone: 'Plan zrobiony. Serie: {list} watów. Nagrywam dalej – zakończ w aplikacji.',
  freeStart: 'Nagrywanie rozpoczęte. Jazda swobodna, wysiłki zapiszę automatycznie.',
  effort: 'Wysiłek {dur}, średnio {avg} watów.',
  hrHigh: 'Tętno {hr}, powyżej zakresu. Zwolnij trochę.',
  hrRecovered: 'Tętno spadło do {hr}. Jesteś gotowy.',
  status: 'Średnio {avg} watów.{hrTxt}',
  readiness: 'Gotowość dziś {pct} procent. {state}.',
  condition: 'Kondycja dziś {sign}{n}.',
  count: '{word}',
  drink: 'Pij! Kilka łyków.',
  eat: 'Czas na jedzenie – żel albo baton, popij.',
};

const QUIET_AFTER_STOP_SEC = 20;
const FUEL_DRINK_SEC = 1200;   // picie co 20 min
const BRIEF_READY_SEC = 150;   // gotowość: 2,5 min po starcie
const BRIEF_COND_FROM = 360;   // kondycja: okno 6.–10. minuty (tętno już się ustaliło)
const BRIEF_COND_SEC = 600; // cisza po postoju (światła, skrzyżowanie)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function durationPl(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  const form = (n: number, one: string, few: string, many: string) => {
    if (n === 1) return `1 ${one}`;
    const l = n % 10, l2 = n % 100;
    return `${n} ${l >= 2 && l <= 4 && !(l2 >= 12 && l2 <= 14) ? few : many}`;
  };
  if (m === 0) return form(s, 'sekunda', 'sekundy', 'sekund');
  if (s === 0) return form(m, 'minuta', 'minuty', 'minut');
  return `${form(m, 'minuta', 'minuty', 'minut')} ${form(s, 'sekunda', 'sekundy', 'sekund')}`;
}
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const render = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
const r5 = (v: number) => Math.max(5, Math.round(v / 5) * 5);
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export class FlexEngine {
  readonly rules: FlexRules;
  readonly phrases: Record<string, string>;
  readonly cues: Cue[] = [];
  onCue?: (c: Cue) => void;

  // historia 1 Hz
  readonly P: number[] = [];
  readonly HR: (number | null)[] = [];
  readonly CAD: (number | null)[] = [];
  s = -1;

  // stan kroku
  phase: Phase = 'running';
  stepIdx = 0;
  stepStartSec = 0;
  inStep = 0;                 // aktywne sekundy w kroku (bez auto-pauzy)
  stepSecs: number[] = [];    // aktywne sekundy kroku (indeksy do P)
  private startRun = 0; private startRunAt = 0; private startDips = 0; private lowRun = 0; private easeRun = 0; private resumeRun = 0;
  private outHigh = 0; private outLow = 0; private inRangeStreak = 0; private cadLowRun = 0; private cadHighRun = 0;
  private lastCorrection = -1e9;
  private spoke = new Set<string>();
  private lastRestSec?: number;

  readonly series: SeriesResult[] = [];
  readonly efforts: Effort[] = [];
  private inEffort = false; private effortStart = 0;
  private intervalNumbers: (number | null)[] = [];
  private intervalCount = 0;

  constructor(readonly script: WorkoutScript, rules: Partial<FlexRules> = {}) {
    const fromScript = Object.fromEntries(Object.entries(script.rules ?? {}).filter(([, v]) => v !== undefined));
    this.rules = { ...DEFAULT_FLEX_RULES, ...fromScript, ...rules } as FlexRules;
    this.phrases = { ...FLEX_PHRASES, ...(script.phrases ?? {}) };
    let n = 0;
    this.intervalNumbers = script.steps.map((st) => (st.type === 'interval' ? ++n : null));
    this.intervalCount = n;
    if (!script.steps.length) this.phase = 'free';
  }

  /** Czy interwał startuje automatycznie (wykrywanie po mocy). Pierwszy krok nigdy. */
  isAuto(idx: number): boolean {
    const st = this.script.steps[idx];
    if (!st || idx === 0 || st.type !== 'interval') return false;
    if (st.start) return st.start === 'auto';
    return st.durationSec >= 60;
  }

  get step(): WorkoutStep | undefined { return this.script.steps[this.stepIdx]; }

  /** Ręczne przejście do następnego kroku (przycisk w aplikacji). */
  skipStep(speak = true) {
    if (this.phase === 'free') return;
    if (this.step?.type === 'interval') this.closeInterval(false, speak);
    const next = this.stepIdx + 1;
    this.enterStep(next, this.s + 1, 0, speak);
    // ręczny start auto-interwału ("Start teraz") – enterStep go nie zapowiada
    if ((this.phase as Phase) !== 'free' && this.isAuto(next)) {
      const st = this.script.steps[next];
      this.say('autoStart', { dur: durationPl(st.durationSec), low: st.powerLow, high: st.powerHigh }, 'step', speak);
    }
  }

  // ------------------------------------------------------------------ główna pętla
  tick(sample: Sample, speak = true) {
    const s = ++this.s;
    const p = Math.max(0, sample.p ?? 0);
    this.P.push(p); this.HR.push(sample.hr ?? null); this.CAD.push(sample.cad ?? null);

    if (s === 0) {
      if (this.phase === 'free') this.say('freeStart', {}, 'info', speak);
      else this.announceStep(0, speak);
    }
    this.briefingTick(s, speak);
    this.fuelTick(s, speak);
    if (this.phase === 'free') return this.freeTick(s, p, speak);

    const st = this.step!;
    const autoInterval = st.type === 'interval' && this.isAuto(this.stepIdx);
    const cad = sample.cad ?? null;
    if (p < this.rules.autoPauseWatts && (cad === null || cad === 0)) this.quietUntil = s + QUIET_AFTER_STOP_SEC;

    // --- interwał: auto-pauza i wznowienie; elastyczny dodatkowo wcześniejsze przerwanie
    if (st.type === 'interval' && st.durationSec >= 60) {
      const low = st.powerLow;
      if (this.phase === 'autoPaused') {
        this.resumeRun = p >= low * this.rules.autoStartPct ? this.resumeRun + 1 : 0;
        if (this.resumeRun < this.rules.resumeSec) return;
        this.phase = 'running';
        // sekundy rozbiegu wliczamy do interwału
        for (let k = this.rules.resumeSec - 1; k >= 1; k--) { this.stepSecs.push(s - k); this.inStep++; }
        this.say('autoResume', { left: durationPl(st.durationSec - this.inStep) }, 'pause', speak);
      } else {
        const stopped = p < this.rules.autoPauseWatts && (cad === null || cad === 0);
        this.lowRun = stopped ? this.lowRun + 1 : 0;
        if (this.lowRun >= this.rules.autoPauseSec && st.durationSec - this.inStep > 0) {
          // poprzednie sekundy postoju nie liczą się do interwału
          const back = this.rules.autoPauseSec - 1;
          this.stepSecs.splice(this.stepSecs.length - back, back);
          this.inStep -= back;
          this.phase = 'autoPaused'; this.lowRun = 0; this.resumeRun = 0; this.easeRun = 0;
          this.say('autoPause', { left: durationPl(st.durationSec - this.inStep) }, 'pause', speak);
          return;
        }
        const easeAvg = mean(this.P.slice(-this.rules.earlyStopAvgSec));
        const easing = autoInterval && !stopped && easeAvg < low * this.rules.earlyStopPct;
        this.easeRun = easing ? this.easeRun + 1 : 0;
        if (this.easeRun >= this.rules.earlyStopSec && st.durationSec - this.inStep > 20) {
          const back = this.rules.earlyStopSec - 1;
          this.stepSecs.splice(this.stepSecs.length - back, back);
          this.inStep -= back;
          this.say('earlyStop', { done: durationPl(this.inStep) }, 'info', speak);
          this.closeInterval(true, speak);
          this.enterStep(this.stepIdx + 1, s - back, back + 1, speak);
          return;
        }
      }
    }

    this.inStep++;
    this.stepSecs.push(s);
    const remaining = st.durationSec - this.inStep;
    const nextAuto = this.stepIdx + 1 < this.script.steps.length && this.isAuto(this.stepIdx + 1);
    const armed = nextAuto && remaining < this.rules.armLeadSec;
    if (this.phase !== 'autoPaused') this.phase = nextAuto && remaining < 0 ? 'waiting' : armed ? 'armed' : 'running';

    this.structuralCues(st, remaining, nextAuto, speak);
    if (!armed) this.corrections(st, s, p, cad, remaining, speak);
    this.hrCoach(st, s, remaining, speak);

    // --- czuwanie: wykrycie startu kolejnego interwału
    // (przy krótkiej przerwie nie łapiemy "rozpędu" z poprzedniego interwału jako nowego startu)
    const minRest = Math.min(20, Math.floor(st.durationSec / 2));
    if (nextAuto && remaining < this.rules.armLeadSec && this.inStep > minRest) {
      const next = this.script.steps[this.stepIdx + 1];
      const thr = next.powerLow * this.rules.autoStartPct;
      // seria sekund nad progiem; jedna krótka "dziura" (szum pomiaru) nie przerywa serii
      if (p >= thr) {
        if (this.startRun === 0) { this.startRunAt = s; this.startDips = 0; }
        this.startRun++;
      } else if (this.startRun > 0 && this.startDips === 0) {
        this.startDips = 1;
      } else {
        this.startRun = 0; this.startDips = 0;
      }
      if (this.startRun >= this.rules.autoStartSec) {
        const startSec = this.startRunAt;
        this.lastRestSec = startSec - this.stepStartSec;
        const plannedRest = st.durationSec;
        const n = s - startSec + 1;
        this.enterStep(this.stepIdx + 1, startSec, n, false);
        const vars = { dur: durationPl(next.durationSec), low: next.powerLow, high: next.powerHigh };
        let text = render(this.phrases.autoStart, vars);
        if (st.type === 'recovery' && Math.abs(this.lastRestSec - plannedRest) > 20) {
          text += ' ' + render(this.phrases.restInfo, { rest: durationPl(this.lastRestSec) });
        }
        this.emit(text, 'step', speak, 'autoStart', vars);
        return;
      }
      if (remaining < 0 && (-remaining) % this.rules.waitRemindSec === 0) {
        this.say('waiting', { n: this.intervalNumbers[this.stepIdx + 1] ?? 0, rest: durationPl(this.inStep) }, 'info', speak);
      }
      return; // krok przed auto-interwałem nie kończy się z zegarem
    }

    // --- przejście z zegarem
    if (remaining <= 0) {
      if (st.type === 'interval') this.closeInterval(false, speak);
      this.enterStep(this.stepIdx + 1, s + 1, 0, speak);
    }
  }

  // ------------------------------------------------------------------ kroki
  private enterStep(idx: number, startSec: number, pre: number, speak: boolean) {
    if (idx >= this.script.steps.length) return this.planDone(speak);
    this.stepIdx = idx; this.stepStartSec = startSec; this.inStep = pre;
    this.stepSecs = []; for (let k = 0; k < pre; k++) this.stepSecs.push(startSec + k);
    this.startRun = 0; this.startDips = 0; this.lowRun = 0; this.easeRun = 0; this.resumeRun = 0;
    this.outHigh = 0; this.outLow = 0; this.inRangeStreak = 0; this.cadLowRun = 0; this.cadHighRun = 0;
    this.lastCorrection = -1e9; this.spoke.clear(); this.hrHighRun = 0; this.hrRecStart = null;
    this.corrRepeat = 0; this.lastCorrDir = 0;
    this.phase = 'running';
    if (!this.isAuto(idx)) this.announceStep(idx, speak);
  }

  private announceStep(idx: number, speak: boolean) {
    const st = this.script.steps[idx];
    const key = st.type === 'interval' ? 'intervalStart' : st.type === 'recovery' ? 'recoveryStart'
      : st.type === 'warmup' ? 'warmupStart' : st.type === 'cooldown' ? 'cooldownStart' : 'steadyStart';
    const vars = { n: this.intervalNumbers[idx] ?? 0, total: this.intervalCount, name: st.name,
      dur: durationPl(st.durationSec), low: st.powerLow, high: st.powerHigh };
    if (st.cueStart) return this.emit(st.cueStart, 'step', speak, key, vars); // tekst własny na ekranie, Enzo mówi swoje
    this.say(key, vars, 'step', speak);
  }

  private closeInterval(early: boolean, speak: boolean) {
    const st = this.step!;
    const secs = this.stepSecs;
    const pw = secs.map((i) => this.P[i]);
    const g = this.rules.graceSec, e = Math.max(g, secs.length - 3);
    const tolC = Math.max(this.rules.deadbandW, ((st.powerLow + st.powerHigh) / 2) * this.rules.deadbandPct);
    let inR = 0;
    for (let k = g; k < e; k++) {
      const a = mean(secs.slice(Math.max(0, k - 29), k + 1).map((i) => this.P[i]));
      if (a >= st.powerLow - tolC && a <= st.powerHigh + tolC) inR++;
    }
    const evalSecs = { length: e - g };
    const hrs = secs.map((i) => this.HR[i]).filter((h): h is number => h !== null && h > 0);
    const res: SeriesResult = {
      n: this.intervalNumbers[this.stepIdx] ?? this.series.length + 1, durationSec: secs.length, plannedSec: st.durationSec,
      avgPower: Math.round(mean(pw)), compliancePct: evalSecs.length ? Math.round((inR / evalSecs.length) * 100) : 0,
      avgHr: hrs.length ? Math.round(mean(hrs)) : undefined, endedEarly: early, restBeforeSec: this.lastRestSec, startSec: this.stepStartSec,
    };
    const prev = this.series[this.series.length - 1];
    this.series.push(res);
    const sv: Record<string, string | number> = { n: res.n, total: this.intervalCount, dur: durationPl(res.durationSec), avg: res.avgPower, pct: res.compliancePct };
    let text = render(this.phrases.seriesEnd, sv);
    if (prev) text += ' ' + render(this.phrases.seriesPrev, { prev: prev.avgPower });
    const first = this.series[0];
    if (this.series.length >= 2 && first.avgHr && res.avgHr && !this.spokeHr) {
      // porównanie tylko przy podobnej mocy (±3%)
      if (Math.abs(res.avgPower - first.avgPower) <= first.avgPower * 0.03 && res.avgHr - first.avgHr >= this.rules.hrDriftBpm) {
        text += ' ' + render(this.phrases.hrUp, { d: res.avgHr - first.avgHr });
        sv.hrUp = res.avgHr - first.avgHr;
        this.spokeHr = true;
      }
    }
    this.emit(text, 'summary', speak, 'seriesEnd', sv); // jeden komunikat Enzo (z tętnem), bez głosu systemowego
    this.lastRestSec = undefined;
  }
  private spokeHr = false;

  private planDone(speak: boolean) {
    this.phase = 'free';
    const list = this.series.map((x) => x.avgPower).join(', ');
    this.say('planDone', { list: list || '–' }, 'summary', speak);
  }

  // ------------------------------------------------------------------ komunikaty
  private structuralCues(st: WorkoutStep, remaining: number, nextAuto: boolean, speak: boolean) {
    const once = (k: string) => (this.spoke.has(k) ? false : (this.spoke.add(k), true));
    const R = this.rules;
    const reports = (st.type === 'steady' || st.type === 'interval') && st.durationSec >= R.statusMinStepSec && this.s >= this.quietUntil;
    if (reports && this.inStep % R.statusEverySec === 0 && remaining > 120 && this.s - this.lastCorrection >= 30) {
      const avg = Math.round(mean(this.stepSecs.map((i) => this.P[i]).filter((w) => w >= R.autoPauseWatts)));
      const hr = this.hrAvg(30);
      const state = hr === null || !(st.hrHigh || st.hrLow) ? ''
        : st.hrHigh && hr > st.hrHigh + R.hrMarginBpm ? 'high' : st.hrLow && hr < st.hrLow - R.hrMarginBpm ? 'low' : 'ok';
      const hrTxt = hr === null ? '' : ` Tętno ${hr}${{ ok: ', w normie', high: ', powyżej strefy', low: ', poniżej strefy', '': '' }[state]}.`;
      this.say('status', { avg, hr: hr ?? '', hrState: state, hrTxt }, 'info', speak);
    }
    if (st.type === 'interval' && st.durationSec >= 120 && !reports && this.inStep === Math.floor(st.durationSec / 2) && once('half')) {
      this.say('half', { avg: Math.round(mean(this.stepSecs.map((i) => this.P[i]))) }, 'info', speak);
    }
    if (st.type === 'interval' && st.durationSec >= 180 && remaining === 60 && once('lastMin')) {
      this.say('lastMinute', {}, 'info', speak);
    }
    if (nextAuto) {
      const next = this.script.steps[this.stepIdx + 1];
      const lead = Math.min(this.rules.armLeadSec, st.durationSec - 1);
      if (remaining === lead && once('arm')) {
        this.say('armNext', { n: this.intervalNumbers[this.stepIdx + 1] ?? 0, total: this.intervalCount,
          dur: durationPl(next.durationSec), low: next.powerLow, high: next.powerHigh }, 'arm', speak);
      }
      if (remaining === 10 && lead > 15 && once('ten')) this.say('tenSec', {}, 'countdown', speak);
      if (remaining >= 1 && remaining <= 3) this.countdown(remaining, speak);
      if (remaining === 0 && once('go')) this.say('goNow', {}, 'countdown', speak);
    } else if (this.stepIdx + 1 < this.script.steps.length && this.script.steps[this.stepIdx + 1].type === 'interval'
      && remaining >= 1 && remaining <= 3) {
      this.countdown(remaining, speak);
    }
  }

  private corrections(st: WorkoutStep, s: number, p: number, cad: number | null, remaining: number, speak: boolean) {
    const R = this.rules;
    const D = st.durationSec;
    // korekty oceniamy na ŚREDNIEJ: okno rośnie z długością kroku (20–60 s), a średnia całego kroku musi
    // się zgadzać – krótki zryw lub chwilowe odpuszczenie (ruch, skrzyżowanie) nie wywołuje komunikatu
    const grace = clamp(Math.round(D * 0.1), R.corrGraceMinSec, R.corrGraceMaxSec);
    if (this.inStep <= grace || remaining <= 3 || st.type === 'warmup') return;
    if (s < this.quietUntil) { this.outHigh = 0; this.outLow = 0; this.inRangeStreak = 0; return; } // postój / ruszanie
    const isWork = st.type === 'interval' || st.type === 'steady';
    // w pracy liczymy tylko sekundy, w których naprawdę jedziesz – dziura od ruchu nie zaniża średniej
    const from = this.stepSecs[Math.min(10, this.stepSecs.length - 1)];
    const act = isWork ? this.stepSecs.filter((i) => this.P[i] >= st.powerLow * R.earlyStopPct) : this.stepSecs;
    const winLen = clamp(Math.round(D / 6), R.corrWindowMinSec, R.corrWindowMaxSec);
    if (act.length < winLen) { this.outHigh = 0; this.outLow = 0; return; }
    const roll = Math.round(mean(act.slice(-winLen).map((i) => this.P[i])));
    const cum = Math.round(mean(act.filter((i) => i >= from).map((i) => this.P[i])));
    const tol = Math.max(R.deadbandW, ((st.powerLow + st.powerHigh) / 2) * R.deadbandPct);
    const inRange = roll >= st.powerLow - tol / 2 && roll <= st.powerHigh + tol / 2;
    this.outHigh = roll > st.powerHigh + tol && cum > st.powerHigh ? this.outHigh + 1 : 0;
    this.outLow = isWork && roll < st.powerLow - tol && cum < st.powerLow ? this.outLow + 1 : 0;
    this.inRangeStreak = inRange ? this.inRangeStreak + 1 : 0;
    // kolejna uwaga w tę samą stronę coraz rzadziej (1×, 2×, 3× przerwy); schłodzenie – najwyżej jedna
    const can = s - this.lastCorrection >= clamp(Math.round(D / 4), R.cooldownSec, R.cooldownMaxSec) * (1 + this.corrRepeat)
      && !(st.type === 'cooldown' && this.corrRepeat > 0);
    const dHigh = r5(roll - st.powerHigh), dLow = r5(st.powerLow - roll);
    if (can && this.outHigh >= R.outOfRangeSec && dHigh >= R.minDeltaW) {
      this.say(isWork ? 'tooHigh' : 'recoveryTooHigh', { delta: dHigh, high: st.powerHigh, prog: +(this.inStep / D).toFixed(2) }, 'correction', speak);
      this.corrRepeat = this.lastCorrDir === 1 ? this.corrRepeat + 1 : 1; this.lastCorrDir = 1;
      this.lastCorrection = s; this.outHigh = 0; return;
    }
    // wyraźne odpuszczenie w interwale elastycznym obsługuje "przerwałeś", nie "dodaj 125 W"
    const givingUp = st.type === 'interval' && this.isAuto(this.stepIdx) && this.easeRun >= 3;
    if (can && !givingUp && this.outLow >= R.outOfRangeSec && dLow >= R.minDeltaW) {
      this.say('tooLow', { delta: dLow, low: st.powerLow }, 'correction', speak);
      this.corrRepeat = this.lastCorrDir === -1 ? this.corrRepeat + 1 : 1; this.lastCorrDir = -1;
      this.lastCorrection = s; this.outLow = 0; return;
    }
    if (st.type === 'interval' && this.inRangeStreak >= R.praiseAfterSec && remaining > 30 && !this.spoke.has('praise')) {
      this.spoke.add('praise'); this.say('praise', {}, 'praise', speak);
    }
    if (cad !== null && cad > 0) {
      this.cadLowRun = st.cadenceLow && cad < st.cadenceLow ? this.cadLowRun + 1 : 0;
      this.cadHighRun = st.cadenceHigh && cad > st.cadenceHigh ? this.cadHighRun + 1 : 0;
      if (can && this.cadLowRun >= R.cadenceGraceSec) {
        this.say('cadenceLow', { cad, cadLow: st.cadenceLow! }, 'cadence', speak); this.lastCorrection = s; this.cadLowRun = 0;
      } else if (can && this.cadHighRun >= R.cadenceGraceSec) {
        this.say('cadenceHigh', { cad, cadHigh: st.cadenceHigh! }, 'cadence', speak); this.lastCorrection = s; this.cadHighRun = 0;
      }
    }
  }

  private countdown(n: number, speak: boolean) {
    this.say('count', { n, word: ['', 'Jeden', 'Dwa', 'Trzy'][n] }, 'countdown', speak);
  }

  // ------------------------------------------------------------------ jedzenie i picie
  private lastDrink = 0;
  private lastEat = 0;
  /** „Zjadłem” / „wypiłem” (głosem) – przesuwa przypomnienia. */
  fueled(kind: 'eat' | 'drink') {
    if (kind === 'eat') this.lastEat = Math.max(0, this.s);
    this.lastDrink = Math.max(0, this.s);
  }
  /** Przypomnienia na dłuższych jazdach: pić co 20 min, jeść co 40 min (co 30 przy mocnym planie).
   *  Nie w trakcie interwału – poczekamy na przerwę (najdłużej 10 min). */
  private fuelTick(s: number, speak: boolean) {
    if (this.phase === 'autoPaused' || s <= 0) return;
    const steps = this.script.steps;
    const total = steps.reduce((a, x) => a + x.durationSec, 0);
    const free = !steps.length;
    const drinkOn = free ? s >= FUEL_DRINK_SEC : total >= 2700;
    const eatOn = free ? s >= 3600 : total >= 4500;
    const hard = steps.some((x) => x.type === 'interval' && this.script.ftp > 0 && x.powerLow >= this.script.ftp * 0.88);
    const eatEvery = hard ? 1800 : 2400;
    const st = this.phase === 'free' ? undefined : this.step;
    const working = st?.type === 'interval' && st.durationSec - this.inStep > 45;
    const due = (last: number, every: number) => s - last >= every && (!working || s - last >= every + 600);
    if (eatOn && due(this.lastEat, eatEvery)) {
      this.lastEat = s; this.lastDrink = s;
      this.say('eat', {}, 'info', speak);
    } else if (drinkOn && due(this.lastDrink, FUEL_DRINK_SEC)) {
      this.lastDrink = s;
      this.say('drink', {}, 'info', speak);
    }
  }

  // ------------------------------------------------------------------ odprawa (rozgrzewka)
  /** Gotowość dziś (z PMC) i „kondycja” jak w Garminie: tętno przy tej mocy vs Twoje ostatnie jazdy. */
  private briefingTick(s: number, speak: boolean) {
    const b = this.script.briefing;
    if (!b) return;
    if (s === BRIEF_READY_SEC && b.readiness != null) {
      this.say('readiness', { pct: Math.round(b.readiness), level: b.readyColor ?? 'yellow', state: b.readyState ?? '',
        heavy: (b.yTss ?? 0) >= 150 ? 1 : 0 }, 'info', speak);
    }
    if (s === BRIEF_COND_SEC && b.hrA != null && b.hrB != null) {
      const idx: number[] = [];
      for (let i = BRIEF_COND_FROM; i <= s; i++) if ((this.P[i] ?? 0) >= 50 && (this.HR[i] ?? 0) > 0) idx.push(i);
      if (idx.length < (s - BRIEF_COND_FROM) * 0.6) return; // za mało jazdy z tętnem
      const pw = mean(idx.map((i) => this.P[i])), hr = mean(idx.map((i) => this.HR[i]!));
      const exp = b.hrA + b.hrB * pw;
      if (!(exp > 60)) return;
      const n = Math.max(-10, Math.min(10, Math.round(((exp - hr) / exp) * 100)));
      this.say('condition', { n, sign: n > 0 ? '+' : '', level: n >= 3 ? 'good' : n <= -3 ? 'bad' : 'ok' }, 'info', speak);
    }
  }

  // ------------------------------------------------------------------ tętno
  private hrHighRun = 0;
  private quietUntil = -1;
  private corrRepeat = 0;
  private lastCorrDir = 0;
  private lastHrAlert = -1e9;
  private hrRecStart: number | null = null;

  /** Średnie tętno z ostatnich n s (null = brak pasa / za mało odczytów). */
  private hrAvg(n: number): number | null {
    const a = this.HR.slice(-n).filter((h): h is number => h !== null && h > 0);
    return a.length >= Math.max(1, n / 2) ? Math.round(mean(a)) : null;
  }

  private hrCoach(st: WorkoutStep, s: number, remaining: number, speak: boolean) {
    const R = this.rules;
    // przerwa: potwierdzenie regeneracji, gdy tętno zejdzie poniżej progu (raz na przerwę)
    if (st.type === 'recovery') {
      if (!st.hrHigh || this.spoke.has('hrRec')) return;
      if (this.inStep === 15) this.hrRecStart = this.hrAvg(10);
      const hr = this.hrAvg(10);
      const quiet = (remaining > 12 && Math.abs(remaining - R.armLeadSec) > 8) || remaining < -3; // nie wchodź w zapowiedź/odliczanie
      if (this.inStep >= 45 && hr !== null && hr <= st.hrHigh && (this.hrRecStart ?? 0) > st.hrHigh + 5 && quiet) {
        this.spoke.add('hrRec');
        this.say('hrRecovered', { hr }, 'info', speak);
      }
      return;
    }
    // tętno ponad zakresem (jazda w strefie, rozgrzewka, schłodzenie – w interwałach decyduje moc)
    if (st.type === 'interval' || st.type === 'cooldown' || !st.hrHigh || this.inStep <= R.hrGraceSec || remaining <= 30 || s < this.quietUntil) { this.hrHighRun = 0; return; }
    const hr = this.hrAvg(30);
    this.hrHighRun = hr !== null && hr > st.hrHigh + R.hrMarginBpm ? this.hrHighRun + 1 : 0;
    if (this.hrHighRun >= R.hrAlertSec && s - this.lastHrAlert >= R.hrCooldownSec && s - this.lastCorrection >= 60) {
      this.say('hrHigh', { hr: hr!, high: st.hrHigh }, 'correction', speak);
      this.lastHrAlert = s; this.lastCorrection = s; this.hrHighRun = 0;
    }
  }

  // ------------------------------------------------------------------ jazda swobodna
  private freeTick(s: number, _p: number, speak: boolean) {
    const ftp = this.script.ftp;
    if (!ftp || s < 9) return;
    const avg10 = mean(this.P.slice(s - 9, s + 1));
    if (!this.inEffort && avg10 >= ftp * this.rules.effortStartPct) { this.inEffort = true; this.effortStart = s - 9; }
    else if (this.inEffort && avg10 < ftp * this.rules.effortEndPct) {
      this.inEffort = false;
      let a = this.effortStart, b = s;
      const thr = ftp * 0.8;
      while (a < b && this.P[a] < thr) a++;
      while (b > a && this.P[b] < thr) b--;
      const dur = b - a + 1;
      if (dur >= this.rules.effortMinSec) {
        const avg = Math.round(mean(this.P.slice(a, b + 1)));
        this.efforts.push({ startSec: a, durationSec: dur, avgPower: avg });
        this.say('effort', { dur: durationPl(dur), avg }, 'effort', speak);
      }
    }
  }

  // ------------------------------------------------------------------ pomocnicze
  private say(key: string, vars: Record<string, string | number>, kind: CueKind, speak: boolean) {
    const t = this.phrases[key];
    if (t) this.emit(render(t, vars), kind, speak, key, vars);
  }
  private emit(text: string, kind: CueKind, speak: boolean, key?: string, vars?: Record<string, string | number>) {
    if (!speak || !text) return;
    const c: Cue = { s: this.s, text, kind, key, vars };
    this.cues.push(c);
    this.onCue?.(c);
  }

  /** Stan do UI. */
  live() {
    const st = this.step;
    return {
      s: this.s, phase: this.phase, stepIndex: this.stepIdx, stepName: st?.name ?? 'Jazda swobodna',
      stepType: this.phase === 'free' ? 'free' : st?.type, stepElapsed: this.inStep,
      stepRemaining: st && this.phase !== 'free' ? Math.max(0, st.durationSec - this.inStep) : 0,
      overrunSec: st && this.phase === 'waiting' ? this.inStep - st.durationSec : 0,
      targetLow: this.phase === 'free' ? 0 : st?.powerLow ?? 0, targetHigh: this.phase === 'free' ? 0 : st?.powerHigh ?? 0,
      lastSeries: this.series[this.series.length - 1],
    };
  }
  /** Podsumowanie (te same pola co WorkoutSummary z RideEngine na iOS). */
  summary(file = '') {
    const n = this.P.length;
    const total = this.P.reduce((a, b) => a + b, 0);
    const hrs = this.HR.filter((h): h is number => h !== null && h > 0);
    let np = n ? Math.round(total / n) : 0;
    if (n >= 30) {
      let sum = 0, acc4 = 0, cnt = 0;
      for (let i = 0; i < n; i++) {
        sum += this.P[i];
        if (i >= 30) sum -= this.P[i - 30];
        if (i >= 29) { const r = sum / 30; acc4 += r ** 4; cnt++; }
      }
      np = Math.round((acc4 / cnt) ** 0.25);
    }
    const evalSec = this.series.reduce((a, x) => a + x.durationSec, 0);
    const weighted = this.series.reduce((a, x) => a + x.compliancePct * x.durationSec, 0);
    return {
      file, durationSec: n, avgPower: n ? Math.round(total / n) : 0, normalizedPower: np,
      avgHr: hrs.length ? Math.round(mean(hrs)) : undefined, maxHr: hrs.length ? Math.max(...hrs) : undefined,
      kJ: Math.floor(total / 1000), compliancePct: evalSec ? Math.floor(weighted / evalSec) : 0,
      series: [...this.series], efforts: [...this.efforts],
    };
  }

  /** Numer interwału dla kroku (1-based) – do etykiet w UI. */
  intervalNo(idx: number): number { return this.intervalNumbers[idx] ?? 0; }
  get totalIntervals(): number { return this.intervalCount; }

  static mmss = mmss;
}
