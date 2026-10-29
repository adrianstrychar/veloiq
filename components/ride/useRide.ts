'use client';
// Hook spinający UI z silnikiem (natywny plugin na iOS / symulacja w przeglądarce).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { getRideEngine, isNativeRide, setWebSimSpeed } from '@/lib/ride/ride-client';
import type { CoachEvent, LiveSample, SensorData, SensorFound, SensorStatus, WorkoutSummary, VoiceLevel, VoiceInfo, VoiceMode } from '@/lib/ride/ride-engine';
import type { WorkoutScript } from '@/lib/ride/workout-script';
import type { RideRoute } from '@/lib/ride/gpx';
import type { NavState } from './RouteCard';

export interface CueItem { id: number; at: number; text: string; kind: string }

export interface RideSettings {
  outdoor: boolean;
  autoStart: boolean;    // interwały startują, gdy ruszysz
  announceArm: boolean;  // „Za minutę interwał…”
  autoPause: boolean;    // auto-pauza na postojach
  voiceLevel: VoiceLevel;
  notifyDevice: boolean; // krótkie powiadomienia Enzo na licznik (Garmin Edge przez iPhone)
}

export const DEFAULT_SETTINGS: RideSettings = {
  outdoor: false, autoStart: true, announceArm: true, autoPause: true, voiceLevel: 'full', notifyDevice: true,
};

/** Ustawienia użytkownika → skrypt dla silnika. */
export function applySettings(script: WorkoutScript, s: RideSettings): WorkoutScript {
  return {
    ...script,
    steps: script.steps.map((st) => (st.type === 'interval' && !s.autoStart ? { ...st, start: 'time' as const } : st)),
    rules: { ...script.rules, ...(s.autoPause ? {} : { autoPauseSec: 1e9 }) },
  };
}

export function freeRideScript(ftp: number): WorkoutScript {
  return { version: 1, id: `free-${Date.now()}`, name: 'Jazda swobodna', ftp, lang: 'pl-PL', steps: [] };
}

type Sensors = { power?: SensorStatus; power2?: SensorStatus; hr?: SensorStatus };

export function useRide() {
  const engine = useMemo(() => getRideEngine(), []);
  const native = useMemo(() => isNativeRide(), []);
  const [live, setLive] = useState<LiveSample | null>(null);
  const [sensorData, setSensorData] = useState<SensorData>({});
  const [cues, setCues] = useState<CueItem[]>([]);
  const [found, setFound] = useState<SensorFound[]>([]);
  const [sensors, setSensors] = useState<Sensors>({});
  const [planDone, setPlanDone] = useState<WorkoutSummary | null>(null);
  const [summary, setSummary] = useState<WorkoutSummary | null>(null);
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [recoverable, setRecoverable] = useState<{ name?: string; elapsed?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voice, setVoiceState] = useState<{ voices: VoiceInfo[]; current?: string; rate: number; mode?: VoiceMode; packs?: { id: string; name: string }[] }>({ voices: [], rate: 0.5 });
  const [coach, setCoach] = useState<{ state: CoachEvent['state']; question?: string; answer?: string; at: number } | null>(null);
  const [route, setRoute] = useState<RideRoute | null>(null);   // trasa tej jazdy (mapa na ekranie)
  const [nav, setNav] = useState<NavState | null>(null);
  const cueId = useRef(0);
  const lastElapsed = useRef(0);

  useEffect(() => {
    const handles: Promise<PluginListenerHandle>[] = [
      engine.addListener('live', (d) => { lastElapsed.current = d.elapsed; setLive(d); }),
      engine.addListener('cue', (d) => {
        setCues((c) => [{ id: ++cueId.current, at: lastElapsed.current, text: d.text, kind: d.kind }, ...c].slice(0, 30));
      }),
      engine.addListener('sensorData', (d) => setSensorData(d)),
      engine.addListener('sensorFound', (d) => setFound((f) => (f.some((x) => x.id === d.id) ? f : [...f, d]))),
      engine.addListener('sensor', (d) => setSensors((s) => ({ ...s, [d.kind]: d }))),
      engine.addListener('planFinished', (d) => setPlanDone(d)),
      engine.addListener('paused', () => { setActive(true); setPaused(true); }),
      engine.addListener('resumed', () => setPaused(false)),
      engine.addListener('nav', (d) => setNav(d)),   // też po auto-pauzie
      engine.addListener('coach', (d) => setCoach((c) => {
        const at = Date.now();
        if (d.state === 'listening') return { state: d.state, at };
        if (d.state === 'question') return { state: d.state, question: d.text, at };
        if (d.state === 'answer') return { ...c, state: d.state, answer: d.text, at };
        if (d.state === 'error') return { ...c, state: d.state, answer: d.text, at };
        return c ? { ...c, state: d.state, at } : null;
      })),
    ];
    engine.getRecoverable().then((r) => { if (r.available) setRecoverable({ name: r.name, elapsed: r.elapsed }); }).catch(() => {});
    engine.getSavedSensors().then((s) => { if (s.hrId || s.powerId) engine.connect(s); }).catch(() => {});
    return () => { handles.forEach((h) => h.then((x) => x.remove())); };
  }, [engine]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    try { setError(null); await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  return {
    native, live, sensorData, cues, found, sensors, planDone, summary, active, paused, recoverable, error,
    scan: () => run(() => { setFound([]); return engine.scan({ kinds: ['power', 'hr'] }); }),
    stopScan: () => run(() => engine.stopScan()),
    connect: (o: { hrId?: string; powerId?: string; power2Id?: string }) => run(() => engine.connect(o)),
    zeroOffset: () => run(() => engine.zeroOffset()),
    testVoice: (text: string) => run(() => engine.testVoice({ text })),
    voice,
    loadVoices: () => engine.getVoices().then(setVoiceState).catch(() => {}),
    setVoice: (o: { id?: string; rate?: number; mode?: VoiceMode; name?: string }) => run(async () => {
      await engine.setVoice(o);
      setVoiceState((v) => ({ ...v, current: o.id ?? v.current, rate: o.rate ?? v.rate, mode: o.mode ?? v.mode }));
    }),
    route, nav,
    start: (script: WorkoutScript, s: RideSettings, simulate = !native, rt: RideRoute | null = null) => run(async () => {
      setCues([]); setPlanDone(null); setSummary(null); setLive(null); setNav(null);
      const useRoute = s.outdoor ? rt : null;
      setRoute(useRoute);
      await engine.startWorkout({ script: applySettings(script, s), outdoor: s.outdoor, simulate, route: useRoute ?? undefined,
        voiceLevel: s.voiceLevel, announceArm: s.announceArm, autoPause: s.autoPause, notifications: s.notifyDevice !== false });
      setActive(true); setPaused(false);
      // rozmowa z Enzo: krótki token dla natywnego pluginu (działa też przy zgaszonym ekranie)
      if (native) {
        fetch('/api/ride/token').then((r) => (r.ok ? r.json() : null)).then((j) => {
          if (j?.token) return engine.setCoach({ token: j.token, baseUrl: window.location.origin, tapMode: false });
        }).catch(() => {});
      }
    }),
    coach,
    talk: () => run(() => engine.talk()),
    pause: () => run(async () => { await engine.pause(); setPaused(true); }),
    resume: () => run(async () => { await engine.resume(); setPaused(false); }),
    skip: () => run(() => engine.skipStep()),
    stop: () => run(async () => {
      const sum = await engine.stopWorkout();
      setSummary(sum); setActive(false); setPaused(false);
    }),
    resumeRecovered: () => run(async () => { await engine.resumeRecovered(); setRecoverable(null); setActive(true); setPaused(true); }),
    discardRecovered: () => run(async () => { await engine.discardRecovered(); setRecoverable(null); }),
    readRecording: (file: string) => engine.readRecording({ file }).then((r) => r.data),
    reset: () => { setSummary(null); setPlanDone(null); setCues([]); setLive(null); },
    setSimSpeed: (x: number) => setWebSimSpeed(x),
  };
}

export type Ride = ReturnType<typeof useRide>;
