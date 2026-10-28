'use client';
// Moduł "Trening" VeloIQ – cały przepływ: start → czujniki → przed startem → na żywo → podsumowanie.

import { useEffect, useState } from 'react';
import s from './ride.module.css';
import type { RideBriefing, WorkoutScript } from '@/lib/ride/workout-script';
import type { WorkoutSummary } from '@/lib/ride/ride-engine';
import { DEFAULT_SETTINGS, freeRideScript, type RideSettings } from './useRide';
import { useRideContext } from './RideProvider';
import { HomeScreen } from './HomeScreen';
import { SensorsScreen } from './SensorsScreen';
import { PreRideScreen } from './PreRideScreen';
import { LiveScreen } from './LiveScreen';
import { SummaryScreen, describeSaveError, parseJsonl, type RecordedSample } from './SummaryScreen';
import { hmmss } from './parts';

type Screen = 'home' | 'sensors' | 'pre' | 'live' | 'summary';

export interface RideAppProps {
  briefing?: RideBriefing;
  /** Dzisiejszy trening z planu (już jako skrypt – patrz lib/ride/plan-to-script.ts) albo null. */
  plan: WorkoutScript | null;
  planLabel?: string;
  ftp: number;
  onSave: (summary: WorkoutSummary, samples: RecordedSample[], script: WorkoutScript, settings: RideSettings, startedAt: Date) => Promise<void>;
  onAskCoach?: () => void;
}

const SETTINGS_KEY = 'veloiq.ride.settings';
const PENDING_KEY = 'veloiq.ride.pending'; // zakończony, jeszcze niezapisany trening (plik 1 Hz zostaje w telefonie)

interface Pending { summary: WorkoutSummary; script: WorkoutScript; startedAt: string; outdoor: boolean }
const readPending = (): Pending | null => { try { const v = localStorage.getItem(PENDING_KEY); return v ? JSON.parse(v) : null; } catch { return null; } };
const writePending = (p: Pending | null) => { try { if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p)); else localStorage.removeItem(PENDING_KEY); } catch { /* brak storage */ } };

export function RideApp({ plan, planLabel, ftp, onSave, onAskCoach, briefing }: RideAppProps) {
  const ride = useRideContext(); // wspólny stan z layoutu (mini-pasek, nawigacja)
  const [screen, setScreen] = useState<Screen>('home');
  const [settings, setSettings] = useState<RideSettings>(DEFAULT_SETTINGS);
  const [script, setScript] = useState<WorkoutScript | null>(plan);
  const [startedAt, setStartedAt] = useState(() => new Date());
  const [simSpeed, setSimSpeed] = useState(1);
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingState, setPendingState] = useState<{ busy: boolean; err?: string }>({ busy: false });
  useEffect(() => { setPending(readPending()); }, []);

  // ustawienia per użytkownik (wygoda – nic krytycznego)
  useEffect(() => {
    try { const v = localStorage.getItem(SETTINGS_KEY); if (v) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(v) }); } catch { /* brak storage */ }
  }, []);
  const updateSettings = (v: RideSettings) => {
    setSettings(v);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(v)); } catch { /* brak storage */ }
  };

  // trening trwa (także po wznowieniu z awarii) → ekran na żywo; koniec → podsumowanie
  useEffect(() => { if (ride.active) setScreen('live'); }, [ride.active]);
  useEffect(() => {
    if (!ride.summary) return;
    setScreen('summary');
    // zabezpieczenie: dopóki nie zapiszesz, trening wraca na ekranie startowym (także po zamknięciu aplikacji)
    const p: Pending = { summary: ride.summary, script: script ?? freeRideScript(ftp), startedAt: startedAt.toISOString(), outdoor: settings.outdoor };
    writePending(p); setPending(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride.summary]);

  const clearPending = () => { writePending(null); setPending(null); };
  const savePending = async () => {
    if (!pending) return;
    setPendingState({ busy: true });
    try {
      const samples = parseJsonl(await ride.readRecording(pending.summary.file));
      await onSave(pending.summary, samples, pending.script, { ...settings, outdoor: pending.outdoor }, new Date(pending.startedAt));
      clearPending(); setPendingState({ busy: false });
    } catch (e) { setPendingState({ busy: false, err: describeSaveError(e) }); }
  };

  // ekran nie gaśnie w trakcie jazdy (przeglądarka; na iOS silnik i tak działa przy zgaszonym)
  useEffect(() => {
    if (screen !== 'live' || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock: { release: () => Promise<void> } | undefined;
    (navigator as Navigator & { wakeLock: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } })
      .wakeLock.request('screen').then((l) => { lock = l; }).catch(() => {});
    return () => { lock?.release().catch(() => {}); };
  }, [screen]);

  const start = (sc: WorkoutScript) => {
    setScript(sc.steps.length ? sc : null);
    setStartedAt(new Date());
    ride.start(briefing ? { ...sc, briefing } : sc, settings); // odprawa Enzo na rozgrzewce
  };

  const dateLabel = new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });

  let view;
  if (screen === 'sensors') view = <SensorsScreen ride={ride} onBack={() => setScreen('home')} />;
  else if (screen === 'pre' && plan) view = (
    <PreRideScreen ride={ride} plan={plan} settings={settings} onSettings={updateSettings}
      onBack={() => setScreen('home')} onStart={() => start(plan)} />
  );
  else if (screen === 'live') view = <LiveScreen ride={ride} plan={script} />;
  else if (screen === 'summary' && ride.summary) view = (
    <SummaryScreen ride={ride} plan={script} summary={ride.summary} ftp={ftp} startedAt={startedAt}
      onSave={async (sum, samples) => { await onSave(sum, samples, script ?? freeRideScript(ftp), settings, startedAt); clearPending(); }}
      onAskCoach={onAskCoach} onDone={(discard) => { if (discard) clearPending(); ride.reset(); setScreen('home'); }} />
  );
  else view = (
    <>
    {pending && (
      <section className={s.cardAmber} style={{ marginBottom: 12 }} aria-label="Niezapisany trening">
        <span className={s.strong}>Niezapisany trening: {pending.script.name}</span>
        <span className={s.small}>
          {new Date(pending.startedAt).toLocaleString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          {' · '}{hmmss(pending.summary.durationSec)} · NP {pending.summary.normalizedPower} W
        </span>
        {pendingState.err && <span className={s.small} style={{ color: 'var(--danger)' }}>{pendingState.err}</span>}
        <div className={s.grid2}>
          <button type="button" className={s.btnAmber} onClick={savePending} disabled={pendingState.busy}>{pendingState.busy ? 'Zapisuję…' : 'Zapisz w VeloIQ'}</button>
          <button type="button" className={s.btnGhost} onClick={clearPending} disabled={pendingState.busy}>Odrzuć</button>
        </div>
      </section>
    )}
    <HomeScreen ride={ride} plan={plan} planLabel={planLabel} dateLabel={dateLabel[0].toUpperCase() + dateLabel.slice(1)}
      settings={settings} onSettings={updateSettings}
      onStart={() => setScreen('pre')} onFree={() => start(freeRideScript(ftp))} onSensors={() => setScreen('sensors')} />
    </>
  );

  return (
    <>
      {view}
      {!ride.native && screen === 'live' && (
        <div className={s.devBar} style={{ position: 'fixed', right: 12, top: 12, zIndex: 60, backgroundColor: '#1A1D23', padding: '6px 10px', borderRadius: 10, border: '1px solid #262A31' }}>
          Symulacja:
          {[1, 10, 30].map((x) => (
            <button key={x} type="button" className={simSpeed === x ? s.segBtnOn : s.segBtn} style={{ height: 32, padding: '0 10px' }}
              onClick={() => { setSimSpeed(x); ride.setSimSpeed(x); }}>{x}×</button>
          ))}
        </div>
      )}
    </>
  );
}
