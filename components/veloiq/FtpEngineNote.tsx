'use client';

import { useState } from 'react';
import { C } from '@/lib/theme';

// Subtelna, jednorazowa notka po podmianie tymczasowego FTP na policzony przez silnik.
// Widoczna gdy ftp_source='engine' && !ftp_engine_note_seen && ftp_prev_value (serwer decyduje).
// Dismiss → POST znaczy flagę seen=true (nie wróci). Delta ▲/▼ kolorem.
export function FtpEngineNote({ from, to }: { from: number; to: number }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const up = to >= from;

  async function dismiss() {
    setHidden(true); // optymistycznie
    try { await fetch('/api/ftp/engine-note', { method: 'POST' }); } catch { /* flaga zostanie na następny sync */ }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: C.cyan + '14', border: `1px solid ${C.cyan}44`, borderRadius: 10, padding: '10px 12px', marginBottom: 12,
    }}>
      <span style={{ fontSize: 16 }}>⚡</span>
      <div style={{ flex: 1, fontSize: 13, color: C.text, lineHeight: 1.4 }}>
        Zaktualizowaliśmy Twój FTP na podstawie historii:{' '}
        <span style={{ color: C.muted }}>{from} W</span>
        <span style={{ color: up ? C.green : C.yellow, fontWeight: 600 }}> → {to} W</span>
      </div>
      <button type="button" onClick={dismiss} aria-label="Zamknij"
        style={{ background: 'none', border: 'none', color: C.muted, fontSize: 18, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>
        ×
      </button>
    </div>
  );
}
