'use client';
// Licznik Garmin Edge na ekranie „Jedź”: JEDEN stan i JEDEN następny krok zamiast kilku kart i dwóch parowań.
//   1. telefon wybiera licznik w Garmin Connect (most Connect IQ – dane na żywo, głos Enzo),
//   2. aplikacja VeloIQ na liczniku łączy się z kontem sama (kod idzie mostem, ta aplikacja go potwierdza),
//   3. „Gotowe – wciśnij START na liczniku”.
// Ręczne wpisanie kodu, lista liczników na koncie i diagnostyka mostu są schowane w „Ustawieniach licznika”.
import { useCallback, useEffect, useState } from 'react';
import s from './ride.module.css';
import { StatusDot } from './parts';
import type { Ride } from './useRide';
import { garminStep, type GarminStep } from '@/lib/ride/garmin-step';

export interface GarminDevice { id: string; name: string; app?: string | null; createdAt: string; lastSeenAt?: string | null }

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

const TIP_KEY = 'veloiq.garmin.tip.notifications';

export function GarminPanel({ ride, devices: initial, compact }: { ride: Ride; devices?: GarminDevice[]; compact?: boolean }) {
  const link = ride.garminLink;
  const [devices, setDevices] = useState<GarminDevice[]>(initial ?? []);
  const [ready, setReady] = useState(true);
  const [more, setMore] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [diag, setDiag] = useState(false);
  const [tip, setTip] = useState(false);
  const [expanded, setExpanded] = useState(!compact);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/garmin/devices', { cache: 'no-store' });
      if (!r.ok) return;
      const j = (await r.json()) as { devices?: GarminDevice[]; ready?: boolean };
      setDevices(j.devices ?? []);
      setReady(j.ready !== false);
    } catch { /* offline – zostaje ostatni stan */ }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // licznik właśnie połączył się z kontem – lista liczników na koncie się zmieniła
  useEffect(() => { if (ride.garminAccount?.state === 'ok') void load(); }, [ride.garminAccount?.state, ride.garminAccount?.at, load]);
  useEffect(() => { try { setTip(localStorage.getItem(TIP_KEY) !== '1'); } catch { setTip(false); } }, []);

  const step = garminStep({ native: ride.native, link, devices: devices.length, account: ride.garminAccount });

  const pair = async () => {
    if (code.length !== 6 || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/garmin/pair/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; name?: string; message?: string };
      if (r.ok && j.ok) {
        setMsg({ ok: true, text: `${j.name ?? 'Licznik'} połączony z kontem. Za chwilę pobierze plan.` });
        setCode(''); setCodeOpen(false);
        void load();
      } else setMsg({ ok: false, text: j.message ?? 'Nie udało się połączyć licznika. Spróbuj ponownie.' });
    } catch { setMsg({ ok: false, text: 'Brak połączenia z serwerem.' }); } finally { setBusy(false); }
  };

  const unpair = async (d: GarminDevice) => {
    if (!window.confirm(`Odłączyć ${d.name} od konta VeloIQ? Licznik przestanie pobierać plan i wysyłać jazdy.`)) return;
    await fetch(`/api/garmin/devices?id=${encodeURIComponent(d.id)}`, { method: 'DELETE' }).catch(() => undefined);
    void load();
  };

  const act = (run: NonNullable<GarminStep['action']>['run']) => {
    if (run === 'choose') void ride.garminChoose();
    else if (run === 'openApp') void ride.garminOpenApp();
    else if (run === 'pair') void ride.garminPairNow();
    else { setCodeOpen(true); setMore(true); setMsg(null); }
  };

  // ekran „Jedź” bez licznika: jedna linijka zaproszenia, rozwijana do pierwszego kroku
  if (compact && !expanded) {
    return (
      <button type="button" className={s.card} onClick={() => setExpanded(true)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, cursor: 'pointer', color: 'var(--text)', font: 'inherit', textAlign: 'left' }}>
        <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 10, backgroundColor: '#12303A', color: 'var(--cyan)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><IconEdge /></span>
        <span className={s.stack} style={{ gap: 2, flex: 1 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Jeździsz z Garmin Edge?</span>
          <span className={s.small} style={{ fontSize: 12 }}>Trening z planu na liczniku, Enzo w słuchawkach, jazdy same w VeloIQ.</span>
        </span>
        <span className={s.small}>Połącz ›</span>
      </button>
    );
  }

  const cardCls = step.tone === 'ok' ? s.cardCyan : step.tone === 'wait' ? s.cardAmber : s.card;
  const vals = [link.power != null ? `${link.power} W` : null, link.hr != null ? `${link.hr} bpm` : null, link.cadence != null ? `${link.cadence} rpm` : null].filter(Boolean);
  const showTip = tip && (step.key === 'ready' || step.key === 'riding');

  return (
    <section className={cardCls} aria-label="Licznik Garmin Edge" aria-live="polite">
      <div className={s.row} style={{ alignItems: 'flex-start', gap: 12 }}>
        <div className={s.row} style={{ justifyContent: 'flex-start', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12, backgroundColor: '#12303A', color: 'var(--cyan)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><IconEdge /></span>
          <div className={s.stack} style={{ gap: 4, minWidth: 0 }}>
            <span className={s.eyebrowCyan}>Licznik Garmin Edge{link.edgeVersion ? ` · VeloIQ ${link.edgeVersion}` : ''}</span>
            <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.25 }}>{step.title}</span>
          </div>
        </div>
      </div>
      <span className={s.small} style={{ fontSize: 14, lineHeight: 1.45 }}>{step.text}</span>

      {(step.key === 'ready' || step.key === 'riding') && vals.length > 0 && (
        <div className={s.row} style={{ justifyContent: 'flex-start', gap: 14, fontVariantNumeric: 'tabular-nums' }}>
          <StatusDot ok>Na żywo</StatusDot>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{vals.join(' · ')}</span>
        </div>
      )}
      {ride.garminAccount?.state === 'ok' && Date.now() - ride.garminAccount.at < 120_000 && (
        <span className={s.small} style={{ fontSize: 13, color: 'var(--ok)' }}>✓ {ride.garminAccount.text}</span>
      )}

      {step.action && (
        <button type="button" className={step.tone === 'todo' ? s.btnPrimary : s.btnGhost} style={{ height: 48, fontSize: 16 }} onClick={() => act(step.action!.run)}>
          {step.action.label}
        </button>
      )}
      {step.key === 'choose' || step.key === 'setup'
        ? <span className={s.small} style={{ fontSize: 12 }}>Otworzy się Garmin Connect – zaznacz swój Edge i wróć do VeloIQ.</span>
        : null}

      {showTip && (
        <div className={s.row} style={{ gap: 10, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 12, padding: '10px 12px', alignItems: 'flex-start' }}>
          <span className={s.small} style={{ fontSize: 12, lineHeight: 1.45 }}>
            Wskazówka: wyłącz na liczniku powiadomienia z telefonu (ustawienia licznika → Telefon). Na Edge zasłaniają ekran VeloIQ, dopóki ich nie zamkniesz.
          </span>
          <button type="button" className={s.btnText} style={{ height: 28, fontSize: 12, padding: '0 4px', flexShrink: 0 }}
            onClick={() => { try { localStorage.setItem(TIP_KEY, '1'); } catch { /* brak storage */ } setTip(false); }}>OK</button>
        </div>
      )}

      {msg && <span className={s.small} style={{ fontSize: 13, color: msg.ok ? 'var(--ok)' : 'var(--warn, #C99A4E)' }}>{msg.text}</span>}
      {!ready && <span className={s.small} style={{ fontSize: 13, color: 'var(--warn, #C99A4E)' }}>Łączenie liczników nie jest jeszcze włączone na serwerze (migracja 026).</span>}

      <button type="button" className={s.btnText} style={{ height: 32, fontSize: 13, padding: 0, alignSelf: 'flex-start' }} onClick={() => setMore((x) => !x)} aria-expanded={more}>
        {more ? 'Ukryj ustawienia licznika' : 'Ustawienia licznika ›'}
      </button>

      {more && (
        <div className={s.stack} style={{ gap: 10, backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 12, padding: 12 }}>
          {devices.length > 0 && <span className={s.metricLabel}>Na koncie</span>}
          {devices.map((d) => (
            <div key={d.id} className={s.row} style={{ gap: 10 }}>
              <div className={s.stack} style={{ gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{d.name}</span>
                <span className={s.small} style={{ fontSize: 12 }}>{seen(d.lastSeenAt)}{d.app ? ` · VeloIQ ${d.app}` : ''}</span>
              </div>
              <button type="button" className={s.btnText} style={{ height: 32, fontSize: 13, padding: '0 6px' }} onClick={() => void unpair(d)}>Odłącz</button>
            </div>
          ))}

          {codeOpen ? (
            <div className={s.stack} style={{ gap: 8 }}>
              <span className={s.small} style={{ fontSize: 13 }}>Na liczniku: VeloIQ → MENU → „Połącz z kontem VeloIQ”. Wpisz 6 cyfr z ekranu (kod ważny 10 minut).</span>
              <input
                inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={7} placeholder="000 000" aria-label="Kod z licznika"
                value={code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => { if (e.key === 'Enter') void pair(); }}
                style={{ height: 52, borderRadius: 12, border: '1px solid var(--line-2)', backgroundColor: '#14171C', color: 'var(--text)', fontSize: 26, fontWeight: 700, letterSpacing: 4, textAlign: 'center', outline: 'none' }}
              />
              <div className={s.row} style={{ gap: 10 }}>
                <button type="button" className={s.btnGhost} style={{ height: 44, flex: 1 }} onClick={() => { setCodeOpen(false); setCode(''); setMsg(null); }}>Anuluj</button>
                <button type="button" className={s.btnPrimary} style={{ height: 44, flex: 1, fontSize: 15, opacity: code.length === 6 && !busy ? 1 : 0.5 }} disabled={code.length !== 6 || busy} onClick={() => void pair()}>
                  {busy ? 'Łączę…' : 'Połącz'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={s.btnGhost} style={{ height: 40, fontSize: 14 }} onClick={() => { setCodeOpen(true); setMsg(null); }}>Wpisz kod z licznika</button>
          )}

          {ride.native && link.available && link.paired && (
            <div className={s.row} style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
              <button type="button" className={s.btnText} style={{ height: 32, fontSize: 13, padding: '0 6px' }} onClick={() => void ride.garminChoose()}>Wybierz inny licznik</button>
              <button type="button" className={s.btnText} style={{ height: 32, fontSize: 13, padding: '0 6px' }} onClick={() => setDiag((x) => !x)}>{diag ? 'Ukryj diagnostykę' : 'Diagnostyka'}</button>
              <button type="button" className={s.btnText} style={{ height: 32, fontSize: 13, padding: '0 6px' }} onClick={() => void ride.garminForget()}>Zapomnij w telefonie</button>
            </div>
          )}
          {diag && link.paired && (
            <div className={s.stack} style={{ gap: 4 }} aria-label="Diagnostyka mostu">
              <span className={s.small} style={{ fontSize: 12 }}>
                Licznik: {link.connected ? 'połączony' : 'niepołączony'}{link.connected && link.greeted != null ? ` · powitanie: ${link.greeted ? 'OK' : 'ponawiam'}` : ''} · aplikacja: {link.appInstalled == null ? '?' : link.appInstalled ? 'jest' : 'brak'}
                {link.edgeVersion ? ` · VeloIQ ${link.edgeVersion}` : ''}
                {link.edgeAccount != null ? ` · konto: ${link.edgeAccount ? (link.edgeAthlete || 'tak') : 'brak'}` : ''}
                {link.lastMessageAgo != null ? ` · ostatnia wiadomość ${link.lastMessageAgo} s temu` : ' · nic jeszcze nie przyszło'}
              </span>
              <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.4, color: 'var(--muted)', whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto' }}>
                {(link.log ?? []).slice().reverse().join('\n') || '(pusto)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
