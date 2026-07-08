'use client';

import { useState, useEffect } from 'react';
import { C } from '@/lib/theme';
import { formatPolishDate, formatDuration } from '@/lib/format';
import {
  buildSessionStructure,
  type LapInput,
  type ClassifiedLap,
  type SessionElement,
} from '@/lib/laps';

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
}

interface RideAnalysisProps {
  activity: RideActivity;
  activityId: number;
  ftp: number | null;
  onClose: () => void;
}

// Stała kolejność okien best_effort
const EFFORT_ORDER = ['5s', '15s', '1min', '5min', '8min', '10min', '20min', '30min', '1h'];

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
        <div style={{ fontSize: 13, color: C.muted, fontStyle: 'italic' }}>Analizuję jazdę…</div>
      ) : (
        <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>{text}</div>
      )}
    </div>
  );
}

// ── Profil mocy ───────────────────────────────────────────────────────────────

function PowerProfile({ efforts, ftp }: { efforts: Record<string, number> | null; ftp: number | null }) {
  if (!efforts || Object.keys(efforts).length === 0) {
    return (
      <div style={{ fontSize: 13, color: C.muted, padding: '8px 0' }}>
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

function SingleLapCard({ cl }: { cl: ClassifiedLap }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
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

function IntervalRow({ cl }: { cl: ClassifiedLap }) {
  const isRecovery = cl.cls === 'recovery';
  const color = isRecovery ? C.muted : ftpColor(cl.pctFtp);
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '20px 1fr auto auto', gap: 10, alignItems: 'center',
      padding: '7px 8px', borderRadius: 6,
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

function BlockCard({ laps, summary }: { laps: ClassifiedLap[]; summary: { count: number; avgWatts: number | null; totalTimeSec: number; label: string } }) {
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
          {laps.map((cl) => <IntervalRow key={cl.n} cl={cl} />)}
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

export function RideAnalysis({ activity, activityId, ftp, onClose }: RideAnalysisProps) {
  const laps = activity.laps ?? [];
  const structure: SessionElement[] = buildSessionStructure(laps, ftp);

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

        {/* AI Insight */}
        <AiInsight activityId={activityId} activity={activity} ftp={ftp} />

        {/* Write-back opisu do Stravy — przycisk + podgląd + potwierdzenie (Etap 1) */}
        <WriteBackButton activityId={activityId} />

        {/* Statystyki */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          <StatCard label="Dystans"   value={activity.distance_km != null ? `${activity.distance_km} km` : '—'} color={C.cyan} />
          <StatCard label="Wzniosy"   value={activity.elevation_m != null ? `${Math.round(activity.elevation_m)} m` : '—'} />
          <StatCard label="Czas"      value={activity.duration_seconds != null ? formatDuration(activity.duration_seconds) : '—'} />
          <StatCard label="Obciążenie" value={activity.tss != null ? `${Math.round(activity.tss)}` : '—'} color={C.yellow} />
        </div>

        {/* Profil mocy */}
        <div>
          <SectionTitle>Profil mocy · Best efforts</SectionTitle>
          <PowerProfile efforts={activity.best_efforts} ftp={ftp} />
        </div>

        {/* Struktura sesji */}
        <div>
          <SectionTitle>Struktura sesji · Okrążenia</SectionTitle>
          {structure.length === 0 ? (
            <div style={{ fontSize: 13, color: C.muted }}>Brak danych o okrążeniach</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {structure.map((el, i) =>
                el.type === 'single'
                  ? <SingleLapCard key={`s${el.lap.n}`} cl={el.lap} />
                  : <BlockCard key={`b${i}`} laps={el.laps} summary={el.summary} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
