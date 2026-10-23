// Most JS ↔ natywny RideEngine (iOS). Użycie w UI Next.js/Capacitor.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { WorkoutScript } from './workout-script';

export type SensorKind = 'hr' | 'power' | 'power2'; // power2 = druga strona pomiaru dwustronnego (np. korby L+R)
export type VoiceLevel = 'full' | 'struct' | 'off';

/** enzo = Dyrektor Enzo (nagrane klipy, offline) | system = głos iOS */
export type VoiceMode = 'enzo' | 'system';
export interface VoiceInfo { id: string; name: string; quality: 'default' | 'enhanced' | 'premium' }
export interface SensorFound { id: string; name: string; kind: SensorKind; rssi: number }
export interface SensorData { power?: number; cadence?: number; hr?: number; balanceL?: number }
export interface SensorStatus { kind: SensorKind; id: string; name?: string; connected: boolean }

export interface SeriesResult {
  n: number; durationSec: number; plannedSec: number; avgPower: number; compliancePct: number;
  avgHr?: number; endedEarly: boolean; restBeforeSec?: number; startSec: number;
}
export interface EffortResult { startSec: number; durationSec: number; avgPower: number }

/** running – krok trwa | armed – za chwilę interwał, czekam na start | waiting – przerwa się przeciąga
 *  autoPaused – postój w interwale | paused – pauza ręczna | free – po planie / jazda swobodna */
export type RidePhase = 'running' | 'armed' | 'waiting' | 'autoPaused' | 'paused' | 'free';

export interface LiveSample {
  elapsed: number;        // s aktywnego czasu
  phase: RidePhase;
  stepIndex: number;
  stepName: string;
  stepType: string;       // warmup | interval | recovery | steady | cooldown | free
  stepElapsed: number;    // s aktywne w kroku (bez auto-pauzy)
  stepRemaining: number;  // s
  overrunSec: number;     // o ile przeciąga się przerwa przed interwałem
  lastSeries?: SeriesResult;
  power?: number;         // W chwilowe
  power3s?: number;
  powerSmooth?: number;   // średnia z okna smoothingSec
  hr?: number;
  cadence?: number;
  balanceL?: number;
  targetLow: number;
  targetHigh: number;
  inRange?: boolean;
  lat?: number;
  lon?: number;
}

export interface WorkoutSummary {
  file: string;            // nazwa pliku JSONL z zapisem 1 Hz (do readRecording)
  durationSec: number;
  avgPower: number;
  normalizedPower: number;
  avgHr?: number;
  maxHr?: number;
  kJ: number;
  compliancePct: number;   // % czasu interwałów w zakresie
  series: SeriesResult[];  // faktyczne serie (start, czas, moc, przerwa przed)
  efforts: EffortResult[]; // wysiłki wykryte w jeździe swobodnej
}

export interface RideEnginePlugin {
  scan(options: { kinds?: SensorKind[] }): Promise<void>;
  stopScan(): Promise<void>;
  /** power2Id: druga strona (moc = suma L+R); '' = usuń drugą stronę. */
  connect(options: { hrId?: string; powerId?: string; power2Id?: string }): Promise<void>;
  disconnect(): Promise<void>;
  /** Ostatnio używane czujniki (łączenie automatyczne). */
  getSavedSensors(): Promise<{ hrId?: string; powerId?: string; power2Id?: string }>;
  zeroOffset(): Promise<void>;

  /** script.steps = [] → jazda swobodna (nagrywanie + automatyczne wykrywanie wysiłków). */
  startWorkout(options: {
    script: WorkoutScript; outdoor?: boolean; simulate?: boolean;
    /** full – wszystko | struct – bez korekt i pochwał | off – bez głosu (tekst nadal w zdarzeniu 'cue') */
    voiceLevel?: VoiceLevel;
    /** false = bez zapowiedzi „Za minutę interwał…” (odliczanie zostaje) */
    announceArm?: boolean;
  }): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Kończy aktywność (nagrywanie). Koniec planu NIE kończy nagrywania – patrz 'planFinished'. */
  stopWorkout(): Promise<WorkoutSummary>;
  /** "Następny krok" – pomija bieżący krok (np. przerwę). */
  skipStep(): Promise<void>;
  /** Czy po awarii aplikacji jest trening do wznowienia. */
  getRecoverable(): Promise<{ available: boolean; name?: string; elapsed?: number }>;
  /** Wznawia w pauzie od ostatniej zapisanej sekundy – UI pokazuje przycisk "Wznów" (resume()). */
  resumeRecovered(): Promise<{ paused: boolean; elapsed: number }>;
  discardRecovered(): Promise<void>;

  testVoice(options: { text: string }): Promise<void>;
  /** Głosy pl-PL zainstalowane w telefonie (lepsze: Ustawienia → Dostępność → Treść mówiona → Głosy). */
  getVoices(options?: { language?: string }): Promise<{ voices: VoiceInfo[]; current?: string; rate: number; mode?: VoiceMode; packs?: { id: string; name: string }[] }>;
  /** Wybór głosu i tempa (0.35–0.65, domyślnie 0.5) – zapamiętywane w telefonie. */
  /** name: imię zawodnika – Dyrektor użyje go rzadko, w kluczowych momentach (jeśli ma nagranie). */
  setVoice(options: { id?: string; rate?: number; mode?: VoiceMode; name?: string }): Promise<void>;
  /** Odczyt zapisu treningu (JSONL jako tekst) – do wysłania do Supabase. */
  readRecording(options: { file: string }): Promise<{ data: string }>;

  addListener(event: 'sensorFound', cb: (d: SensorFound) => void): Promise<PluginListenerHandle>;
  addListener(event: 'sensor', cb: (d: SensorStatus) => void): Promise<PluginListenerHandle>;
  addListener(event: 'live', cb: (d: LiveSample) => void): Promise<PluginListenerHandle>;
  /** Podgląd czujników poza treningiem (ekran Czujniki), ~1 Hz. */
  addListener(event: 'sensorData', cb: (d: SensorData) => void): Promise<PluginListenerHandle>;
  addListener(event: 'cue', cb: (d: { text: string; kind: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'paused', cb: (d: { elapsed: number; recovered?: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'planFinished', cb: (d: WorkoutSummary) => void): Promise<PluginListenerHandle>;
  addListener(event: 'finished', cb: (d: WorkoutSummary) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

export const RideEngine = registerPlugin<RideEnginePlugin>('RideEngine');
