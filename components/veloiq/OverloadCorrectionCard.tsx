'use client';

// Karta auto-korekty planu po przeciążeniu — diff + [Zatwierdź]/[Odrzuć]. Klik działa
// DETERMINISTYCZNIE na istniejące endpointy pending (#62), z pominięciem modelu.
// Stany jak karty propozycji w chacie: pending → zapisano / odrzucono / wygasło.
import { useState } from 'react';
import { C } from '@/lib/theme';

export interface OverloadCorrection {
  change_id: string;
  diff: string;
  mode: 'volume' | 'intensity';
  surplus: number;
}

type CardState =
  | { s: 'pending'; busy: boolean }
  | { s: 'committed'; message?: string }
  | { s: 'cancelled' }
  | { s: 'expired'; message: string };

export default function OverloadCorrectionCard({ correction }: { correction: OverloadCorrection }) {
  const [st, setSt] = useState<CardState>({ s: 'pending', busy: false });

  async function act(action: 'commit' | 'cancel') {
    if (st.s !== 'pending' || st.busy) return;
    setSt({ s: 'pending', busy: true });
    try {
      const res = await fetch(`/api/ai/pending/${correction.change_id}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (action === 'cancel') {
        setSt({ s: 'cancelled' });
        return;
      }
      if (data.ok) setSt({ s: 'committed', message: data.message });
      else setSt({ s: 'expired', message: data.error ?? 'Propozycja nieaktualna — otwórz jazdę ponownie.' });
    } catch {
      setSt({ s: 'pending', busy: false });
    }
  }

  const title = correction.mode === 'volume'
    ? `Przeciążenie: +${correction.surplus} TSS ponad plan — propozycja odciążenia tygodnia`
    : `Intensywność ponad plan (+${correction.surplus} TSS) — propozycja lżejszego jutra`;

  return (
    <div style={{ border: `1px solid ${C.yellow}55`, borderRadius: 10, overflow: 'hidden', background: C.card }}>
      <div style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: C.yellow, borderBottom: `1px solid ${C.border}` }}>
        ⚠ {title}
      </div>
      <pre style={{ margin: 0, padding: '10px 14px', fontSize: 12.5, lineHeight: 1.5, color: C.text, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
        {correction.diff}
      </pre>

      {st.s === 'pending' && (
        <div style={{ display: 'flex', gap: 8, padding: '4px 14px 12px' }}>
          <button
            onClick={() => void act('commit')}
            disabled={st.busy}
            style={{ flex: 1, minHeight: 44, border: 'none', borderRadius: 10, background: C.green, color: C.bg, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: st.busy ? 0.6 : 1 }}
          >
            {st.busy ? 'Zapisuję…' : 'Zatwierdź'}
          </button>
          <button
            onClick={() => void act('cancel')}
            disabled={st.busy}
            style={{ flex: 1, minHeight: 44, borderRadius: 10, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: st.busy ? 0.6 : 1 }}
          >
            Odrzuć
          </button>
        </div>
      )}
      {st.s === 'committed' && (
        <div style={{ padding: '4px 14px 12px', fontSize: 14, fontWeight: 600, color: C.green }}>
          ✓ Zapisano{st.message ? ` — ${st.message}` : ' — plan tygodnia zaktualizowany.'}
        </div>
      )}
      {st.s === 'cancelled' && (
        <div style={{ padding: '4px 14px 12px', fontSize: 14, color: C.muted }}>Odrzucono — plan bez zmian.</div>
      )}
      {st.s === 'expired' && (
        <div style={{ padding: '4px 14px 12px', fontSize: 14, color: C.yellow }}>{st.message}</div>
      )}
    </div>
  );
}
