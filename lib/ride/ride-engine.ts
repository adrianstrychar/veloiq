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
  verdict?: 'ok' | 'high' | 'low'; deltaW?: number;   // w zakresie / mocniej / słabiej (o ile W)
}
export interface LapMark { startSec: number; name: string; type: string }
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
  falseStartLeft?: number; // s, w których można jeszcze odwołać start interwału (falstart)
  stepAvgPower?: number;   // średnia moc bieżącego kroku (np. interwału)
  vKmh?: number;           // wirtualna prędkość (trenażer)
  vKm?: number;            // wirtualny dystans (trenażer)
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
  laps?: LapMark[];        // kroki planu jako lapy (Strava)
}

/** Przycisk Flic 2 na kierownicy (natywnie, SDK flic2lib). available=false → stara wersja aplikacji / web. */
export interface FlicStatus {
  available: boolean;
  bluetoothOn?: boolean;
  scanning?: boolean;
  scanPhase?: 'searching' | 'discovered' | 'connecting' | 'verified' | 'failed';
  paired?: boolean;
  name?: string;
  connected?: boolean;
  ready?: boolean;
  battery?: number;          // %
  ok?: boolean;              // wynik flicScan
  error?: string;            // komunikat po polsku
}
export type FlicPress = 'click' | 'double' | 'hold';

/** Most do licznika Garmin Edge (natywnie, Connect IQ Mobile SDK): czujniki sparowane z licznikiem (ANT+),
 *  telefon dostaje z niego moc / tętno / kadencję i mówi głosem Enzo. available=false → stara wersja aplikacji / web. */
export interface GarminLinkStatus {
  available: boolean;
  paired?: boolean;          // wybrano licznik w Garmin Connect
  name?: string;
  connected?: boolean;       // licznik w zasięgu telefonu
  appInstalled?: boolean;    // aplikacja VeloIQ jest na liczniku (brak pola = jeszcze nie wiadomo)
  streaming?: boolean;       // licznik nadaje dane (aplikacja VeloIQ na liczniku jest otwarta)
  recording?: boolean;       // licznik nagrywa jazdę
  power?: number; hr?: number; cadence?: number;
  ride?: 'start' | 'pause' | 'resume' | 'end' | 'idle';
  edgeVersion?: string;      // wersja aplikacji VeloIQ na liczniku (odpowiedź na „hello”)
  lastMessageAgo?: number;   // s od ostatniej wiadomości z licznika
  log?: string[];            // dziennik mostu (diagnostyka na ekranie Czujniki)
}

/** Jazda prowadzona przez licznik Garmin (tryb lustra): START na liczniku = ta sama sesja w telefonie.
 *  Telefon nie nagrywa – pokazuje dane na żywo, mówi głosem Enzo, a jazdę zapisuje i wysyła licznik. */
export interface GarminRide {
  state: 'start' | 'end';
  key: number;               // start jazdy na liczniku (epoch s) – ten sam klucz co wysyłka do VeloIQ
  name: string;
  script: WorkoutScript;     // plan z licznika (steps = [] → jazda swobodna)
  startedAt: number;         // ms
  indoor?: boolean;
  free?: boolean;
  paused?: number;           // 0 jazda, 1 pauza, 2 postój
  elapsed?: number;
  known?: boolean;           // false = stara wersja aplikacji na liczniku (bez planu)
  sync?: boolean;            // odświeżenie trwającej jazdy (nie nowa jazda)
  // koniec jazdy
  saved?: number;            // 1 zapisana · 0 odrzucona · -1 nie wiadomo
  durationSec?: number;
  np?: number;
  avgPower?: number;
  upload?: number;           // 0 = za krótka, licznik jej nie wysyła
}

export interface CoachEvent { state: 'listening' | 'question' | 'answer' | 'error' | 'idle'; text?: string }

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
    autoPause?: boolean; notifications?: boolean;
    route?: import('./gpx').RideRoute;
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
  /** „Falstart” – odwołuje świeżo wykryty start interwału (czekanie wraca). */
  cancelStart(): Promise<void>;
  /** Wyłączenie / włączenie nawigacji GPX w trakcie jazdy. */
  setNavEnabled(options: { enabled: boolean }): Promise<void>;
  /** Czy po awarii aplikacji jest trening do wznowienia. */
  getRecoverable(): Promise<{ available: boolean; name?: string; elapsed?: number }>;
  /** Wznawia w pauzie od ostatniej zapisanej sekundy – UI pokazuje przycisk "Wznów" (resume()). */
  resumeRecovered(): Promise<{ paused: boolean; elapsed: number }>;
  discardRecovered(): Promise<void>;

  testVoice(options: { text: string }): Promise<void>;
  /** Podsumowanie Enzo po jeździe: seria po serii + rada (głos Enzo z klipów, inaczej synteza tekstu). */
  debrief(options: { series: { n: number; total: number; avg: number; vrd: string }[]; tip: string; text: string }): Promise<void>;
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
  addListener(event: 'paused', cb: (d: { elapsed: number; recovered?: boolean; auto?: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'planFinished', cb: (d: WorkoutSummary) => void): Promise<PluginListenerHandle>;
  addListener(event: 'finished', cb: (d: WorkoutSummary) => void): Promise<PluginListenerHandle>;
  addListener(event: 'coach', cb: (d: CoachEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'nav', cb: (d: import('@/components/ride/RouteCard').NavState) => void): Promise<PluginListenerHandle>;
  addListener(event: 'resumed', cb: (d: { elapsed: number }) => void): Promise<PluginListenerHandle>;
  /** Rozmowa z Enzo: token do /api/ride/ask, adres serwera, dotknięcie słuchawki = pytanie. */
  setCoach(options: { token: string; baseUrl: string; tapMode: boolean }): Promise<void>;
  /** Przycisk „Zapytaj Enzo”. */
  talk(): Promise<void>;
  /** Przycisk Flic: stan, parowanie (przytrzymaj Flic ~7 s), anulowanie, usunięcie. */
  flicStatus(): Promise<FlicStatus>;
  flicScan(): Promise<FlicStatus>;
  flicStopScan(): Promise<void>;
  flicForget(): Promise<FlicStatus>;
  /** Zmiana stanu przycisku albo wciśnięcie ({ press }) – też poza jazdą (test na ekranie Czujniki). */
  addListener(event: 'flic', cb: (d: FlicStatus & { press?: FlicPress }) => void): Promise<PluginListenerHandle>;
  /** Licznik Garmin Edge: stan mostu, wybór licznika (otwiera Garmin Connect), usunięcie, otwarcie VeloIQ na liczniku. */
  garminStatus(): Promise<GarminLinkStatus>;
  garminChoose(): Promise<void>;
  garminForget(): Promise<GarminLinkStatus>;
  garminOpenApp(): Promise<void>;
  /** Polecenie dla aplikacji na liczniku: "resync" – pobierz trasę z VeloIQ teraz (także w trakcie jazdy). */
  garminCommand(o: { cmd: 'resync' }): Promise<void>;
  /** Bieżąca jazda z licznika (po otwarciu / powrocie aplikacji) + prośba do licznika o pełny stan. */
  garminSync(): Promise<GarminLinkStatus & { mirror?: GarminRide }>;
  addListener(event: 'garmin', cb: (d: GarminLinkStatus) => void): Promise<PluginListenerHandle>;
  /** Start / koniec jazdy na liczniku (tryb lustra). W trakcie: zwykłe zdarzenia 'live', 'cue', 'paused', 'resumed'. */
  addListener(event: 'garminRide', cb: (d: GarminRide) => void): Promise<PluginListenerHandle>;
  /** Plan zmieniony głosem w trakcie jazdy z telefonu (dłuższy krok, cele ±%, dodatkowy interwał). */
  addListener(event: 'planChanged', cb: (d: { steps: WorkoutScript['steps']; bias: number }) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

export const RideEngine = registerPlugin<RideEnginePlugin>('RideEngine');
