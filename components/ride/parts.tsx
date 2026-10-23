'use client';
import type { ReactNode } from 'react';
import s from './ride.module.css';
import type { WorkoutScript } from '@/lib/ride/workout-script';

export const mmss = (sec: number) => {
  const v = Math.max(0, Math.round(sec));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};
export const hmmss = (sec: number) => {
  const v = Math.max(0, Math.round(sec));
  const h = Math.floor(v / 3600);
  return h ? `${h}:${String(Math.floor((v % 3600) / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}` : mmss(v);
};

// --- ikony (stroke, dziedziczą kolor)
const I = ({ children, size = 20, fill = false }: { children: ReactNode; size?: number; fill?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'}
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
export const IconBack = () => <I size={22}><path d="M15 18l-6-6 6-6" /></I>;
export const IconBolt = () => <I size={16}><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></I>;
export const IconHeart = () => <I size={16}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" /></I>;
export const IconPlay = ({ size = 18 }: { size?: number }) => <I size={size} fill><path d="M7 4.5v15l13-7.5z" /></I>;
export const IconPause = () => <I size={18} fill><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></I>;
export const IconNext = () => <I size={18} fill><path d="M5 5v14l10-7zM17 5h2v14h-2z" /></I>;
export const IconStop = () => <I size={16} fill><rect x="5" y="5" width="14" height="14" rx="2" /></I>;
export const IconSpeaker = () => <I><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></I>;
export const IconInfo = () => <I><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></I>;
export const IconSpark = () => <I size={16}><path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z" /></I>;

// --- klocki
export function BackHeader({ onBack, eyebrow, title }: { onBack: () => void; eyebrow?: string; title: string }) {
  return (
    <header className={s.backRow}>
      <button type="button" className={s.iconBtnBare} onClick={onBack} aria-label="Wróć"><IconBack /></button>
      <div className={s.stack} style={{ gap: 0 }}>
        {eyebrow && <span className={s.eyebrow}>{eyebrow}</span>}
        <h1 className={s.title} style={{ fontSize: 26 }}>{title}</h1>
      </div>
    </header>
  );
}

export function Metric({ label, value, sub, subColor, unit }: { label: string; value: ReactNode; sub?: ReactNode; subColor?: string; unit?: string }) {
  return (
    <div className={s.metric}>
      <span className={s.metricLabel}>{label}</span>
      <span className={s.metricValue}>{value}{unit && <span className={s.small}> {unit}</span>}</span>
      {sub !== undefined && <span className={s.metricSub} style={subColor ? { color: subColor } : undefined}>{sub}</span>}
    </div>
  );
}

export function Cue({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <section className={s.cue} aria-live="polite" aria-label="Ostatni komunikat">
      <span className={s.cueIcon}><IconSpeaker /></span>
      <span>„{text}”</span>
    </section>
  );
}

export function StatusDot({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={s.status} style={{ color: ok ? 'var(--ok)' : 'var(--muted)' }}>
      <span className={s.dot} style={{ backgroundColor: ok ? 'var(--ok)' : 'var(--line-2)' }} />{children}
    </span>
  );
}

/** Pasek celu: zakres celu + wskazówka aktualnej mocy. */
export function PowerGauge({ power, low, high }: { power: number; low: number; high: number }) {
  const min = Math.max(0, Math.floor((low * 0.65) / 50) * 50);
  const max = Math.ceil((high * 1.3) / 50) * 50;
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))}%`;
  return (
    <div className={s.gauge} role="img" aria-label={`Moc ${power} W, cel ${low} do ${high} W`}>
      <div className={s.gaugeTrack} />
      <div className={s.gaugeBand} style={{ left: pos(low), width: `calc(${pos(high)} - ${pos(low)})` }} />
      <div className={s.gaugeNeedle} style={{ left: pos(power) }} />
      <span className={s.gaugeMin}>{min}</span>
      <span className={s.gaugeMax}>{max}</span>
    </div>
  );
}

const STEP_COLORS: Record<string, string> = { warmup: '#3A404A', interval: '#4A8FC7', recovery: '#2E333C', steady: '#5B9B7E', cooldown: '#3A404A' };

/** Profil treningu (słupki: szerokość = czas, wysokość = moc). */
export function Profile({ script }: { script: WorkoutScript }) {
  const maxW = Math.max(1, ...script.steps.map((x) => x.powerHigh));
  return (
    <div className={s.profile} role="img" aria-label="Profil treningu">
      {script.steps.map((st, i) => (
        <div key={i} className={s.profileBar} style={{ flexGrow: st.durationSec, height: `${Math.round((st.powerHigh / maxW) * 68)}px`, backgroundColor: STEP_COLORS[st.type] ?? '#3A404A' }} />
      ))}
    </div>
  );
}

/** Postęp całego treningu – wykonane kroki przyciemnione, bieżący podświetlony. */
export function ProgressStrip({ script, current }: { script: WorkoutScript; current: number }) {
  return (
    <div className={s.progress} role="img" aria-label={`Krok ${current + 1} z ${script.steps.length}`}>
      {script.steps.map((st, i) => {
        const c = i === current ? '#4A8FC7' : i < current ? (st.type === 'interval' ? '#2F5E85' : '#3A404A') : '#21252C';
        return <span key={i} style={{ flexGrow: st.durationSec, backgroundColor: c }} />;
      })}
    </div>
  );
}

export function scriptStats(script: WorkoutScript) {
  const total = script.steps.reduce((a, x) => a + x.durationSec, 0);
  const ftp = script.ftp || 1;
  // TSS ≈ suma(czas × IF²) / 36, IF kroku = środek zakresu / FTP
  const tss = Math.round(script.steps.reduce((a, x) => a + x.durationSec * (((x.powerLow + x.powerHigh) / 2 / ftp) ** 2), 0) / 36);
  const work = script.steps.filter((x) => x.type === 'interval');
  const target = work.length ? `${work[0].powerLow}–${work[0].powerHigh} W` : '–';
  return { total, tss, intervals: work.length, target };
}
