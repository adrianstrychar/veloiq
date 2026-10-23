'use client';
import s from './ride.module.css';
import type { WorkoutScript } from '@/lib/ride/workout-script';
import type { Ride, RideSettings } from './useRide';
import { IconBolt, IconHeart, IconPlay, Profile, StatusDot, hmmss, scriptStats } from './parts';
import { VoiceSettings } from './VoiceSettings';

interface Props {
  ride: Ride;
  plan: WorkoutScript | null;
  planLabel?: string;           // np. "Z planu · Blok progowy, tydz. 2"
  dateLabel: string;            // np. "Poniedziałek, 19 października"
  settings: RideSettings;
  onSettings: (s: RideSettings) => void;
  onStart: () => void;
  onFree: () => void;
  onSensors: () => void;
}

export function HomeScreen({ ride, plan, planLabel, dateLabel, settings, onSettings, onStart, onFree, onSensors }: Props) {
  const st = plan ? scriptStats(plan) : null;
  const power = ride.sensors.power;
  const hr = ride.sensors.hr;
  const ready = !!power?.connected;
  return (
    <div className={s.screen}>
      <header className={s.stack}>
        <span className={s.eyebrow}>{dateLabel}</span>
        <h1 className={s.title}>Trening dziś</h1>
      </header>

      {ride.recoverable && (
        <section className={s.cardAmber}>
          <span className={s.strong}>Przerwany trening: {ride.recoverable.name}</span>
          <span className={s.small}>Zapisane {hmmss(ride.recoverable.elapsed ?? 0)}. Możesz wznowić od tego miejsca.</span>
          <div className={s.grid2}>
            <button type="button" className={s.btnAmber} onClick={ride.resumeRecovered}>Wznów</button>
            <button type="button" className={s.btnGhost} onClick={ride.discardRecovered}>Odrzuć</button>
          </div>
        </section>
      )}

      {plan && st ? (
        <section className={s.card}>
          <div className={s.row} style={{ alignItems: 'flex-start' }}>
            <div className={s.stack}>
              {planLabel && <span className={s.eyebrowCyan}>{planLabel}</span>}
              <span className={s.title} style={{ fontSize: 28 }}>{plan.name}</span>
            </div>
            {settings.autoStart && <span className={s.small} style={{ border: '1px solid var(--line)', borderRadius: 999, padding: '4px 10px' }}>Elastyczny</span>}
          </div>
          <Profile script={plan} />
          <div className={s.grid4}>
            <div className={s.stack}><span className={s.metricLabel}>Czas</span><span className={s.statValue}>{hmmss(st.total)}</span></div>
            <div className={s.stack}><span className={s.metricLabel}>Cel</span><span className={s.statValue}>{st.target}</span></div>
            <div className={s.stack}><span className={s.metricLabel}>TSS</span><span className={s.statValue}>{st.tss}</span></div>
            <div className={s.stack}><span className={s.metricLabel}>FTP</span><span className={s.statValue}>{plan.ftp} W</span></div>
          </div>
          <p className={s.body} style={{ fontSize: 14 }}>
            {settings.autoStart
              ? 'Interwały startują, kiedy Ty ruszysz. Głos zapowie każdą serię minutę wcześniej i podsumuje ją po końcu.'
              : 'Interwały idą z zegarem. Głos zapowie start i podsumuje każdą serię.'}
          </p>
        </section>
      ) : (
        <section className={s.card}>
          <span className={s.strong}>Na dziś nie ma treningu w planie</span>
          <span className={s.small}>Możesz jechać swobodnie – nagram jazdę i sam wykryję mocne wysiłki.</span>
        </section>
      )}

      <section className={s.grid2} aria-label="Czujniki">
        <button type="button" className={s.metric} onClick={onSensors} style={{ textAlign: 'left', cursor: 'pointer', color: 'var(--text)', font: 'inherit' }}>
          <span className={s.metricLabel} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ color: 'var(--cyan)' }}><IconBolt /></span>Moc</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{power?.name ?? 'Nie połączono'}</span>
          <StatusDot ok={!!power?.connected}>{power?.connected ? 'Połączono' : 'Dotknij, aby połączyć'}</StatusDot>
        </button>
        <button type="button" className={s.metric} onClick={onSensors} style={{ textAlign: 'left', cursor: 'pointer', color: 'var(--text)', font: 'inherit' }}>
          <span className={s.metricLabel} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ color: 'var(--hr)' }}><IconHeart /></span>Tętno</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{hr?.name ?? 'Nie połączono'}</span>
          <StatusDot ok={!!hr?.connected}>{hr?.connected ? 'Połączono' : 'Opcjonalnie'}</StatusDot>
        </button>
      </section>

      <div className={s.segment} role="radiogroup" aria-label="Gdzie jedziesz">
        {[{ v: false, l: 'Trenażer' }, { v: true, l: 'Na zewnątrz · GPS' }].map((o) => (
          <button key={o.l} type="button" role="radio" aria-checked={settings.outdoor === o.v}
            className={settings.outdoor === o.v ? s.segBtnOn : s.segBtn} onClick={() => onSettings({ ...settings, outdoor: o.v })}>{o.l}</button>
        ))}
      </div>

      <details className={s.card} style={{ gap: 0 }}>
        <summary style={{ cursor: 'pointer', fontSize: 15, fontWeight: 600, listStyle: 'none', display: 'flex', justifyContent: 'space-between' }}>
          Głos lektora<span className={s.small}>zmień ›</span>
        </summary>
        <div style={{ paddingTop: 12 }}><VoiceSettings ride={ride} /></div>
      </details>

      {ride.error && <div className={s.banner} role="alert">{ride.error}</div>}

      <div className={s.footer}>
        {!ride.native && <span className={s.small} style={{ textAlign: 'center' }}>Przeglądarka: czujniki i jazda są symulowane.</span>}
        {plan && (
          <button type="button" className={s.btnPrimary} onClick={onStart} disabled={ride.native && !ready}>
            <IconPlay />{ride.native && !ready ? 'Połącz pomiar mocy' : 'Rozpocznij trening'}
          </button>
        )}
        <button type="button" className={plan ? s.btnGhost : s.btnPrimary} onClick={onFree}>Jazda swobodna (bez planu)</button>
      </div>
    </div>
  );
}
