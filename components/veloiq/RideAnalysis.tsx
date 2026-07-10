'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { C } from '@/lib/theme';
import { formatPolishDate, formatDuration } from '@/lib/format';
import {
  buildSessionStructure,
  type LapInput,
  type ClassifiedLap,
  type SessionElement,
} from '@/lib/laps';
import { hasGps, hasWatts, lapZoneColor } from '@/lib/streams-view';
import type { StreamsJson } from '@/lib/strava/streams';
import { computeExecutionRing } from '@/lib/execution-ring';
import type { PlannedWorkout } from '@/lib/ai/insight';
import PowerChart from './PowerChart';
import PowerZoneBar from './PowerZoneBar';
import ExecutionRing from './ExecutionRing';

// Leaflet nie zna SSR (dotyka window przy imporcie) — mapa ładowana wyłącznie client-side.
const RideMap = dynamic(() => import('./RideMap'), { ssr: false });

// ── Typy ──────────────────────────────────────────────────────────────────────

export type RideLap = LapInput;

export interface RideActivity {
  name: string | null;
  activity_date: string;
  type: string | null;
  distance_km: number | null;
  elevation_m: number | null;
  duration_seconds: number | null;
  tss: number | null;
  avg_watts: number | null;
  avg_hr: number | null;
  best_efforts: Record<string, number> | null;
  laps: RideLap[] | null;
  // Metryki rozszerzone (PR1) — OPCJONALNE, żeby istniejące call-site'y (Plan/Calendar/LastActivity)
  // kompilowały się bez zmian; producent selectuje je → karta pokazuje, brak → "—".
  avg_cadence?: number | null;
  normalized_power?: number | null;   // NP z kolumny (spójne z PMC) — NIE liczymy ze streamów
  intensity_factor?: number | null;
  calories?: number | null;           // z detail endpointu
  avg_speed?: number | null;          // m/s (raw_data->average_speed)
  max_speed?: number | null;          // m/s
  kilojoules?: number | null;         // raw_data->kilojoules
}

interface RideAnalysisProps {
  activity: RideActivity;
  activityId: number;
  ftp: number | null;
  onClose: () => void;
}

// Okna best_effort pokazywane w karcie (6 — PR4). Warstwa danych (computeBestEfforts) liczy
// nadal wszystkie okna dla silnika FTP; tu tniemy tylko WYŚWIETLANIE. Brak danych dla okna
// (krótka jazda) → kafel pomijany filtrem efforts[k] != null poniżej.
const EFFORT_ORDER = ['15s', '1min', '5min', '10min', '20min', '30min'];

// Kolor wg % FTP
function ftpColor(pct: number | null): string {
  if (pct == null) return C.muted;
  if (pct > 105) return C.red;
  if (pct >= 90) return C.yellow;
  return C.green;
}

// ── Podsekcje ───────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: string }) {
  return (
    <div style={{
      fontSize: 10, color: C.cyan, textTransform: 'uppercase',
      letterSpacing: '2px', fontWeight: 600, marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: color ?? C.text, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
    </div>
  );
}

// ── AI Insight ────────────────────────────────────────────────────────────────

function buildFallbackInsight(activity: RideActivity, ftp: number | null): string {
  const best20 = activity.best_efforts?.['20min'] ?? null;
  const parts: string[] = [];
  if (activity.tss != null) parts.push(`obciążenie TSS ${Math.round(activity.tss)}`);
  if (best20 != null) {
    const pct = ftp ? ` (${Math.round((best20 / ftp) * 100)}% FTP)` : '';
    parts.push(`najlepsze 20 min ${best20}W${pct}`);
  } else if (activity.avg_hr != null) {
    parts.push(`średnie tętno ${activity.avg_hr} bpm`);
  }
  if (activity.distance_km != null) parts.push(`${activity.distance_km} km`);
  return `Podsumowanie po liczbach: ${parts.join(', ')}.`;
}

function AiInsight({ activityId, activity, ftp }: { activityId: number; activity: RideActivity; ftp: number | null }) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/activities/${activityId}/insight`, { method: 'POST' });
        if (!res.ok) throw new Error(`insight ${res.status}`);
        const data = await res.json();
        if (!cancelled) setText(data.insight || buildFallbackInsight(activity, ftp));
      } catch {
        if (!cancelled) setText(buildFallbackInsight(activity, ftp));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activityId, activity, ftp]);

  return (
    <div style={{
      background: C.purple + '14', border: `1px solid ${C.purple}44`, borderRadius: 10,
      padding: '12px 14px',
    }}>
      <div style={{
        fontSize: 10, color: C.purple, textTransform: 'uppercase', letterSpacing: '2px',
        fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6,
      }}>
        ✨ AI Insight
      </div>
      {loading ? (
        <div style={{ fontSize: 16, color: C.muted, fontStyle: 'italic' }}>Analizuję jazdę…</div>
      ) : (
        <div style={{ fontSize: 16, color: C.text, lineHeight: 1.5 }}>{text}</div>
      )}
    </div>
  );
}

// ── Profil mocy ───────────────────────────────────────────────────────────────

function PowerProfile({ efforts, ftp }: { efforts: Record<string, number> | null; ftp: number | null }) {
  if (!efforts || Object.keys(efforts).length === 0) {
    return (
      <div style={{ fontSize: 16, color: C.muted, padding: '8px 0' }}>
        Brak danych mocy — jazda na tętnie
      </div>
    );
  }

  const keys = EFFORT_ORDER.filter((k) => efforts[k] != null);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {keys.map((k) => {
        const watts = efforts[k];
        const pct = ftp ? Math.round((watts / ftp) * 100) : null;
        const color = ftpColor(pct);
        const barWidth = pct != null ? Math.min(pct, 100) : 0;
        return (
          <div key={k} style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
            padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {k}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{watts}</span>
              <span style={{ fontSize: 11, color: C.muted }}>W</span>
            </div>
            <div style={{ fontSize: 9, color: C.muted }}>
              {pct != null ? `${pct}% FTP` : '— % FTP'}
            </div>
            <div style={{ height: 4, borderRadius: 2, background: C.dim, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${barWidth}%`, background: color, borderRadius: 2 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Lapy: pojedyncza karta steady ───────────────────────────────────────────────

function LapCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: color ?? C.text, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 8, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
    </div>
  );
}

function SingleLapCard({ cl, accent }: { cl: ClassifiedLap; accent: string }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderLeft: `4px solid ${accent}`, borderRadius: 10,
      padding: '12px', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
          background: C.cyan + '1A', border: `1px solid ${C.cyan}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, color: C.cyan,
        }}>
          {cl.n}
        </div>
        <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>
          {cl.lap.name ?? `Lap ${cl.n}`}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        <LapCell label="Moc"     value={cl.watts != null ? `${cl.watts} W` : '—'} color={C.cyan} />
        <LapCell label="HR"      value={cl.hr != null ? `${cl.hr} bpm` : '—'} />
        <LapCell label="Czas"    value={formatDuration(cl.durationSec)} />
        <LapCell label="Dystans" value={cl.km != null ? `${cl.km.toFixed(2)} km` : '—'} />
      </div>
    </div>
  );
}

// ── Lapy: rozwijalny blok interwałowy ────────────────────────────────────────────

function IntervalRow({ cl, accent }: { cl: ClassifiedLap; accent: string }) {
  const isRecovery = cl.cls === 'recovery';
  const color = isRecovery ? C.muted : ftpColor(cl.pctFtp);
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '20px 1fr auto auto', gap: 10, alignItems: 'center',
      padding: '7px 8px', borderRadius: 6, borderLeft: `3px solid ${accent}`,
      background: isRecovery ? 'transparent' : C.dim,
      opacity: isRecovery ? 0.55 : 1,
    }}>
      <span style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>{cl.n}</span>
      <span style={{ fontSize: 12, color: C.text }}>
        {formatDuration(cl.durationSec)}
        {isRecovery && <span style={{ color: C.muted }}> · przerwa</span>}
      </span>
      <span style={{ fontSize: 13, fontWeight: 700, color, textAlign: 'right' }}>
        {cl.watts != null ? `${cl.watts}W` : '—'}
        {cl.pctFtp != null && (
          <span style={{ fontSize: 9, color: C.muted, fontWeight: 400 }}> {cl.pctFtp}%</span>
        )}
      </span>
      <span style={{ fontSize: 11, color: C.muted, textAlign: 'right', minWidth: 48 }}>
        {cl.hr != null ? `${cl.hr} bpm` : ''}
      </span>
    </div>
  );
}

function BlockCard({ laps, summary, accentOf }: { laps: ClassifiedLap[]; summary: { count: number; avgWatts: number | null; totalTimeSec: number; label: string }; accentOf: (cl: ClassifiedLap) => string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: '12px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
        }}
      >
        <div style={{
          width: 26, height: 26, borderRadius: 7, flexShrink: 0,
          background: C.yellow + '1A', border: `1px solid ${C.yellow}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
        }}>
          🔁
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
            Blok interwałowy · {summary.label}
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
            {summary.avgWatts != null ? `śr. ${summary.avgWatts}W · ` : ''}
            łącznie {formatDuration(summary.totalTimeSec)}
          </div>
        </div>
        <span style={{
          fontSize: 14, color: C.muted, flexShrink: 0,
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 150ms',
        }}>
          ›
        </span>
      </div>
      {open && (
        <div style={{
          padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 4,
          borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 0,
        }}>
          {laps.map((cl) => <IntervalRow key={cl.n} cl={cl} accent={accentOf(cl)} />)}
        </div>
      )}
    </div>
  );
}

// ── Write-back opisu do Stravy (Etap 1: przycisk → podgląd → potwierdzenie → PUT) ──
type WbState =
  | { s: 'idle' }
  | { s: 'loading' }
  | { s: 'preview'; preview: string; canWrite: boolean }
  | { s: 'no_session' }
  | { s: 'saving' }
  | { s: 'done'; message: string }
  | { s: 'error'; message: string; reconnect: boolean };

function WriteBackButton({ activityId }: { activityId: number }) {
  const [st, setSt] = useState<WbState>({ s: 'idle' });

  async function call(action: 'preview' | 'commit') {
    const r = await fetch(`/api/activities/${activityId}/describe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
    });
    return r.json();
  }

  async function doPreview() {
    setSt({ s: 'loading' });
    try {
      const d = await call('preview');
      if (!d.ok) {
        if (d.reason === 'no_session') return setSt({ s: 'no_session' });
        return setSt({ s: 'error', message: d.message ?? 'Nie udało się przygotować.', reconnect: d.reason === 'no_write_scope' });
      }
      if (d.alreadyDescribed) return setSt({ s: 'done', message: 'Ta jazda jest już opisana przez VeloIQ.' });
      setSt({ s: 'preview', preview: d.preview, canWrite: !!d.canWrite });
    } catch { setSt({ s: 'error', message: 'Błąd połączenia ze Stravą.', reconnect: false }); }
  }

  async function doCommit() {
    setSt({ s: 'saving' });
    try {
      const d = await call('commit');
      if (d.ok) return setSt({ s: 'done', message: d.saved ? '✓ Opisano w Strava' : (d.message ?? 'Już opisano.') });
      setSt({ s: 'error', message: d.message ?? 'Nie udało się zapisać.', reconnect: d.reason === 'no_write_scope' });
    } catch { setSt({ s: 'error', message: 'Błąd połączenia ze Stravą.', reconnect: false }); }
  }

  const btn: React.CSSProperties = { border: 'none', borderRadius: 9, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
  const reconnectCta = (
    <a href="/api/strava/auth" style={{ ...btn, background: '#FC4C02', color: '#fff', textDecoration: 'none', display: 'inline-block' }}>
      Rozszerz uprawnienia Strava (zapis opisów)
    </a>
  );

  if (st.s === 'no_session') return null; // nie sesja dnia → brak nazwy treningu, nic nie pokazujemy

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {st.s === 'idle' && (
        <button onClick={doPreview} style={{ ...btn, background: C.card, border: `1px solid ${C.border}`, color: C.text, alignSelf: 'flex-start' }}>
          🔗 Opisz w Strava
        </button>
      )}
      {st.s === 'loading' && <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>Przygotowuję podgląd…</div>}

      {st.s === 'preview' && (
        <>
          <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '1px' }}>Podgląd opisu w Strava</div>
          <pre style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: C.text, whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>{st.preview}</pre>
          {st.canWrite ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={doCommit} style={{ ...btn, background: C.green, color: C.bg }}>Zatwierdź zapis do Strava</button>
              <button onClick={() => setSt({ s: 'idle' })} style={{ ...btn, background: C.card, border: `1px solid ${C.border}`, color: C.muted }}>Anuluj</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11.5, color: C.yellow }}>Zapis opisów wymaga rozszerzenia uprawnień Strava (jednorazowo).</div>
              {reconnectCta}
            </div>
          )}
        </>
      )}

      {st.s === 'saving' && <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>Zapisuję do Strava…</div>}
      {st.s === 'done' && <div style={{ fontSize: 13, color: C.green, fontWeight: 600 }}>{st.message}</div>}
      {st.s === 'error' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12.5, color: C.red }}>{st.message}</div>
          {st.reconnect && reconnectCta}
        </div>
      )}
    </div>
  );
}

// ── RideAnalysis ────────────────────────────────────────────────────────────────

// Rozszerzone metryki (PR1) — skondensowane do dwukolumnowej listy label–wartość
// (feedback: "za wiele okien"; grid dużych kafli rozpychał kartę). Kadencja/prędkość/kJ/kalorie
// z danych, NP/IF z kolumn (spójne z PMC). Tylko wiersze z wartością (brak → pomijamy).
function ExtendedMetrics({ activity }: { activity: RideActivity }) {
  const kmh = (ms: number | null | undefined) => (ms != null ? Math.round(ms * 3.6 * 10) / 10 : null);
  const cells: { label: string; value: string }[] = [];
  if (activity.normalized_power != null) cells.push({ label: 'NP', value: `${activity.normalized_power} W` });
  if (activity.intensity_factor != null) cells.push({ label: 'IF', value: activity.intensity_factor.toFixed(2) });
  // Moc śr — e-bike ukryte (avg_watts = moc silnika, nierzetelna; spójnie z insight/best efforts).
  if (activity.avg_watts != null && activity.type !== 'EBikeRide') cells.push({ label: 'Moc śr', value: `${activity.avg_watts} W` });
  if (activity.avg_hr != null) cells.push({ label: 'Tętno śr', value: `${activity.avg_hr} bpm` });
  if (activity.avg_cadence != null) cells.push({ label: 'Kadencja', value: `${activity.avg_cadence} rpm` });
  const avgKmh = kmh(activity.avg_speed);
  if (avgKmh != null) cells.push({ label: 'Prędkość śr', value: `${avgKmh} km/h` });
  const maxKmh = kmh(activity.max_speed);
  if (maxKmh != null) cells.push({ label: 'Prędkość max', value: `${maxKmh} km/h` });
  if (activity.calories != null) cells.push({ label: 'Kalorie', value: `${activity.calories} kcal` });

  if (cells.length === 0) return null;
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: '10px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16, rowGap: 6,
    }}>
      {cells.map((c) => (
        <div key={c.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {c.label}
          </span>
          <span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>{c.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Streams (mapa + wykres) ─────────────────────────────────────────────────────

type StreamsState =
  | { s: 'loading' }
  | { s: 'ready'; streams: StreamsJson }
  | { s: 'unavailable' };

// Sekcja mapy: loading → skeleton; GPS → mapa; unavailable → placeholder z retry W MIEJSCU
// (klik ponawia POST bez zamykania karty). Jazda bez GPS (trenażer) → parent pomija sekcję.
function MapPlaceholder({ loading, onRetry }: { loading: boolean; onRetry: () => void }) {
  return (
    <div
      onClick={loading ? undefined : onRetry}
      role={loading ? undefined : 'button'}
      style={{
        height: 280, borderRadius: 12, border: `1px dashed ${C.border}`, background: C.card,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 6, cursor: loading ? 'default' : 'pointer',
      }}
    >
      {loading ? (
        <div style={{ fontSize: 16, color: C.muted, fontStyle: 'italic' }}>Ładuję trasę…</div>
      ) : (
        <>
          <div style={{ fontSize: 16, color: C.muted }}>Otwórz ponownie, aby załadować mapę</div>
          <div style={{ fontSize: 16, color: C.cyan }}>albo dotknij tutaj, żeby spróbować teraz</div>
        </>
      )}
    </div>
  );
}

export function RideAnalysis({ activity, activityId, ftp, onClose }: RideAnalysisProps) {
  const laps = activity.laps ?? [];
  const structure: SessionElement[] = buildSessionStructure(laps, ftp);

  // Akcent strefowy lapu: średnia moc → strefa → kolor (ta sama paleta co mapa/pasek). E-bike
  // → moc z silnika zafałszowałaby strefę, więc neutralny szary (spójnie z resztą karty).
  // Brak mocy/FTP → szary (fallback HR poza zakresem — karta nie ma HRmax).
  const isEbike = activity.type === 'EBikeRide';
  const lapAccent = (cl: ClassifiedLap) => (isEbike ? C.muted : lapZoneColor(cl.watts, ftp));

  // Streams (on-demand + persist) — PR2 konsumuje odpowiedź (mapa + wykres). Endpoint sam
  // cache'uje (2. otwarcie = zero calla Stravy). Błąd → placeholder z retry, karta działa dalej.
  const [streamsState, setStreamsState] = useState<StreamsState>({ s: 'loading' });
  const loadStreams = useCallback(async () => {
    setStreamsState({ s: 'loading' });
    try {
      const res = await fetch(`/api/activities/${activityId}/streams`, { method: 'POST' });
      const data = await res.json();
      if (data.ok && data.streams && (data.streams as StreamsJson).n > 0) {
        setStreamsState({ s: 'ready', streams: data.streams as StreamsJson });
      } else {
        setStreamsState({ s: 'unavailable' });
      }
    } catch {
      setStreamsState({ s: 'unavailable' });
    }
  }, [activityId]);
  useEffect(() => { void loadStreams(); }, [loadStreams]);

  const streams = streamsState.s === 'ready' ? streamsState.streams : null;
  const showMap = streams ? hasGps(streams) : streamsState.s !== 'ready'; // bez GPS → sekcja znika
  const showChart = streams != null && hasWatts(streams);

  // Zaplanowany dzień (ten sam matcher po dacie co AI Insight) — do pierścienia realizacji.
  // undefined = ładowanie, null = brak planu/OFF/niezaplanowana. Błąd → null (ring ukryty).
  const [planned, setPlanned] = useState<PlannedWorkout | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/activities/${activityId}/planned`, { method: 'POST' });
        const data = await res.json();
        if (!cancelled) setPlanned(data.ok ? (data.planned as PlannedWorkout | null) : null);
      } catch {
        if (!cancelled) setPlanned(null);
      }
    })();
    return () => { cancelled = true; };
  }, [activityId]);

  // Pierścień realizacji celu — dostępny tylko gdy jest plan + streams z mocą (logika w helperze).
  const ring = planned && streams ? computeExecutionRing(planned, streams, ftp, isEbike) : { available: false as const };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        overflowY: 'auto', padding: '16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.bg, border: `1px solid ${C.border}`, borderRadius: 14,
          width: '100%', maxWidth: 560, padding: '16px',
          display: 'flex', flexDirection: 'column', gap: 18,
        }}
      >
        {/* Nagłówek */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>
              {activity.name ?? 'Jazda'}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              {formatPolishDate(activity.activity_date)}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
              width: 32, height: 32, color: C.muted, fontSize: 18, lineHeight: 1,
              cursor: 'pointer', flexShrink: 0,
            }}
            aria-label="Zamknij"
          >
            ×
          </button>
        </div>

        {/* Mapa trasy — główny element (animowane rysowanie trasy; bez GPS → sekcja znika) */}
        {showMap && (
          streams
            ? <RideMap streams={streams} />
            : <MapPlaceholder loading={streamsState.s === 'loading'} onRetry={loadStreams} />
        )}

        {/* Wykres mocy (30 s) + linia FTP; jazda na HR → brak sekcji */}
        {showChart && streams && <PowerChart streams={streams} ftp={ftp} />}

        {/* Pasek rozkładu stref mocy pod wykresem (te same watts wygładzone 30 s co mapa) */}
        {showChart && streams && <PowerZoneBar streams={streams} ftp={ftp} />}

        {/* Pierścień realizacji celu dnia — przy głównych kaflach; brak planu/mocy → ukryty */}
        {ring.available && (
          <ExecutionRing pct={ring.pct} doneMin={ring.doneMin} targetMin={ring.targetMin} />
        )}

        {/* Statystyki */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          <StatCard label="Dystans"   value={activity.distance_km != null ? `${activity.distance_km} km` : '—'} color={C.cyan} />
          <StatCard label="Wzniosy"   value={activity.elevation_m != null ? `${Math.round(activity.elevation_m)} m` : '—'} />
          <StatCard label="Czas"      value={activity.duration_seconds != null ? formatDuration(activity.duration_seconds) : '—'} />
          <StatCard label="Obciążenie" value={activity.tss != null ? `${Math.round(activity.tss)}` : '—'} color={C.yellow} />
        </div>

        {/* Metryki rozszerzone (PR1) — skondensowana lista 2-kolumnowa; puste wiersze pomijane */}
        <ExtendedMetrics activity={activity} />

        {/* AI Insight */}
        <AiInsight activityId={activityId} activity={activity} ftp={ftp} />

        {/* Write-back opisu do Stravy — przycisk + podgląd + potwierdzenie (Etap 1) */}
        <WriteBackButton activityId={activityId} />

        {/* Profil mocy */}
        <div>
          <SectionTitle>Profil mocy · Best efforts</SectionTitle>
          <PowerProfile efforts={activity.best_efforts} ftp={ftp} />
        </div>

        {/* Struktura sesji */}
        <div>
          <SectionTitle>Struktura sesji · Okrążenia</SectionTitle>
          {structure.length === 0 ? (
            <div style={{ fontSize: 16, color: C.muted }}>Brak danych o okrążeniach</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {structure.map((el, i) =>
                el.type === 'single'
                  ? <SingleLapCard key={`s${el.lap.n}`} cl={el.lap} accent={lapAccent(el.lap)} />
                  : <BlockCard key={`b${i}`} laps={el.laps} summary={el.summary} accentOf={lapAccent} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
