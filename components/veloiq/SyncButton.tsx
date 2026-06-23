'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { C } from '@/lib/theme';

type Status = { kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; text: string; color: string };

export function SyncButton() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const router = useRouter();

  async function handleSync() {
    if (status.kind === 'loading') return;
    setStatus({ kind: 'loading' });
    try {
      const res = await fetch('/api/strava/sync');
      const d = await res.json().catch(() => ({}));
      if (d.skipped) {
        // cooldown: dane świeże — info, nie błąd; mimo to odśwież widok.
        setStatus({ kind: 'done', text: 'Dane są aktualne (sync <60 min temu)', color: C.muted });
        router.refresh();
      } else if (typeof d.synced === 'number') {
        const n = d.synced;
        setStatus({ kind: 'done', text: `✓ Zsynchronizowano ${n} ${jazdaWord(n)}`, color: C.green });
        router.refresh();
      } else {
        throw new Error(d.error ?? 'sync failed');
      }
    } catch {
      setStatus({ kind: 'done', text: 'Nie udało się — spróbuj ponownie', color: C.red });
    } finally {
      // Wróć do idle po ~3s (tylko jeśli nie trwa już nowy sync).
      setTimeout(() => setStatus((s) => (s.kind === 'done' ? { kind: 'idle' } : s)), 3000);
    }
  }

  const label =
    status.kind === 'loading' ? 'Synchronizuję…' : status.kind === 'done' ? status.text : '🔄 Synchronizuj';
  const color = status.kind === 'done' ? status.color : C.text;

  return (
    <button
      onClick={handleSync}
      disabled={status.kind === 'loading'}
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: '6px 10px',
        fontSize: 12,
        fontWeight: 600,
        color,
        cursor: status.kind === 'loading' ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
        transition: 'color 120ms, border-color 120ms',
      }}
    >
      {label}
    </button>
  );
}

function jazdaWord(n: number): string {
  if (n === 1) return 'jazdę';
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'jazdy';
  return 'jazd';
}
