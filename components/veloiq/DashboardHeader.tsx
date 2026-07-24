'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { C, F } from '@/lib/theme';
import { LogoVeloIQ } from './LogoVeloIQ';

// HH:MM z ISO w strefie lokalnej przeglądarki (spójnie z "zsynchronizowano teraz").
function hhmm(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

type Sync =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; at: string | null; color: string; msg?: string };

// Ikona odświeżania 18px (inline SVG — lucide dochodzi w ETAP 3). Wiruje podczas synchronizacji.
function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={spinning ? { animation: 'veloiq-spin 0.8s linear infinite' } : undefined}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}

// Header dashboardu: logo (lewa) + powitanie ze statusem synchronizacji + ikona sync (prawa).
// Absorbuje logikę dawnego SyncButton — status "zsynchronizowano HH:MM" ląduje w linii powitania,
// nie na przycisku. lastSyncedAt = czas ostatniej jazdy zsynchronizowanej (z page.tsx, RSC).
export function DashboardHeader({
  athleteName,
  lastSyncedAt,
}: {
  athleteName: string;
  lastSyncedAt: string | null;
}) {
  const [sync, setSync] = useState<Sync>({ kind: 'idle' });
  const router = useRouter();

  async function handleSync() {
    if (sync.kind === 'loading') return;
    setSync({ kind: 'loading' });
    try {
      const res = await fetch('/api/strava/sync');
      const d = await res.json().catch(() => ({}));
      if (d.skipped) {
        setSync({ kind: 'done', at: new Date().toISOString(), color: C.muted });
        router.refresh();
      } else if (typeof d.synced === 'number') {
        setSync({ kind: 'done', at: new Date().toISOString(), color: C.green });
        router.refresh();
      } else {
        throw new Error(d.error ?? 'sync failed');
      }
    } catch {
      setSync({ kind: 'done', at: null, color: C.red, msg: 'nie udało się — spróbuj ponownie' });
    } finally {
      setTimeout(() => setSync((s) => (s.kind === 'done' ? { kind: 'idle' } : s)), 4000);
    }
  }

  // Linia statusu pod powitaniem. Idle → ostatni sync z danych; loading/done → bieżący.
  const status: { text: string; color: string } | null = (() => {
    if (sync.kind === 'loading') return { text: 'synchronizuję…', color: C.muted };
    if (sync.kind === 'done') {
      if (sync.msg) return { text: sync.msg, color: sync.color };
      const t = hhmm(sync.at);
      return t ? { text: `zsynchronizowano ${t}`, color: sync.color } : null;
    }
    const t = hhmm(lastSyncedAt);
    return t ? { text: `zsynchronizowano ${t}`, color: C.muted } : null;
  })();

  return (
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
      <LogoVeloIQ />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ textAlign: 'right', lineHeight: 1.3 }}>
          <div style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>Cześć, {athleteName} 👋</div>
          {status && (
            <div style={{ fontSize: 10, color: status.color, fontFamily: F.mono, letterSpacing: '0.04em', marginTop: 2 }}>
              {status.text}
            </div>
          )}
        </div>
        <button
          onClick={handleSync}
          disabled={sync.kind === 'loading'}
          aria-label="Synchronizuj ze Stravą"
          style={{
            width: 36, height: 36, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
            color: sync.kind === 'loading' ? C.muted : C.text,
            cursor: sync.kind === 'loading' ? 'default' : 'pointer',
            transition: 'color 120ms, border-color 120ms',
          }}
        >
          <RefreshIcon spinning={sync.kind === 'loading'} />
        </button>
      </div>
    </header>
  );
}
