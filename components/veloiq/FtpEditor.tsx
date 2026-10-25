'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { C, F, RADIUS } from '@/lib/theme';

// ── Ręczne FTP ──────────────────────────────────────────────────────────────────
// Gdy automat zaniża (np. po przerwie bez mocnych jazd). Silnik może potem FTP tylko podnieść,
// a waty w planie (od dziś) są przeliczane od razu.
export function FtpEditor({ current, onClose }: { current: number | null; onClose: () => void }) {
  const router = useRouter();
  const [val, setVal] = useState(current ? String(current) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = Math.round(Number(val));
  const ok = Number.isFinite(n) && n >= 80 && n <= 600;
  async function save() {
    if (!ok || busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/ftp/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ftp: n }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message ?? j.error ?? `błąd ${res.status}`);
      onClose();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Nie udało się zapisać');
    } finally { setBusy(false); }
  }
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: RADIUS.card, padding: 12, marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: C.text, fontWeight: 600, marginBottom: 8 }}>Ustaw FTP ręcznie</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="number" inputMode="numeric" min={80} max={600} value={val} autoFocus
          onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          style={{ width: 90, minWidth: 0, background: C.card2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 16, fontFamily: F.display }}
        />
        <span style={{ fontSize: 13, color: C.muted }}>W</span>
        <button onClick={save} disabled={!ok || busy}
          style={{ marginLeft: 'auto', background: C.cyan, color: C.bg, border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, opacity: !ok || busy ? 0.5 : 1, cursor: 'pointer' }}>
          {busy ? 'Zapisuję…' : 'Zapisz'}
        </button>
        <button onClick={onClose} disabled={busy}
          style={{ background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, cursor: 'pointer' }}>
          Anuluj
        </button>
      </div>
      <div style={{ fontSize: 11, color: err ? C.red : C.muted, lineHeight: 1.5, marginTop: 8 }}>
        {err ?? 'Waty w planie od dziś przeliczę na nowe FTP. Automat może je później tylko podnieść – nie obniży, dopóki nie pojedziesz mocno słabiej.'}
      </div>
    </div>
  );
}

