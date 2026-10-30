import { polishGrammar } from './polish';
import { DirectorComposer, WebDirectorPlayer, type VoicePack } from './director';
// Webowy zamiennik natywnego RideEngine – do pracy nad UI w przeglądarce (next dev) bez iPhone'a.
// Ten sam interfejs co plugin Capacitor, ta sama logika (FlexEngine), czujniki symulowane.
// Na iOS używany jest prawdziwy plugin – patrz ride-client.ts.

import type { PluginListenerHandle } from '@capacitor/core';
import type { RideEnginePlugin, LiveSample, WorkoutSummary, SensorFound, RidePhase, VoiceLevel } from './ride-engine';
import type { WorkoutScript } from './workout-script';
import { FlexEngine, type Sample } from './flex-engine';

type Listener = (d: unknown) => void;

/** Symulowany zawodnik – reaguje na silnik jak człowiek i popełnia typowe błędy. */
export class SimRider {
  private k = 0; private pushing = false; private recAt = -1; private intervalAt = -1; private freeAt = -1;
  private hr = 95; private seed: number;
  constructor(private delays: number[] = [-20, 35, 70, 10, 50], seed = 11) { this.seed = seed; }
  private rnd() { this.seed = (this.seed * 16807) % 2147483647; return (this.seed / 2147483647 - 0.5) * 2; }

  next(e: FlexEngine): Sample {
    const L = e.live(); const s = e.s + 1; const ftp = e.script.ftp || 250;
    let p = 0; let cad = 90;
    if (L.phase === 'free') {
      if (this.freeAt < 0) this.freeAt = s;
      const ft = s - this.freeAt;
      p = ft >= 30 && ft < 120 ? ftp * 0.97 : ftp * 0.55;
    } else if (L.stepType === 'interval') {
      this.pushing = false; this.recAt = -1;
      if (this.intervalAt < 0) this.intervalAt = s;
      const t = s - this.intervalAt; const st = e.step!;
      p = (st.powerLow + st.powerHigh) / 2;
      if (this.k === 1 && t >= 30 && t < 42) p = st.powerHigh + 30;        // za mocno na starcie
      if (this.k === 2 && t >= 50 && t < 65) { p = 0; cad = 0; }            // światła
      if (this.k === 2 && t > 120) cad = 78;                                // spada kadencja
      if (this.k === e.totalIntervals && t >= st.durationSec * 0.66) { p = st.powerLow * 0.5; cad = 85; } // odpuszcza ostatni
    } else {
      this.intervalAt = -1;
      const st = e.step!;
      if (L.stepType === 'recovery' && this.recAt < 0) this.recAt = s;
      const stepStart = L.stepType === 'recovery' ? this.recAt : s - L.stepElapsed;
      const planned = stepStart + st.durationSec;
      p = (st.powerLow + st.powerHigh) / 2;
      const nextIsInterval = e.script.steps[e.stepIdx + 1]?.type === 'interval';
      const myStart = planned + (this.delays[this.k] ?? 0);
      if (this.pushing || (nextIsInterval && s >= myStart && L.stepElapsed > 25)) {
        if (!this.pushing) { this.pushing = true; this.k++; }
        const n = e.script.steps[e.stepIdx + 1];
        p = n ? (n.powerLow + n.powerHigh) / 2 : p;
      }
    }
    if (p > 0) p = Math.max(0, Math.round(p + this.rnd() * 10));
    this.hr += ((92 + p * 0.22 + s / 120) - this.hr) * 0.06;
    return { p, hr: Math.round(this.hr), cad: p === 0 ? 0 : cad + Math.round(this.rnd() * 3) };
  }
}

export class WebRideEngine implements RideEnginePlugin {
  private listeners = new Map<string, Set<Listener>>();
  private engine?: FlexEngine;
  private rider?: SimRider;
  private timer?: ReturnType<typeof setInterval>;
  private paused = false;
  private last: Sample = {};
  private planDoneSent = false;
  /** Przyspieszenie symulacji (1 = czas rzeczywisty). */
  speed = 1;
  voice = true;

  // --- czujniki (symulowane)
  async scan(): Promise<void> {
    const found: SensorFound[] = [
      { id: 'sim-power', name: 'Look_PWR_L (symulacja)', kind: 'power', rssi: -60 },
      { id: 'sim-hr', name: 'HRMPro+ (symulacja)', kind: 'hr', rssi: -55 },
    ];
    found.forEach((f, i) => setTimeout(() => this.emit('sensorFound', f), 300 + i * 300));
  }
  async stopScan() {}
  async connect(o: { hrId?: string; powerId?: string }) {
    if (o.powerId) this.emit('sensor', { kind: 'power', id: o.powerId, name: 'Look_PWR_L', connected: true });
    if (o.hrId) this.emit('sensor', { kind: 'hr', id: o.hrId, name: 'HRMPro+', connected: true });
    try { localStorage.setItem('veloiq.sensors', JSON.stringify(o)); } catch { /* prywatny tryb */ }
    // podgląd danych poza treningiem
    if (!this.preview) {
      let t = 0;
      this.preview = setInterval(() => {
        if (this.engine) return;
        t++;
        this.emit('sensorData', { power: t % 6 < 3 ? 0 : 30 + (t % 7) * 4, cadence: t % 6 < 3 ? 0 : 52, hr: 64 + (t % 3), balanceL: 49 });
      }, 1000);
    }
  }
  private preview?: ReturnType<typeof setInterval>;
  async disconnect() {}
  async getSavedSensors() {
    try { return JSON.parse(localStorage.getItem('veloiq.sensors') ?? '{}'); } catch { return {}; }
  }
  async zeroOffset() {}

  // --- trening
  private voiceLevel: VoiceLevel = 'full';
  private announceArm = true;

  async startWorkout(o: { script: WorkoutScript; outdoor?: boolean; simulate?: boolean; voiceLevel?: VoiceLevel; announceArm?: boolean; autoPause?: boolean; notifications?: boolean; route?: unknown }) {
    this.stopTimer();
    this.voiceLevel = o.voiceLevel ?? 'full';
    this.announceArm = o.announceArm ?? true;
    this.engine = new FlexEngine(o.script);
    this.rider = new SimRider();
    this.paused = false; this.planDoneSent = false;
    this.engine.onCue = (c) => {
      this.emit('cue', { text: c.text, kind: c.kind });
      const muted = this.voiceLevel === 'off' || (!this.announceArm && c.kind === 'arm')
        || (this.voiceLevel === 'struct' && ['correction', 'cadence', 'praise'].includes(c.kind));
      if (!muted) this.say(c.key, c.vars ?? {}, c.text, c.kind === 'countdown');
    };
    this.timer = setInterval(() => this.tick(), Math.max(20, 1000 / this.speed));
  }
  setSpeed(x: number) {
    this.speed = x;
    if (this.timer) { this.stopTimer(); this.timer = setInterval(() => this.tick(), Math.max(20, 1000 / this.speed)); }
  }
  async pause() { this.paused = true; this.emit('cue', { text: 'Pauza.', kind: 'info' }); this.say('manualPause', {}, 'Pauza.'); this.emitLive(); }
  async resume() { this.paused = false; this.emit('cue', { text: 'Wznawiamy.', kind: 'info' }); this.say('manualResume', {}, 'Wznawiamy.'); }
  async setCoach() { /* rozmowa tylko w aplikacji na iPhonie */ }
  async talk() { this.emit('coach', { state: 'error', text: 'Rozmowa z Enzo działa w aplikacji na iPhonie.' }); }
  async skipStep() { this.engine?.skipStep(true); this.emitLive(); }
  async cancelStart() { this.engine?.cancelStart(true); this.emitLive(); }
  async stopWorkout(): Promise<WorkoutSummary> {
    this.stopTimer();
    const sum = this.engine?.summary('web-sim.jsonl') ?? emptySummary();
    this.emit('finished', sum);
    return sum as WorkoutSummary;
  }
  async getRecoverable() { return { available: false }; }
  async resumeRecovered() { return { paused: true, elapsed: 0 }; }
  async discardRecovered() {}
  async testVoice(o: { text: string }) {
    if (this.mode === 'enzo' && (await this.loadPack())) {
      this.director!.play(['lead.arm.0', 'int.2.4', 'min.8', 'from.305', 'to.320']); return;
    }
    this.speak(o.text);
  }
  async getVoices() {
    const ss = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    const voices = (ss?.getVoices() ?? []).filter((v) => v.lang.startsWith('pl'))
      .map((v) => ({ id: v.voiceURI, name: v.name, quality: 'default' as const }));
    const pack = await this.loadPack();
    return { voices, current: this.voiceId, rate: this.rate, mode: this.mode, packs: pack ? [{ id: pack.id, name: pack.name }] : [] };
  }
  async setVoice(o: { id?: string; rate?: number; mode?: 'enzo' | 'system'; name?: string }) {
    if (o.id) this.voiceId = o.id;
    if (o.rate) this.rate = o.rate;
    if (o.mode) this.mode = o.mode;
    if (o.name !== undefined) { this.userName = o.name; this.composer?.setName(o.name); }
  }
  async readRecording() {
    const e = this.engine;
    if (!e) return { data: '' };
    const lines = e.P.map((p, s) => JSON.stringify({ s, p, hr: e.HR[s] ?? undefined, cad: e.CAD[s] ?? undefined }));
    return { data: lines.join('\n') };
  }

  async addListener(event: string, cb: (d: never) => void): Promise<PluginListenerHandle> {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(cb as Listener);
    this.listeners.set(event, set);
    return { remove: async () => { set.delete(cb as Listener); } };
  }
  async removeAllListeners() { this.listeners.clear(); }

  // --- wewnętrzne
  private tick() {
    const e = this.engine; if (!e || !this.rider || this.paused) return;
    const smp = this.rider.next(e);
    this.last = smp;
    e.tick(smp, true);
    if (e.phase === 'free' && !this.planDoneSent && e.script.steps.length) {
      this.planDoneSent = true;
      this.emit('planFinished', e.summary());
    }
    this.emitLive();
  }

  private emitLive() {
    const e = this.engine; if (!e) return;
    const L = e.live();
    const st = e.step;
    const P = e.P;
    const n3 = Math.min(3, P.length);
    const p3 = n3 ? Math.round(P.slice(-n3).reduce((a, b) => a + b, 0) / n3) : undefined;
    const win = e.stepSecs.slice(-10);
    const ps = win.length ? Math.round(win.reduce((a, i) => a + P[i], 0) / win.length) : undefined;
    const free = L.phase === 'free';
    const live: LiveSample = {
      elapsed: Math.max(0, e.s), phase: (this.paused ? 'paused' : L.phase) as RidePhase,
      stepIndex: e.stepIdx, stepName: free ? 'Jazda swobodna' : st?.name ?? '', stepType: free ? 'free' : st?.type ?? 'free',
      stepElapsed: L.stepElapsed, stepRemaining: L.stepRemaining, overrunSec: L.overrunSec, lastSeries: L.lastSeries,
      falseStartLeft: L.falseStartLeft || undefined,
      power: this.last.p ?? undefined, power3s: p3, powerSmooth: free ? undefined : ps,
      hr: this.last.hr ?? undefined, cadence: this.last.cad ?? undefined, balanceL: 49,
      targetLow: L.targetLow, targetHigh: L.targetHigh,
      inRange: !free && ps !== undefined && st ? ps >= st.powerLow && ps <= st.powerHigh : undefined,
    };
    this.emit('live', live);
  }

  private emit(event: string, data: unknown) { this.listeners.get(event)?.forEach((cb) => cb(data)); }
  private stopTimer() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  private voiceId?: string;
  private mode: 'enzo' | 'system' = 'enzo';
  private userName?: string;
  private pack?: VoicePack | null;
  private composer?: DirectorComposer;
  private director?: WebDirectorPlayer;
  private async loadPack(): Promise<VoicePack | null> {
    if (this.pack !== undefined) return this.pack;
    try {
      const r = await fetch('/voice/enzo/manifest.json');
      this.pack = r.ok ? ((await r.json()) as VoicePack) : null;
    } catch { this.pack = null; }
    if (this.pack) { this.composer = new DirectorComposer(this.pack); this.composer.setName(this.userName); this.director = new WebDirectorPlayer('/voice/enzo', this.pack); }
    return this.pack;
  }
  /** Dyrektor Enzo, gdy paczka jest dostępna; inaczej synteza przeglądarki. */
  private say(key: string | undefined, vars: Record<string, string | number>, text: string, interrupt = false) {
    if (!this.voice || this.speed > 2) return;
    if (this.mode === 'enzo' && this.composer && this.director) {
      // tryb Enzo: tylko Enzo (bez nagrania → sam tekst na ekranie), nigdy dwa głosy naraz
      const seg = key ? this.composer.compose(key, vars) : null;
      if (seg?.length) this.director.play(seg, interrupt);
      return;
    }
    this.speak(text);
  }
  private rate = 0.5;
  private speak(text: string) {
    if (!this.voice || this.speed > 2) return; // przy przyspieszonej symulacji tylko tekst
    try {
      const ss = window.speechSynthesis; if (!ss) return;
      const u = new SpeechSynthesisUtterance(polishGrammar(text)); u.lang = 'pl-PL';
      u.rate = this.rate * 2; // skala iOS 0.5 ≈ przeglądarka 1.0
      const v = ss.getVoices().find((x) => x.voiceURI === this.voiceId); if (v) u.voice = v;
      ss.speak(u);
    } catch { /* brak syntezy mowy */ }
  }
}

function emptySummary() {
  return { file: '', durationSec: 0, avgPower: 0, normalizedPower: 0, kJ: 0, compliancePct: 0, series: [], efforts: [] };
}
