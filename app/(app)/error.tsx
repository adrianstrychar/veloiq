'use client';

// Error boundary zakładek aplikacji (dashboard/plan/calendar/races/chat). Wcześniej goły crash
// Next — teraz komunikat po polsku + retry przez reset() (ponawia render segmentu bez pełnego reloadu).
import { C } from '@/lib/theme';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: '28px 20px', marginTop: 24, textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
    }}>
      <div style={{ fontSize: 28 }}>⚠️</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Coś poszło nie tak</div>
      <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, maxWidth: 320 }}>
        Nie udało się załadować tej sekcji. To zwykle chwilowy problem z połączeniem — spróbuj ponownie.
      </div>
      {error.digest && <div style={{ fontSize: 9, color: C.muted }}>kod: {error.digest}</div>}
      <button
        onClick={reset}
        style={{
          background: C.cyan, color: C.bg, border: 'none', borderRadius: 9,
          padding: '10px 22px', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 4,
        }}
      >
        Spróbuj ponownie
      </button>
    </div>
  );
}
