'use client';
// Licznik Garmin Edge (ekran Czujniki): parowanie aplikacji VeloIQ na liczniku z kontem – kod z ekranu licznika –
// oraz lista połączonych liczników. Po sparowaniu licznik sam pobiera plan i wysyła jazdy.
// Druga część (tylko aplikacja na iPhonie): most do telefonu – czujniki sparowane z licznikiem, głos Enzo w słuchawkach.
import { useCallback, useEffect, useState } from 'react';
import s from './ride.module.css';
import { StatusDot } from './parts';
import type { Ride } from './useRide';

interface Device { id: string; name: string; app?: string | null; createdAt: string; lastSeenAt?: string | null }

function IconEdge() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="6" y="2.5" width="12" height="19" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M9.5 8h5M9.5 11.5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1.4" fill="currentColor" />
    </svg>
  );
}

const seen = (iso?: string | null) => {
  if (!iso) return 'jeszcze nie łączył się z VeloIQ';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 15) return 'aktywny przed chwilą';
  if (min < 120) return `aktywny ${min} min temu`;
  if (min < 48 * 60) return `aktywny ${Math.round(min / 60)} godz. temu`;
  return `aktywny ${Math.round(min / 1440)} dni temu`;
};

/** Most licznik → telefon: stan w jednym zdaniu + co zrobić dalej. */
function linkLine(g: Ride['garminLink']): { ok: boolean; text: string } {
  if (!g.paired) return { ok: false, text: 'Czujniki zostają przy liczniku, a telefon dostaje z niego moc i tętno i mówi głosem Enzo.' };
  if (!g.connected) return { ok: false, text: `${g.name ?? 'Licznik'} poza zasięgiem – włącz go i sprawdź, czy jest połączony z Garmin Connect.` };
  if (g.appInstalled === false) return { ok: false, text: 'Na liczniku nie widzę aplikacji VeloIQ. Jeśli jest wgrana kablem, otwórz ją na liczniku – dane mogą popłynąć mimo to.' };
  if (!g.streaming) return { ok: false, text: 'Połączony. Otwórz aplikację VeloIQ na liczniku i włącz w niej MENU → Ustawienia → „Most do telefonu”.' };
  const vals = [g.power != null ? `${g.power} W` : null, g.hr != null ? `${g.hr} bpm` : null, g.cadence != null ? `${g.cadence} rpm` : null].filter(Boolean).join(' · ');
  return { ok: true, text: `${g.recording ? 'Licznik nagrywa jazdę' : 'Licznik nadaje'}${vals ? `: ${vals}` : ' – czekam na czujniki'}.` };
}

export function GarminCard({ ride }: { ride: Ride }) {
  const link = ride.garminLink;
  const [devices, setDevices] = useState<Device[]>([]);
  const [ready, setReady] = useState(true);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/garmin/devices', { cache: 'no-store' });
      if (!r.ok) return;
      const j = (await r.json()) as { devices?: Device[]; ready?: boolean };
      setDevices(j.devices ?? []);
      setReady(j.ready !== false);
    } catch { /* offline – karta zostaje w ostatnim stanie */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const pair = async () => {
    if (code.length !== 6 || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/garmin/pair/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; name?: string; message?: string };
      if (r.ok && j.ok) {
        setMsg({ ok: true, text: `${j.name ?? 'Licznik'} połączony. Za chwilę pobierze plan – na liczniku pojawi się „Sparowano!”.` });
        setCode(''); setOpen(false);
        void load();
      } else {
        setMsg({ ok: false, text: j.message ?? 'Nie udało się połączyć licznika. Spróbuj ponownie.' });
      }
    } catch {
      setMsg({ ok: false, text: 'Brak połączenia z serwerem.' });
    } finally { setBusy(false); }
  };

  const unpair = async (d: Device) => {
    if (!window.confirm(`Odłączyć ${d.name} od VeloIQ? Licznik przestanie pobierać plan i wysyłać jazdy.`)) return;
    await fetch(`/api/garmin/devices?id=${encodeURIComponent(d.id)}`, { method: 'DELETE' }).catch(() => undefined);
    void load();
  };

  const sub = devices.length
    ? 'Plan dnia trafia na licznik, jazdy wracają do VeloIQ – same, bez Stravy.'
    : 'Aplikacja VeloIQ na Edge: trening z planu, własne pola danych, Enzo i automatyczna wysyłka jazd.';

  return (
    <section className={s.card}>
      <div className={s.row}>
        <div className={s.row} style={{ justifyContent: 'flex-start', gap: 12 }}>
          <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12, backgroundColor: '#12303A', color: 'var(--cyan)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><IconEdge /></span>
          <div className={s.stack} style={{ gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>Licznik Garmin Edge</span>
            <span className={s.small} style={{ fontSize: 12 }}>{sub}</span>
          </div>
        </div>
        {devices.length > 0 && <StatusDot ok>Połączony</StatusDot>}
      </div>

      {devices.map((d) => (
        <div key={d.id} className={s.row} style={{ gap: 10, backgroundColor: '#14171C', borderRadius: 12, padding: '10px 12px' }}>
          <div className={s.stack} style={{ gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{d.name}</span>
            <span className={s.small} style={{ fontSize: 12 }}>{seen(d.lastSeenAt)}{d.app ? ` · aplikacja ${d.app}` : ''}</span>
          </div>
          <button type="button" className={s.btnText} style={{ height: 36, fontSize: 13, padding: '0 8px' }} onClick={() => void unpair(d)}>Odłącz</button>
        </div>
      ))}

      {link.available && (
        <div className={s.stack} style={{ gap: 10, backgroundColor: '#14171C', borderRadius: 12, padding: '12px' }}>
          <div className={s.row} style={{ gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Czujniki i głos Enzo przez licznik</span>
            {link.paired && <StatusDot ok={!!link.streaming}>{link.streaming ? 'Nadaje' : link.connected ? 'Czeka' : 'Brak'}</StatusDot>}
          </div>
          <span className={s.small} style={{ fontSize: 13, color: linkLine(link).ok ? 'var(--ok)' : undefined }}>{linkLine(link).text}</span>
          {link.paired ? (
            <div className={s.row} style={{ gap: 10 }}>
              {link.connected && !link.streaming && (
                <button type="button" className={s.btnGhost} style={{ height: 40, flex: 1, fontSize: 13 }} onClick={() => void ride.garminOpenApp()}>Otwórz VeloIQ na liczniku</button>
              )}
              <button type="button" className={s.btnText} style={{ height: 40, fontSize: 13, padding: '0 8px' }} onClick={() => void ride.garminForget()}>Zapomnij licznik</button>
            </div>
          ) : (
            <>
              <button type="button" className={s.btnGhost} style={{ height: 44 }} onClick={() => void ride.garminChoose()}>Wybierz licznik w Garmin Connect</button>
              <span className={s.small} style={{ fontSize: 12 }}>Otworzy się aplikacja Garmin Connect – zaznacz swój Edge i wróć do VeloIQ.</span>
            </>
          )}
        </div>
      )}

      {!ready && <span className={s.small} style={{ fontSize: 13, color: 'var(--warn, #C99A4E)' }}>Parowanie liczników nie jest jeszcze włączone na serwerze (migracja 026).</span>}
      {msg && <span className={s.small} style={{ fontSize: 13, color: msg.ok ? 'var(--ok)' : 'var(--warn, #C99A4E)' }}>{msg.text}</span>}

      {open ? (
        <div className={s.stack} style={{ gap: 10 }}>
          <span className={s.small} style={{ fontSize: 13 }}>
            Na liczniku otwórz aplikację VeloIQ → MENU → „Sparuj z VeloIQ”. Wpisz tutaj 6 cyfr z ekranu licznika (kod jest ważny 10 minut).
          </span>
          <input
            inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={7} placeholder="000 000" aria-label="Kod z licznika"
            value={code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => { if (e.key === 'Enter') void pair(); }}
            style={{ height: 56, borderRadius: 12, border: '1px solid var(--line-2)', backgroundColor: '#14171C', color: 'var(--text)', fontSize: 28, fontWeight: 700, letterSpacing: 4, textAlign: 'center', outline: 'none' }}
          />
          <div className={s.row} style={{ gap: 10 }}>
            <button type="button" className={s.btnGhost} style={{ height: 48, flex: 1 }} onClick={() => { setOpen(false); setCode(''); setMsg(null); }}>Anuluj</button>
            <button type="button" className={s.btnPrimary} style={{ height: 48, flex: 1, fontSize: 16, opacity: code.length === 6 && !busy ? 1 : 0.5 }} disabled={code.length !== 6 || busy} onClick={() => void pair()}>
              {busy ? 'Łączę…' : 'Połącz'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={s.btnGhost} style={{ height: 44 }} onClick={() => { setOpen(true); setMsg(null); }}>
          {devices.length ? 'Połącz kolejny licznik' : 'Połącz licznik Garmin'}
        </button>
      )}
    </section>
  );
}
