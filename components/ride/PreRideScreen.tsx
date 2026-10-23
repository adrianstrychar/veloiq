'use client';
import s from './ride.module.css';
import type { WorkoutScript, WorkoutStep } from '@/lib/ride/workout-script';
import type { Ride, RideSettings } from './useRide';
import type { VoiceLevel } from '@/lib/ride/ride-engine';
import { BackHeader, IconPlay, StatusDot } from './parts';
import { VoiceSettings } from './VoiceSettings';

const COLORS: Record<string, string> = { warmup: '#3A404A', interval: '#4A8FC7', recovery: '#2E333C', steady: '#5B9B7E', cooldown: '#3A404A' };
const NAMES: Record<string, string> = { warmup: 'Rozgrzewka', interval: 'Interwał', recovery: 'Przerwa', steady: 'Tempo', cooldown: 'Schłodzenie' };

/** Zwija powtarzające się pary interwał/przerwa w "4 × Interwał" i "3 × Przerwa". */
function groupSteps(steps: WorkoutStep[]) {
  const out: { st: WorkoutStep; count: number }[] = [];
  const key = (x: WorkoutStep) => `${x.type}|${x.durationSec}|${x.powerLow}|${x.powerHigh}`;
  const seen = new Map<string, number>();
  steps.forEach((st) => {
    if (st.type === 'interval' || st.type === 'recovery') {
      const k = key(st);
      if (seen.has(k)) { out[seen.get(k)!].count++; return; }
      seen.set(k, out.length);
    }
    out.push({ st, count: 1 });
  });
  return out;
}

const dur = (sec: number) => (sec % 60 === 0 ? `${sec / 60} min` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} min`);

interface Props {
  ride: Ride;
  plan: WorkoutScript;
  settings: RideSettings;
  onSettings: (s: RideSettings) => void;
  onBack: () => void;
  onStart: () => void;
}

export function PreRideScreen({ ride, plan, settings, onSettings, onBack, onStart }: Props) {
  const rows = groupSteps(plan.steps);
  const toggles: { k: 'autoStart' | 'announceArm' | 'autoPause'; label: string; sub: string }[] = [
    { k: 'autoStart', label: 'Interwały startują automatycznie', sub: 'Wykrywam start po mocy – plan przesuwa się razem z Tobą.' },
    { k: 'announceArm', label: 'Zapowiedź minutę wcześniej', sub: 'Głos + odliczanie 10 s i 3-2-1.' },
    { k: 'autoPause', label: 'Auto-pauza na postojach', sub: 'Światła albo skrzyżowanie nie zjadają interwału.' },
  ];
  const levels: { v: VoiceLevel; l: string; hint: string }[] = [
    { v: 'full', l: 'Pełne', hint: 'Zapowiedzi, korekty mocy i kadencji, podsumowania serii.' },
    { v: 'struct', l: 'Struktura', hint: 'Tylko start, koniec i podsumowania serii – bez korekt.' },
    { v: 'off', l: 'Wyłączone', hint: 'Bez głosu. Wszystko widać na ekranie.' },
  ];
  const level = levels.find((l) => l.v === settings.voiceLevel) ?? levels[0];
  const powerOk = !!ride.sensors.power?.connected || !ride.native;
  const hrOk = !!ride.sensors.hr?.connected || !ride.native;

  return (
    <div className={s.screen}>
      <BackHeader onBack={onBack} eyebrow="Przed startem" title={plan.name} />

      <ol className={s.list}>
        {rows.map(({ st, count }, i) => (
          <li key={i} className={s.listItem}>
            <span className={s.swatch} style={{ backgroundColor: COLORS[st.type] }} />
            <span className={s.stack} style={{ gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{count > 1 ? `${count} × ` : ''}{st.name && st.name !== st.type ? st.name : NAMES[st.type]}</span>
              <span className={s.small} style={{ fontSize: 12 }}>
                {dur(st.durationSec)}
                {st.type === 'interval' && settings.autoStart && st.durationSec >= 60 ? ' · startuje, gdy ruszysz' : ''}
                {st.cadenceLow ? ` · kadencja ${st.cadenceLow}–${st.cadenceHigh ?? ''}` : ''}
              </span>
            </span>
            <span className={s.statValue} style={{ fontSize: 18, color: st.type === 'interval' ? 'var(--cyan)' : 'var(--text-2)' }}>
              {st.type === 'recovery' || st.type === 'cooldown' ? `< ${st.powerHigh} W` : `${st.powerLow}–${st.powerHigh} W`}
            </span>
          </li>
        ))}
      </ol>

      <section className={s.card} style={{ padding: '6px 16px', gap: 0 }}>
        {toggles.map((t) => (
          <label key={t.k} className={s.toggleRow}>
            <span className={s.stack} style={{ gap: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{t.label}</span>
              <span className={s.small} style={{ fontSize: 12 }}>{t.sub}</span>
            </span>
            <input type="checkbox" className={s.checkbox} checked={settings[t.k]} onChange={() => onSettings({ ...settings, [t.k]: !settings[t.k] })} />
          </label>
        ))}
        <div className={s.stack} style={{ gap: 8, padding: '12px 0 10px' }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Komunikaty głosowe</span>
          <div className={s.segment} role="radiogroup" aria-label="Poziom komunikatów" style={{ backgroundColor: '#14171C', border: 0 }}>
            {levels.map((l) => (
              <button key={l.v} type="button" role="radio" aria-checked={settings.voiceLevel === l.v}
                className={settings.voiceLevel === l.v ? s.segBtnOn : s.segBtn} onClick={() => onSettings({ ...settings, voiceLevel: l.v })}>{l.l}</button>
            ))}
          </div>
          <span className={s.small} style={{ fontSize: 12 }}>{level.hint}</span>
        </div>
        {settings.voiceLevel !== 'off' && <div style={{ padding: '4px 0 14px' }}><VoiceSettings ride={ride} /></div>}
      </section>

      <div className={s.footer}>
        <span className={s.row} style={{ justifyContent: 'center', gap: 16 }}>
          <StatusDot ok={powerOk}>Moc</StatusDot>
          <StatusDot ok={hrOk}>Tętno</StatusDot>
          <StatusDot ok={settings.outdoor}>{settings.outdoor ? 'GPS' : 'Trenażer'}</StatusDot>
        </span>
        <button type="button" className={s.btnPrimary} style={{ height: 60 }} onClick={onStart} disabled={!powerOk}>
          <IconPlay />Start · {NAMES[plan.steps[0]?.type ?? 'warmup']?.toLowerCase()}
        </button>
      </div>
    </div>
  );
}
