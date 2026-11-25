'use client';
// Hook spinający UI z silnikiem (natywny plugin na iOS / symulacja w przeglądarce).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { getRideEngine, isNativeRide, setWebSimSpeed } from '@/lib/ride/ride-client';
import type { CoachEvent, FlicPress, FlicStatus, GarminLinkStatus, GarminRide, LiveSample, SensorData, SensorFound, SensorStatus, WorkoutSummary, VoiceLevel, VoiceInfo, VoiceMode } from '@/lib/ride/ride-engine';
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
  notifyDevice: boolean; // krótkie powiadomienia Enzo na licznik (Smart Notifications) – nie przy aplikacji VeloIQ na Garminie
}

export const DEFAULT_SETTINGS: RideSettings = {
  outdoor: false, autoStart: true, announceArm: true, autoPause: true, voiceLevel: 'full', notifyDevice: false,
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
  const [autoPaused, setAutoPaused] = useState(false);   // postój (auto-pauza) – nie ręczna pauza
  const [recoverable, setRecoverable] = useState<{ name?: string; elapsed?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voice, setVoiceState] = useState<{ voices: VoiceInfo[]; current?: string; rate: number; mode?: VoiceMode; packs?: { id: string; name: string }[] }>({ voices: [], rate: 0.5 });
  const [coach, setCoach] = useState<{ state: CoachEvent['state']; question?: string; answer?: string; at: number } | null>(null);
  const [route, setRoute] = useState<RideRoute | null>(null);   // trasa tej jazdy (mapa na ekranie)
  const [nav, setNav] = useState<NavState | null>(null);
  // przycisk Flic na kierownicy: stan + ostatnie wciśnięcie (test na ekranie Czujniki)
  const [flic, setFlic] = useState<FlicStatus>({ available: false });
  const [flicPress, setFlicPress] = useState<{ press: FlicPress; at: number } | null>(null);
  // most do licznika Garmin Edge (czujniki sparowane z licznikiem, głos Enzo w telefonie)
  const [garminLink, setGarminLink] = useState<GarminLinkStatus>({ available: false });
  // jazda prowadzona przez licznik Garmin (START na liczniku → ta sama sesja tutaj); po końcu – karta wysyłki
  const [mirror, setMirror] = useState<GarminRide | null>(null);
  const [mirrorDone, setMirrorDone] = useState<GarminRide | null>(null);
  const [liveAt, setLiveAt] = useState(0);
  // licznik dał znać, że jazda jest w VeloIQ (karta ostatniej jazdy odświeża się od razu)
  const [uploadBump, setUploadBump] = useState(0);
  const [mirrorAt, setMirrorAt] = useState(0);   // kiedy telefon dołączył do jazdy z licznika
  // plan zmieniony głosem w trakcie jazdy z telefonu – ekran pokazuje aktualne kroki
  const [planEdit, setPlanEdit] = useState<{ steps: WorkoutScript['steps']; bias: number } | null>(null);
  const mirrorKey = useRef<number | null>(null);
  const cueId = useRef(0);
  const lastElapsed = useRef(0);

  // jazda z licznika: wejście w sesję (nowa jazda albo odświeżenie po powrocie aplikacji) i koniec
  const onGarminRide = useCallback((d: GarminRide) => {
    if (d.state === 'start') {
      const fresh = mirrorKey.current !== d.key;
      mirrorKey.current = d.key;
      setMirror(d);
      setActive(true);
      setPaused(d.paused === 1);
      setAutoPaused(d.paused === 2);
      if (fresh) {
        setMirrorAt(Date.now());
        setCues([]); setPlanDone(null); setSummary(null); setMirrorDone(null); setRoute(null); setNav(null);
        if (!d.sync) setLive(null);
        // rozmowa z Enzo: token z sesji aplikacji (licznik ma też własny z synchronizacji)
        fetch('/api/ride/token').then((r) => (r.ok ? r.json() : null)).then((j) => {
          if (j?.token) return engine.setCoach({ token: j.token, baseUrl: window.location.origin, tapMode: false });
        }).catch(() => {});
      }
    } else {
      if (mirrorKey.current != null && mirrorKey.current !== d.key) return;
      mirrorKey.current = null;
      setMirror(null);
      setActive(false); setPaused(false); setAutoPaused(false);
      setMirrorDone(d);
    }
  }, [engine]);

  useEffect(() => {
    const handles: Promise<PluginListenerHandle>[] = [
      engine.addListener('live', (d) => { lastElapsed.current = d.elapsed; setLive(d); setLiveAt(Date.now()); }),
      engine.addListener('cue', (d) => {
        setCues((c) => [{ id: ++cueId.current, at: lastElapsed.current, text: d.text, kind: d.kind }, ...c].slice(0, 30));
      }),
      engine.addListener('sensorData', (d) => setSensorData(d)),
      engine.addListener('sensorFound', (d) => setFound((f) => (f.some((x) => x.id === d.id) ? f : [...f, d]))),
      engine.addListener('sensor', (d) => setSensors((s) => ({ ...s, [d.kind]: d }))),
      engine.addListener('planFinished', (d) => setPlanDone(d)),
      engine.addListener('paused', (d) => { setActive(true); if (d?.auto) setAutoPaused(true); else setPaused(true); }),
      engine.addListener('resumed', () => { setPaused(false); setAutoPaused(false); }),   // też po auto-pauzie
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
    handles.push(engine.addListener('flic', (d) => {
      if (d.press) setFlicPress({ press: d.press, at: Date.now() });
      else setFlic((f) => ({ ...f, ...d, available: true }));
    }));
    handles.push(engine.addListener('garmin', (d) => setGarminLink((g) => ({ ...g, ...d, available: d.available !== false }))));
    handles.push(engine.addListener('garminRide', onGarminRide));
    handles.push(engine.addListener('planChanged', (d) => setPlanEdit(d)));
    handles.push(engine.addListener('garminUpload', () => setUploadBump((n) => n + 1)));
    engine.garminStatus().then(setGarminLink).catch(() => setGarminLink({ available: false }));
    // jazda z licznika, która trwała, zanim otworzyła się ta strona (albo gdy aplikacja była w tle)
    const syncMirror = () => {
      engine.garminSync().then((r) => {
        if (r.mirror) onGarminRide(r.mirror);
        else if (mirrorKey.current != null && r.available && !r.recording && r.streaming) {
          // licznik nadaje, ale już nie nagrywa – koniec jazdy przyszedł, gdy aplikacja spała
          onGarminRide({ state: 'end', key: mirrorKey.current, name: '', script: { version: 1, id: '', name: '', ftp: 0, steps: [] }, startedAt: 0, saved: -1 });
        }
      }).catch(() => {});
    };
    syncMirror();
    const onVisible = () => { if (document.visibilityState === 'visible') syncMirror(); };
    document.addEventListener('visibilitychange', onVisible);
    // stara wersja aplikacji (bez metody) → available: false, sekcja Flic prosi o aktualizację
    engine.flicStatus().then(setFlic).catch(() => setFlic({ available: false }));
    engine.getRecoverable().then((r) => { if (r.available) setRecoverable({ name: r.name, elapsed: r.elapsed }); }).catch(() => {});
    engine.getSavedSensors().then((s) => { if (s.hrId || s.powerId) engine.connect(s); }).catch(() => {});
    return () => { handles.forEach((h) => h.then((x) => x.remove())); document.removeEventListener('visibilitychange', onVisible); };
  }, [engine, onGarminRide]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    try { setError(null); await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  return {
    native, live, sensorData, cues, found, sensors, planDone, summary, active, paused, autoPaused, recoverable, error,
    scan: () => run(() => { setFound([]); return engine.scan({ kinds: ['power', 'hr'] }); }),
    stopScan: () => run(() => engine.stopScan()),
    connect: (o: { hrId?: string; powerId?: string; power2Id?: string }) => run(() => engine.connect(o)),
    zeroOffset: () => run(() => engine.zeroOffset()),
    testVoice: (text: string) => run(() => engine.testVoice({ text })),
    debrief: (o: { series: { n: number; total: number; avg: number; vrd: string }[]; tip: string; text: string }) => run(() => engine.debrief(o)),
    voice,
    loadVoices: () => engine.getVoices().then(setVoiceState).catch(() => {}),
    setVoice: (o: { id?: string; rate?: number; mode?: VoiceMode; name?: string }) => run(async () => {
      await engine.setVoice(o);
      setVoiceState((v) => ({ ...v, current: o.id ?? v.current, rate: o.rate ?? v.rate, mode: o.mode ?? v.mode }));
    }),
    route, nav,
    start: (script: WorkoutScript, s: RideSettings, simulate = !native, rt: RideRoute | null = null) => run(async () => {
      if (mirrorKey.current != null) throw new Error('Jazdę nagrywa teraz licznik Garmin – ten ekran pokazuje ją na żywo.');
      setCues([]); setMirrorDone(null); setPlanEdit(null); setPlanDone(null); setSummary(null); setLive(null); setNav(null);
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
    flic, flicPress,
    flicScan: () => run(async () => {
      setFlic((f) => ({ ...f, scanning: true, scanPhase: 'searching', error: undefined }));
      try {
        const r = await engine.flicScan();
        setFlic({ ...r, available: true, scanning: false, scanPhase: undefined });
      } finally {
        setFlic((f) => (f.scanning ? { ...f, scanning: false, scanPhase: undefined } : f));
      }
    }),
    flicStopScan: () => run(() => engine.flicStopScan()),
    flicForget: () => run(async () => { const r = await engine.flicForget(); setFlic({ ...r, available: true }); }),
    garminLink,
    garminChoose: () => run(() => engine.garminChoose()),
    garminForget: () => run(async () => setGarminLink(await engine.garminForget())),
    garminOpenApp: () => run(() => engine.garminOpenApp()),
    /** Licznik pobiera trasę z VeloIQ od razu (gdy most działa) – bez czekania na synchronizację. */
    garminResync: () => engine.garminCommand({ cmd: 'resync' }).catch(() => undefined),
    /** Jazda z licznika (tryb lustra) – null, gdy jazdę prowadzi telefon albo nic nie trwa. */
    mirror, mirrorDone, liveAt, mirrorAt, planEdit, uploadBump,
    clearMirrorDone: () => setMirrorDone(null),
    pause: () => run(async () => { await engine.pause(); setPaused(true); }),
    resume: () => run(async () => { await engine.resume(); setPaused(false); setAutoPaused(false); }),
    skip: () => run(() => engine.skipStep()),
    cancelStart: () => run(() => engine.cancelStart()),
    setNavEnabled: (on: boolean) => run(async () => {
      setNav((n) => (n ? { ...n, enabled: on, muted: false } : n));   // od razu na ekranie
      await engine.setNavEnabled({ enabled: on });
    }),
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
