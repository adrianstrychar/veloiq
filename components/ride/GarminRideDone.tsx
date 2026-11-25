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
  const facts = [d.durationSec ? hmmss(d.durationSec) : null, d.np ? `NP ${d.np} W` : d.avgPower ? `śr. ${d.avgPower} W` : null].filter(Boolean).join(' · ');
  const close = <button type="button" className={s.btnGhost} onClick={ride.clearMirrorDone}>Zamknij</button>;

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
          {onExportStrava && !done.stravaId && strava.st !== 'ok' && <button type="button" className={s.btnGhost} onClick={ride.clearMirrorDone} style={{ height: 40 }}>Zamknij</button>}
        </>
      )}
      {!done && close}
    </section>
  );
}
