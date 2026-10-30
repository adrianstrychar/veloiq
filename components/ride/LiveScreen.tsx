'use client';
import { useEffect, useRef, useState } from 'react';
import s from './ride.module.css';
import type { WorkoutScript } from '@/lib/ride/workout-script';
import type { LiveSample } from '@/lib/ride/ride-engine';
import type { Ride } from './useRide';
import { NavCard } from './RouteCard';
import { Cue, IconNext, IconPause, IconPlay, IconStop, Metric, PowerGauge, ProgressStrip, StatusDot, hmmss, mmss } from './parts';

const intervalNo = (plan: WorkoutScript | null, idx: number) =>
  plan ? plan.steps.slice(0, idx + 1).filter((x) => x.type === 'interval').length : 0;
const intervalTotal = (plan: WorkoutScript | null) => (plan ? plan.steps.filter((x) => x.type === 'interval').length : 0);

/** Dystans i prędkość z GPS (tylko na zewnątrz). */
function useDistance(live: LiveSample | null) {
  const prev = useRef<{ lat: number; lon: number; t: number } | null>(null);
  const [km, setKm] = useState(0);
  const [kmh, setKmh] = useState(0);
  useEffect(() => {
    if (!live?.lat || !live?.lon) return;
    const p = prev.current;
    if (p && live.elapsed > p.t) {
      const R = 6371, toR = Math.PI / 180;
      const dLat = (live.lat - p.lat) * toR, dLon = (live.lon - p.lon) * toR;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(p.lat * toR) * Math.cos(live.lat * toR) * Math.sin(dLon / 2) ** 2;
      const d = 2 * R * Math.asin(Math.sqrt(a));
      if (d < 0.05) { // odrzuć skoki GPS > 50 m/s
        setKm((k) => k + d);
        setKmh((v) => v * 0.7 + (d / ((live.elapsed - p.t) / 3600)) * 0.3);
      }
    }
    prev.current = { lat: live.lat, lon: live.lon, t: live.elapsed };
  }, [live?.lat, live?.lon, live?.elapsed]);
  return { km, kmh };
}

/** Średnia moc i praca od startu (sekundy liczone raz, postój = 0 W jak w Garminie). */
function useTotals(live: LiveSample | null) {
  const acc = useRef({ last: -1, sum: 0, n: 0 });
  const [t, setT] = useState({ avg: 0, kj: 0 });
  useEffect(() => {
    if (!live || live.elapsed <= acc.current.last) return;
    const a = acc.current;
    const gap = a.last < 0 ? 1 : live.elapsed - a.last;
    const p = live.power ?? 0;
    a.sum += p * gap; a.n += gap; a.last = live.elapsed;
    setT({ avg: Math.round(a.sum / Math.max(1, a.n)), kj: Math.round(a.sum / 1000) });
  }, [live?.elapsed, live?.power]); // eslint-disable-line react-hooks/exhaustive-deps
  return t;
}

const STEP_NAMES: Record<string, string> = { warmup: 'Rozgrzewka', interval: 'Interwał', recovery: 'Przerwa', steady: 'Tempo', cooldown: 'Schłodzenie' };

export function LiveScreen({ ride, plan }: { ride: Ride; plan: WorkoutScript | null }) {
  const live = ride.live;
  const [confirmStop, setConfirmStop] = useState(false);
  const { km, kmh } = useDistance(live);
  const totals = useTotals(live);
  useEffect(() => { if (!confirmStop) return; const t = setTimeout(() => setConfirmStop(false), 3000); return () => clearTimeout(t); }, [confirmStop]);

  const phase = ride.paused ? 'paused' : ride.autoPaused ? 'ridePaused' : live?.phase ?? 'running';
  const type = live?.stepType ?? plan?.steps[0]?.type ?? 'warmup';
  const idx = live?.stepIndex ?? 0;
  const next = plan?.steps[idx + 1];
  const total = intervalTotal(plan);
  // dymek komunikatu tylko przez chwilę po wypowiedzeniu – nie wisi nieaktualny („Za słabo” przy mocy w zakresie)
  const lastCue = ride.cues[0] && (live?.elapsed ?? 0) - ride.cues[0].at <= 12 ? ride.cues[0].text : undefined;
  const p3 = live?.power3s ?? 0;
  const low = live?.targetLow ?? 0, high = live?.targetHigh ?? 0;

  // --- chip
  let chipCls = s.chipRest, chip = live?.stepName ?? 'Start';
  if (phase === 'paused') { chipCls = s.chipPaused; chip = 'Pauza'; }
  else if (phase === 'ridePaused') { chipCls = s.chipPaused; chip = 'Auto-pauza · ruszysz – liczę dalej'; }
  else if (phase === 'free') { chipCls = s.chipFree; chip = 'Jazda swobodna'; }
  else if (phase === 'autoPaused') { chipCls = s.chipPaused; chip = `Auto-pauza · Interwał ${intervalNo(plan, idx)} / ${total}`; }
  else if (phase === 'armed' || phase === 'waiting') { chipCls = s.chipArmed; chip = `Za chwilę · ${intervalNo(plan, idx + 1)} / ${total}`; }
  else if (type === 'interval') { chipCls = s.chipInterval; chip = `Interwał ${intervalNo(plan, idx)} / ${total}`; }
  else if (type === 'recovery') chip = 'Przerwa';

  // --- kolor mocy
  const work = type === 'interval' || type === 'steady';
  let pColor = 'var(--text)', pState = '';
  if (phase !== 'free' && phase !== 'autoPaused' && phase !== 'ridePaused' && high > 0) {
    if (p3 > high) { pColor = 'var(--over)'; pState = 'za mocno'; }
    else if (work && p3 < low) { pColor = 'var(--under)'; pState = 'za słabo'; }
    else if (work) { pColor = 'var(--cyan)'; pState = 'w zakresie'; }
    else pState = 'ok';
  }

  const stepDur = plan?.steps[idx]?.durationSec ?? 1;
  const planLeft = plan ? (live?.stepRemaining ?? stepDur) + plan.steps.slice(idx + 1).reduce((a, x) => a + x.durationSec, 0) : 0;
  const progress = Math.min(100, Math.round(((live?.stepElapsed ?? 0) / stepDur) * 100));

  const stop = () => { if (confirmStop) { setConfirmStop(false); ride.stop(); } else setConfirmStop(true); };
  const stopBtn = (
    <button type="button" className={s.btnDanger} onClick={stop} aria-label={confirmStop ? 'Potwierdź zakończenie' : 'Zakończ'}>
      <IconStop />{confirmStop ? 'Na pewno?' : phase === 'free' ? 'Zakończ jazdę' : 'Stop'}
    </button>
  );
  const pauseBtn = ride.paused
    ? <button type="button" className={s.btnAmber} onClick={ride.resume}><IconPlay size={16} />Wznów</button>
    : <button type="button" className={s.btnDark} onClick={ride.pause}><IconPause />Pauza</button>;

  return (
    <div className={s.screen}>
      <header className={s.topbar}>
        <span className={chipCls}>{chip}</span>
        <div className={s.row} style={{ gap: 12 }}>
          <StatusDot ok={live?.power !== undefined}>Moc</StatusDot>
          <StatusDot ok={live?.hr !== undefined}>HR</StatusDot>
          <span className={s.clock}>{hmmss(live?.elapsed ?? 0)}</span>
        </div>
      </header>

      {/* --- przerwa: czekam na start */}
      {(phase === 'armed' || phase === 'waiting') && next ? (
        <section className={s.cardCyan}>
          <span className={s.eyebrowCyan}>{phase === 'waiting' ? 'Czekam na start' : 'Za chwilę'} · Interwał {intervalNo(plan, idx + 1)} / {total}</span>
          <div className={s.rowEnd}>
            <span className={s.bigTimer}>{phase === 'waiting' ? `+${mmss(live?.overrunSec ?? 0)}` : mmss(live?.stepRemaining ?? 0)}</span>
            <span className={s.stack} style={{ alignItems: 'flex-end', paddingBottom: 6 }}>
              <span className={s.statValue} style={{ fontSize: 24 }}>{mmss(next.durationSec)}</span>
              <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>{next.powerLow}–{next.powerHigh} W</span>
            </span>
          </div>
          <p className={s.body}>
            {phase === 'waiting' ? 'Przerwa trwa dłużej niż w planie – nic nie szkodzi. ' : 'Zacznij, kiedy będziesz gotowy. '}
            Start wykryję sam powyżej <strong className={s.strong}>{Math.round(next.powerLow * 0.85)} W</strong> – timer liczy od pierwszej sekundy.
          </p>
        </section>
      ) : phase === 'autoPaused' ? (
        <section className={s.cardAmber}>
          <span className={s.strong} style={{ fontSize: 18 }}>Stoisz – interwał wstrzymany</span>
          <span className={s.small} style={{ color: '#D8C7A0' }}>Ruszysz mocno – wznowię od tego miejsca. Postój nie liczy się do serii.</span>
          <span className={s.bigTimer} style={{ color: '#E2C58E' }}>{mmss(live?.stepRemaining ?? 0)}</span>
          <div className={s.bar} style={{ backgroundColor: '#3A3220' }}><div className={s.barFill} style={{ width: `${progress}%`, backgroundColor: 'var(--amber)' }} /></div>
        </section>
      ) : phase === 'free' ? (
        <section className={s.grid2}>
          <Metric label="Czas" value={hmmss(live?.elapsed ?? 0)} />
          {live?.lat
            ? <Metric label="Dystans" value={km.toFixed(1).replace('.', ',')} unit="km" />
            : <Metric label="Praca" value={totals.kj} unit="kJ" />}
          {live?.lat
            ? <Metric label="Prędkość" value={kmh.toFixed(1).replace('.', ',')} unit="km/h" />
            : <Metric label="Śr. moc" value={totals.avg} unit="W" />}
          <Metric label="Tętno" value={live?.hr ?? '–'} unit="bpm" />
        </section>
      ) : (
        <section className={s.stack} style={{ gap: 6 }} aria-label="Czas do końca kroku">
          <div className={s.row}><span className={s.eyebrow}>Zostało</span><span className={s.small}>z {mmss(stepDur)}</span></div>
          <span className={s.bigTimer}>{mmss(live?.stepRemaining ?? stepDur)}</span>
          <div className={s.bar}><div className={s.barFill} style={{ width: `${progress}%`, backgroundColor: type === 'interval' ? 'var(--cyan)' : '#3A404A' }} /></div>
        </section>
      )}

      {/* --- moc */}
      <section className={s.card} aria-label="Moc">
        <div className={s.rowEnd}>
          <span className={s.row} style={{ alignItems: 'baseline', gap: 8 }}>
            <span className={s.bigPower} style={{ color: pColor }}>{live?.power3s ?? 0}</span><span className={s.unit}>W</span>
          </span>
          {phase !== 'free' && high > 0 && (
            <span className={s.stack} style={{ alignItems: 'flex-end', paddingBottom: 6 }}>
              <span className={s.metricLabel}>Cel</span>
              <span className={s.statValue} style={{ fontSize: 24 }}>{type === 'recovery' || type === 'cooldown' ? `< ${high}` : `${low}–${high}`}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: pColor }}>{pState}</span>
            </span>
          )}
        </div>
        {work && phase !== 'autoPaused' && high > 0 && <PowerGauge power={p3} low={low} high={high} />}
        {live?.lastSeries && type !== 'interval' && phase !== 'free' && (
          <span className={s.small}>Ostatnia seria {live.lastSeries.n}: <strong className={s.strong}>{live.lastSeries.avgPower} W</strong> · {mmss(live.lastSeries.durationSec)} · {live.lastSeries.compliancePct}% w zakresie</span>
        )}
      </section>

      <section className={phase === 'free' ? s.grid2 : s.grid3}>
        {phase !== 'free' && <Metric label="Tętno" value={live?.hr ?? '–'} sub=" " />}
        <Metric label="Kadencja" value={live?.cadence ?? '–'}
          sub={plan?.steps[idx]?.cadenceLow ? `cel ${plan.steps[idx].cadenceLow}–${plan.steps[idx].cadenceHigh}` : 'rpm'} />
        <Metric label="Balans" value={live?.balanceL != null ? `${Math.round(live.balanceL)}/${100 - Math.round(live.balanceL)}` : '–'} sub="L / P" />
      </section>

      {phase === 'free' && ride.planDone && (
        <span className={s.small}>Plan zakończony ✓ · serie: {ride.planDone.series.map((x) => x.avgPower).join(', ') || '–'} W</span>
      )}

      {phase === 'free' ? (
        live?.lat ? (
          <section className={s.grid2} aria-label="Od startu">
            <Metric label="Śr. moc" value={totals.avg} unit="W" />
            <Metric label="Praca" value={totals.kj} unit="kJ" />
          </section>
        ) : null
      ) : (
        <section className={s.grid3} aria-label="Od startu">
          <Metric label="Śr. moc" value={totals.avg} unit="W" />
          <Metric label="Praca" value={totals.kj} unit="kJ" />
          {plan ? <Metric label="Do końca" value={hmmss(planLeft)} /> : <Metric label="Czas" value={hmmss(live?.elapsed ?? 0)} />}
        </section>
      )}

      {ride.route && <NavCard nav={ride.nav} route={ride.route} pos={live?.lat && live?.lon ? { lat: live.lat, lon: live.lon } : null} />}

      <Cue text={lastCue} />

      {/* rozmowa z Enzo: pytanie i odpowiedź (znika po 20 s) */}
      {ride.coach && (ride.coach.state === 'listening' || Date.now() - ride.coach.at < 20000) && (
        <section className={s.cardCyan} aria-live="polite" style={{ padding: '10px 14px', fontSize: 14, lineHeight: 1.45 }}>
          {ride.coach.state === 'listening' ? <span className={s.strong}>🎙 Słucham…</span> : (
            <>
              {ride.coach.question && <div style={{ color: 'var(--muted)' }}>„{ride.coach.question}”</div>}
              {ride.coach.answer
                ? <div><span className={s.strong}>Enzo:</span> {ride.coach.answer}</div>
                : <div style={{ color: 'var(--muted)' }}>Enzo myśli…</div>}
            </>
          )}
        </section>
      )}
      <button type="button" className={s.btnGhost} onClick={ride.talk} style={{ width: '100%', height: 46, fontSize: 15 }}
        aria-label="Zapytaj Enzo">🎙 Zapytaj Enzo</button>

      {plan && plan.steps.length > 0 && phase !== 'free' && <ProgressStrip script={plan} current={idx} />}

      {next && phase !== 'free' && phase !== 'armed' && phase !== 'waiting' && (
        <div className={s.row} style={{ fontSize: 13, color: 'var(--muted)' }}>
          <span>Następnie: <strong className={s.strong} style={{ color: 'var(--text-2)' }}>
            {next.type === 'interval' ? `Interwał ${intervalNo(plan, idx + 1)} / ${total}` : next.name && next.name !== next.type ? next.name : STEP_NAMES[next.type]}
          </strong> · {mmss(next.durationSec)}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{next.type === 'recovery' || next.type === 'cooldown' ? `< ${next.powerHigh}` : `${next.powerLow}–${next.powerHigh}`} W</span>
        </div>
      )}

      <nav aria-label="Sterowanie" className={phase === 'armed' || phase === 'waiting' ? s.controlsWide : phase === 'free' ? s.grid2 : s.controls}
        style={{ marginTop: 'auto' }}>
        {pauseBtn}
        {phase === 'armed' || phase === 'waiting'
          ? <button type="button" className={s.btnPrimary} style={{ height: 58, fontSize: 15 }} onClick={ride.skip}><IconPlay size={16} />Start teraz</button>
          : phase !== 'free' && ((live?.falseStartLeft ?? 0) > 0
            ? <button type="button" className={s.btnDark} style={{ color: '#D98A57' }} onClick={ride.cancelStart}
                aria-label="Fałstart – odwołaj start interwału">↺ Fałstart · {live?.falseStartLeft} s</button>
            : <button type="button" className={s.btnDark} onClick={ride.skip}><IconNext />Dalej</button>)}
        {stopBtn}
      </nav>
    </div>
  );
}
