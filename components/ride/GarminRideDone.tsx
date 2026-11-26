'use client';
// Koniec jazdy prowadzonej przez licznik Garmin (tryb lustra): telefon nic nie nagrywał, więc tu nie ma
// „Zapisz” – licznik sam wysyła jazdę do VeloIQ przez telefon. Karta pokazuje, jak idzie wysyłka, a po niej
// pozwala wysłać jazdę na Stravę.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import s from './ride.module.css';
import { hmmss } from './parts';
import type { Ride } from './useRide';

type Upload = { state: 'waiting' } | { state: 'uploading'; got: number; total: number } | { state: 'done'; rideId: string; stravaId?: number };

const POLL_MS = 4000;
const POLL_FOR_MS = 20 * 60_000;

export function GarminRideDone({ ride, onExportStrava }: {
  ride: Ride;
  onExportStrava?: (rideId?: string) => Promise<{ url?: string; pending?: boolean; already?: boolean }>;
}) {
  const d = ride.mirrorDone;
  const [up, setUp] = useState<Upload | null>(null);
  const [strava, setStrava] = useState<{ st: 'idle' | 'sending' | 'ok' | 'err'; url?: string; msg?: string }>({ st: 'idle' });
  const skip = !d || d.saved === 0 || d.upload === 0;

  useEffect(() => {
    if (!d || skip) return;
    let stop = false;
    const until = Date.now() + POLL_FOR_MS;
    const poll = async () => {
      try {
        const r = await fetch(`/api/garmin/ride/status?key=${d.key}`, { cache: 'no-store' });
        if (r.ok) {
          const j = (await r.json()) as Upload;
          if (!stop) setUp(j);
          if (j.state === 'done') return;
        }
      } catch { /* bez sieci – kolejna próba */ }
      if (!stop && Date.now() < until) setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => { stop = true; };
  }, [d?.key, skip]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return null;
  // zamknięta karta = ta jazda potwierdzona; karta „ostatnia jazda z licznika” jej już nie powtórzy
  const closeCard = () => { try { localStorage.setItem(SEEN_KEY, String(d.key)); } catch { /* brak storage */ } ride.clearMirrorDone(); };
  const facts = [d.durationSec ? hmmss(d.durationSec) : null, d.np ? `NP ${d.np} W` : d.avgPower ? `śr. ${d.avgPower} W` : null].filter(Boolean).join(' · ');
  const close = <button type="button" className={s.btnGhost} onClick={closeCard}>Zamknij</button>;

  if (d.saved === 0) {
    return (
      <section className={s.card} style={{ marginBottom: 12 }} aria-label="Jazda z licznika">
        <span className={s.strong}>Jazda odrzucona na liczniku</span>
        <span className={s.small}>Licznik nic nie zapisał ani nie wysłał.</span>
        {close}
      </section>
    );
  }
  if (d.upload === 0) {
    return (
      <section className={s.card} style={{ marginBottom: 12 }} aria-label="Jazda z licznika">
        <span className={s.strong}>Jazda krótsza niż minuta</span>
        <span className={s.small}>Takich jazd licznik nie wysyła do VeloIQ (plik zostaje w Garmin Connect).</span>
        {close}
      </section>
    );
  }

  const done = up?.state === 'done' ? up : null;
  const exportStrava = async () => {
    if (!done || !onExportStrava || strava.st === 'sending') return;
    setStrava({ st: 'sending' });
    try {
      const r = await onExportStrava(done.rideId);
      setStrava({ st: 'ok', url: r.url, msg: r.already ? 'Ta jazda jest już na Stravie.' : r.pending ? 'Strava przetwarza plik – pojawi się za chwilę.' : 'Wysłane na Stravę.' });
    } catch (e) {
      setStrava({ st: 'err', msg: e instanceof Error ? e.message : 'Nie udało się wysłać na Stravę.' });
    }
  };

  return (
    <section className={done ? s.cardCyan : s.cardAmber} style={{ marginBottom: 12 }} aria-label="Jazda z licznika" aria-live="polite">
      <span className={s.strong}>{done ? 'Jazda z licznika jest w VeloIQ ✓' : 'Licznik wysyła jazdę do VeloIQ…'}</span>
      <span className={s.small}>{[d.name, facts].filter(Boolean).join(' · ')}</span>
      {!done && (
        <span className={s.small}>
          {up?.state === 'uploading' ? `Paczki: ${up.got} / ${up.total}. ` : ''}
          Zostaw na liczniku otwarte podsumowanie VeloIQ, aż pokaże „Jazda w VeloIQ” – wysyłka idzie przez ten telefon
          (Bluetooth), bez czekania na Garmin Connect i Stravę. Zwykle trwa to kilkanaście sekund.
        </span>
      )}
      {done && (
        <>
          <span className={s.small}>Analiza, plan, forma i FTP są już przeliczone.{done.stravaId ? ' Jazda jest też na Stravie.' : ''}</span>
          <div className={s.grid2}>
            <Link href="/dashboard" className={s.btnGhost} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Zobacz jazdę</Link>
            {onExportStrava && !done.stravaId && strava.st !== 'ok'
              ? <button type="button" className={s.btnGhost} onClick={exportStrava} disabled={strava.st === 'sending'}>{strava.st === 'sending' ? 'Wysyłam…' : 'Wyślij na Stravę'}</button>
              : close}
          </div>
          {strava.msg && (
            <span className={s.small} style={strava.st === 'err' ? { color: 'var(--danger)' } : undefined}>
              {strava.msg}{strava.url && <> <a href={strava.url} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>Otwórz</a></>}
            </span>
          )}
          {onExportStrava && !done.stravaId && strava.st !== 'ok' && <button type="button" className={s.btnGhost} onClick={closeCard} style={{ height: 40 }}>Zamknij</button>}
        </>
      )}
      {!done && close}
    </section>
  );
}

type Latest = { state: 'none' } | { state: 'uploading'; key: number; got: number; total: number } | { state: 'done'; key: number; rideId: string; stravaId?: number };
const SEEN_KEY = 'veloiq.garmin.lastSeenUpload';
const SHOW_DONE_FOR_S = 3 * 3600;

/** Ostatnia jazda z licznika według serwera – potwierdzenie „jest w VeloIQ ✓” niezależnie od mostu Bluetooth
 *  (gdy koniec jazdy nie dotarł do telefonu, karta trybu lustra by się nie pokazała). `bump` – sygnał z licznika
 *  („wysłane”) albo powrót aplikacji: odśwież teraz. */
export function GarminLastUpload({ bump }: { bump: number }) {
  const [up, setUp] = useState<Latest | null>(null);
  const [hidden, setHidden] = useState<number | null>(null);
  useEffect(() => {
    try { setHidden(Number(localStorage.getItem(SEEN_KEY)) || 0); } catch { setHidden(0); }
  }, []);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const until = Date.now() + 3 * 60_000;
    const poll = async () => {
      try {
        const r = await fetch('/api/garmin/ride/status?latest=1', { cache: 'no-store' });
        if (r.ok) {
          const j = (await r.json()) as Latest;
          if (stop) return;
          setUp(j);
          if (j.state !== 'uploading') return;      // gotowe albo nic – bez dalszego odpytywania
        }
      } catch { /* bez sieci – kolejna próba */ }
      if (!stop && Date.now() < until) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    const onVisible = () => { if (document.visibilityState === 'visible') void poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stop = true; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [bump]);

  if (!up || up.state === 'none' || hidden == null || up.key <= hidden) return null;
  const at = new Date(up.key * 1000).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  if (up.state === 'done' && Date.now() / 1000 - up.key > SHOW_DONE_FOR_S) return null;
  const dismiss = () => { try { localStorage.setItem(SEEN_KEY, String(up.key)); } catch { /* brak storage */ } setHidden(up.key); };
  if (up.state === 'uploading') {
    return (
      <section className={s.cardAmber} style={{ marginBottom: 12 }} aria-live="polite" aria-label="Wysyłka jazdy z licznika">
        <span className={s.strong}>Licznik wysyła jazdę z {at}…</span>
        <span className={s.small}>Paczki: {up.got} / {up.total}. Zostaw na liczniku otwartą aplikację VeloIQ, aż pokaże „Jazda w VeloIQ”.</span>
      </section>
    );
  }
  return (
    <section className={s.cardCyan} style={{ marginBottom: 12 }} aria-live="polite" aria-label="Jazda z licznika w VeloIQ">
      <span className={s.strong}>Jazda z licznika ({at}) jest w VeloIQ ✓</span>
      <span className={s.small}>Analiza, plan, forma i FTP są już przeliczone.{up.stravaId ? ' Jazda jest też na Stravie.' : ''}</span>
      <div className={s.grid2}>
        <Link href="/dashboard" className={s.btnGhost} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Zobacz jazdę</Link>
        <button type="button" className={s.btnGhost} onClick={dismiss}>Zamknij</button>
      </div>
    </section>
  );
}
