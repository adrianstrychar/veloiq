'use client';
// Przycisk Flic na kierownicy (ekran Czujniki): parowanie, stan, bateria i test – wciśnięcie podświetla akcję.
import { useEffect, useState } from 'react';
import s from './ride.module.css';
import type { Ride } from './useRide';
import { StatusDot } from './parts';
import type { FlicPress } from '@/lib/ride/ride-engine';

const ACTIONS: Array<{ press: FlicPress; gesture: string; what: string }> = [
  { press: 'click', gesture: 'Klik', what: 'Zapytaj Enzo' },
  { press: 'double', gesture: '2× klik', what: 'Okrążenie · w planie następny krok' },
  { press: 'hold', gesture: 'Przytrzymaj', what: 'Raport Enzo: średnia moc i tętno' },
];

const PHASE: Record<string, string> = {
  searching: 'Szukam… przytrzymaj Flic ok. 7 s, aż zacznie migać.',
  discovered: 'Widzę przycisk – łączę…',
  connecting: 'Łączę…',
  verified: 'Prawie gotowe…',
  failed: 'Weryfikacja nie powiodła się – spróbuj jeszcze raz.',
};

function IconButtonGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="3.5" fill="currentColor" />
    </svg>
  );
}

export function FlicCard({ ride }: { ride: Ride }) {
  const f = ride.flic;
  const [now, setNow] = useState(Date.now());
  // podświetlenie ostatniego wciśnięcia przez 2,5 s
  useEffect(() => {
    if (!ride.flicPress) return;
    setNow(Date.now());
    const t = setTimeout(() => setNow(Date.now()), 2600);
    return () => clearTimeout(t);
  }, [ride.flicPress]);
  const lit = ride.flicPress && now - ride.flicPress.at < 2500 ? ride.flicPress.press : null;

  if (!ride.native) return null;

  const sub = !f.available
    ? 'Zaktualizuj aplikację VeloIQ na iPhonie, żeby połączyć przycisk.'
    : f.scanning ? (PHASE[f.scanPhase ?? 'searching'] ?? 'Szukam…')
      : f.paired ? [f.name ?? 'Flic', f.connected ? 'połączony' : 'łączę…', f.battery != null ? `bateria ${f.battery}%` : null].filter(Boolean).join(' · ')
        : 'Flic 2 – sterowanie jazdą bez dotykania telefonu. Muzyka gra dalej.';

  return (
    <section className={s.card}>
      <div className={s.row}>
        <div className={s.row} style={{ justifyContent: 'flex-start', gap: 12 }}>
          <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12, backgroundColor: '#1B2B3C', color: 'var(--cyan)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><IconButtonGlyph /></span>
          <div className={s.stack} style={{ gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>Przycisk na kierownicy</span>
            <span className={s.small} style={{ fontSize: 12 }}>{sub}</span>
          </div>
        </div>
        {f.paired && <StatusDot ok={!!f.connected}>{f.connected ? 'Gotowy' : 'Łączę…'}</StatusDot>}
      </div>

      {f.available && (
        <div className={s.stack} style={{ gap: 6, backgroundColor: '#14171C', borderRadius: 12, padding: '10px 12px' }}>
          {ACTIONS.map((a) => (
            <div key={a.press} className={s.row} style={{ gap: 10, transition: 'color .2s', color: lit === a.press ? 'var(--ok)' : undefined }}>
              <span style={{ fontSize: 13, fontWeight: 700, minWidth: 92 }}>{a.gesture}</span>
              <span className={s.small} style={{ fontSize: 13, flex: 1, color: lit === a.press ? 'var(--ok)' : undefined }}>
                {a.what}{lit === a.press ? ' ✓' : ''}
              </span>
            </div>
          ))}
          {f.paired && <span className={s.small} style={{ fontSize: 12 }}>Wciśnij przycisk, żeby sprawdzić – akcja podświetli się tutaj. W trakcie jazdy działa także przy zgaszonym ekranie.</span>}
        </div>
      )}

      {f.error && !f.scanning && <span className={s.small} style={{ fontSize: 13, color: 'var(--warn, #C99A4E)' }}>{f.error}</span>}

      {f.available && (f.scanning
        ? <button type="button" className={s.btnGhost} style={{ height: 44 }} onClick={ride.flicStopScan}>Anuluj</button>
        : f.paired
          ? <button type="button" className={s.btnGhost} style={{ height: 44 }} onClick={() => { if (window.confirm('Usunąć przycisk Flic z VeloIQ?')) ride.flicForget(); }}>Usuń przycisk</button>
          : (
            <>
              <button type="button" className={s.btnGhost} style={{ height: 44 }} onClick={ride.flicScan}>Połącz przycisk Flic</button>
              <span className={s.small} style={{ fontSize: 12 }}>Po kliknięciu przytrzymaj Flic ok. 7 sekund, aż zacznie migać. Jeśli jest w aplikacji Flic, może tam zostać.</span>
            </>
          ))}
    </section>
  );
}
