'use client';
import { useEffect, useMemo, useState } from 'react';
import s from './ride.module.css';
import type { WorkoutScript } from '@/lib/ride/workout-script';
import type { WorkoutSummary } from '@/lib/ride/ride-engine';
import type { Ride } from './useRide';
import { IconSpark, hmmss, mmss } from './parts';

export interface RecordedSample { s: number; p?: number; hr?: number; cad?: number; lat?: number; lon?: number }

/** Czytelny powód błędu zapisu (Supabase). */
export function describeSaveError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/relation .*rides.* does not exist|Could not find the table/i.test(msg)) return 'Brak tabeli „rides” – uruchom migrację 021_rides.sql w Supabase Studio.';
  if (/bucket not found/i.test(msg)) return 'Brak bucketu „rides” w Storage – uruchom migrację 021_rides.sql w Supabase Studio.';
  if (/row-level security|violates|not authorized|Unauthorized|JWT/i.test(msg)) return 'Brak uprawnień – zaloguj się ponownie i spróbuj jeszcze raz.';
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return 'Brak internetu – spróbuj, gdy wróci zasięg.';
  if (/Brak zalogowanego/i.test(msg)) return 'Nie jesteś zalogowany – zaloguj się i zapisz ponownie.';
  return msg || 'Nieznany błąd.';
}

export function parseJsonl(data: string): RecordedSample[] {
  return data.split('\n').filter(Boolean).flatMap((l) => {
    try { const o = JSON.parse(l); return typeof o.s === 'number' && !o.ev ? [o as RecordedSample] : []; } catch { return []; }
  });
}

interface Props {
  ride: Ride;
  plan: WorkoutScript | null;
  summary: WorkoutSummary;
  ftp: number;
  startedAt: Date;
  /** Zapis do VeloIQ (Supabase) – patrz lib/ride/save-ride.ts. */
  onSave: (summary: WorkoutSummary, samples: RecordedSample[]) => Promise<void>;
  onAskCoach?: () => void;
  /** discard = true: użytkownik odrzucił niezapisany trening. */
  onDone: (discard: boolean) => void;
}

export function SummaryScreen({ ride, plan, summary, ftp, startedAt, onSave, onAskCoach, onDone }: Props) {
  const [samples, setSamples] = useState<RecordedSample[]>([]);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErr, setSaveErr] = useState<string>('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => { ride.readRecording(summary.file).then((d) => setSamples(parseJsonl(d))).catch(() => setSamples([])); }, [ride, summary.file]);

  const IF = ftp ? summary.normalizedPower / ftp : 0;
  const tss = ftp ? Math.round((summary.durationSec * summary.normalizedPower * IF) / (ftp * 3600) * 100) : 0;
  const stats: { l: string; v: string; u?: string }[] = [
    { l: 'Czas', v: hmmss(summary.durationSec) }, { l: 'NP', v: String(summary.normalizedPower), u: 'W' },
    { l: 'Śr. moc', v: String(summary.avgPower), u: 'W' }, { l: 'IF', v: IF.toFixed(2).replace('.', ',') },
    { l: 'TSS', v: String(tss) }, { l: 'Praca', v: String(summary.kJ), u: 'kJ' },
    { l: 'Śr. HR', v: summary.avgHr ? String(summary.avgHr) : '–' }, { l: 'Max HR', v: summary.maxHr ? String(summary.maxHr) : '–' },
  ];

  // wykres: średnia minutowa, serie podświetlone
  const bars = useMemo(() => {
    if (!samples.length) return [];
    const inSeries = new Set<number>();
    summary.series.forEach((x) => { for (let k = x.startSec; k < x.startSec + x.durationSec; k++) inSeries.add(k); });
    const per = Math.max(60, Math.ceil(samples.length / 90)); // max ~90 słupków
    const out: { h: number; series: boolean }[] = [];
    for (let i = 0; i < samples.length; i += per) {
      const chunk = samples.slice(i, i + per);
      const avg = chunk.reduce((a, x) => a + (x.p ?? 0), 0) / chunk.length;
      const ser = chunk.filter((x) => inSeries.has(x.s)).length > chunk.length / 2;
      out.push({ h: avg, series: ser });
    }
    return out;
  }, [samples, summary.series]);
  const maxBar = Math.max(ftp * 1.2, ...bars.map((b) => b.h), 1);

  // czas w strefach Coggana (Z1 <55%, Z2 56–75, Z3 76–90, Z4 91–105, Z5 106–120, Z6 >120 % FTP); postój (0 W) pomijamy
  const zones = useMemo(() => {
    if (!samples.length || !ftp) return [];
    const Z = [
      { n: 1, name: 'regeneracja', max: 0.55, color: '#3A404A' }, { n: 2, name: 'wytrzymałość', max: 0.75, color: '#5B9B7E' },
      { n: 3, name: 'tempo', max: 0.9, color: '#7FA86A' }, { n: 4, name: 'próg', max: 1.05, color: '#C99A4E' },
      { n: 5, name: 'VO2', max: 1.2, color: '#D98A57' }, { n: 6, name: 'beztlenowa', max: Infinity, color: '#C76B6B' },
    ];
    const sec = Z.map(() => 0);
    let moving = 0;
    for (const x of samples) {
      const p = x.p ?? 0;
      if (p <= 0) continue;
      moving++;
      sec[Z.findIndex((z) => p / ftp <= z.max)]++;
    }
    if (!moving) return [];
    return Z.map((z, i) => ({ ...z, sec: sec[i], pct: (sec[i] / moving) * 100 }));
  }, [samples, ftp]);

  const hrs = summary.series.filter((x) => x.avgHr);
  const hrMin = hrs.length ? Math.min(...hrs.map((x) => x.avgHr!)) - 8 : 0;
  const hrMax = hrs.length ? Math.max(...hrs.map((x) => x.avgHr!)) : 1;
  const hrDrift = hrs.length >= 2 ? hrs[hrs.length - 1].avgHr! - hrs[0].avgHr! : 0;

  const save = async () => {
    setSaving('saving');
    try { await onSave(summary, samples); setSaving('saved'); }
    catch (e) { setSaveErr(describeSaveError(e)); setSaving('error'); }
  };

  return (
    <div className={s.screen} style={{ gap: 16 }}>
      <header className={s.stack}>
        <span className={s.eyebrow} style={{ color: 'var(--ok)' }}>{saving === 'saved' ? 'Zapisano w VeloIQ' : 'Trening zakończony'}</span>
        <h1 className={s.title} style={{ fontSize: 32 }}>{plan?.name ?? 'Jazda swobodna'}</h1>
        <span className={s.small} style={{ fontSize: 14 }}>
          {startedAt.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' })} · {startedAt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </header>

      <section className={s.grid4}>
        {stats.map((x) => (
          <div key={x.l} className={s.metric} style={{ padding: 10, borderRadius: 14 }}>
            <span className={s.metricLabel} style={{ fontSize: 10 }}>{x.l}</span>
            <span className={s.statValue} style={{ whiteSpace: 'nowrap' }}>{x.v}{x.u && <span className={s.small} style={{ fontSize: 12, marginLeft: 3 }}>{x.u}</span>}</span>
          </div>
        ))}
      </section>

      {bars.length > 0 && (
        <section className={s.card} aria-label="Wykres mocy" style={{ gap: 8 }}>
          <div className={s.row}>
            <span className={s.eyebrow}>Moc · średnia {Math.round(samples.length / bars.length / 60) || 1} min</span>
            <span className={s.small} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className={s.dot} style={{ backgroundColor: 'var(--cyan)', borderRadius: 2, width: 10, height: 10 }} />serie
            </span>
          </div>
          <div className={s.chart} role="img" aria-label={`Moc w czasie, średnio ${summary.avgPower} W`}>
            <div className={s.chartFtp} style={{ bottom: `${(ftp / maxBar) * 128}px` }} />
            {bars.map((b, i) => <span key={i} style={{ height: `${Math.max(2, (b.h / maxBar) * 128)}px`, backgroundColor: b.series ? 'var(--cyan)' : '#3A404A' }} />)}
          </div>
          <div className={s.row} style={{ fontSize: 10, color: 'var(--muted)' }}><span>0:00</span><span>FTP {ftp} W – - -</span><span>{hmmss(summary.durationSec)}</span></div>
        </section>
      )}

      {zones.length > 0 && (
        <section className={s.card} aria-label="Czas w strefach mocy" style={{ gap: 8 }}>
          <span className={s.eyebrow}>Czas w strefach · FTP {ftp} W</span>
          {zones.map((z) => (
            <div key={z.n} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 56px', gap: 10, alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>Z{z.n}</span>
              <span style={{ position: 'relative', height: 14, borderRadius: 4, backgroundColor: 'var(--surface-2)', overflow: 'hidden' }}>
                <span style={{ position: 'absolute', inset: 0, width: `${Math.max(z.pct > 0 ? 2 : 0, z.pct)}%`, backgroundColor: z.color, borderRadius: 4 }} />
              </span>
              <span className={s.right} style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{z.sec >= 60 ? `${Math.round(z.sec / 60)} min` : `${z.sec} s`}</span>
            </div>
          ))}
          <span className={s.small} style={{ fontSize: 12 }}>{zones.map((z) => `Z${z.n} ${z.name}`).join(' · ')}</span>
        </section>
      )}

      {summary.series.length > 0 && (
        <section className={s.card} aria-label="Serie" style={{ gap: 6 }}>
          <span className={s.eyebrow}>Serie – plan vs wykonanie</span>
          <div className={s.seriesHead}><span>#</span><span>Czas</span><span className={s.right}>Moc</span><span className={s.right}>Zakres</span><span className={s.right}>Przerwa</span></div>
          {summary.series.map((x) => {
            const note = x.endedEarly ? `przerwana z ${mmss(x.plannedSec)}` : `plan ${mmss(x.plannedSec)}`;
            const pctColor = x.compliancePct >= 85 ? 'var(--ok)' : x.compliancePct >= 70 ? 'var(--amber)' : 'var(--danger)';
            return (
              <div key={x.n} className={s.seriesRow}>
                <span style={{ fontWeight: 700, color: 'var(--cyan)' }}>{x.n}</span>
                <span className={s.stack} style={{ gap: 0 }}>
                  <span className={s.statValue} style={{ fontSize: 19 }}>{mmss(x.durationSec)}</span>
                  <span style={{ fontSize: 11, color: x.endedEarly ? 'var(--danger)' : 'var(--muted)' }}>{note}</span>
                </span>
                <span className={`${s.right} ${s.statValue}`} style={{ fontSize: 19 }}>{x.avgPower} W</span>
                <span className={s.right} style={{ fontSize: 14, fontWeight: 600, color: pctColor }}>{x.compliancePct}%</span>
                <span className={s.right} style={{ fontSize: 14, color: 'var(--text-2)' }}>{x.restBeforeSec != null ? mmss(x.restBeforeSec) : '–'}</span>
              </div>
            );
          })}
          <span className={s.small} style={{ fontSize: 12, paddingTop: 4 }}>Przerwa to faktyczny czas od końca poprzedniego kroku do Twojego startu.</span>
        </section>
      )}

      {hrs.length >= 2 && (
        <section className={s.card} aria-label="Tętno w seriach">
          <span className={s.eyebrow}>Tętno w seriach</span>
          <div role="img" aria-label={`Średnie tętno serii: ${hrs.map((x) => x.avgHr).join(', ')}`} style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 70 }}>
            {hrs.map((x, i) => (
              <div key={x.n} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{x.avgHr}</span>
                <div style={{ width: '100%', height: `${Math.max(6, ((x.avgHr! - hrMin) / Math.max(1, hrMax - hrMin)) * 48)}px`, backgroundColor: 'var(--hr)', opacity: 0.5 + (i / hrs.length) * 0.5, borderRadius: 4 }} />
              </div>
            ))}
          </div>
          <span className={s.body} style={{ fontSize: 13 }}>
            {hrDrift >= 5 ? `+${hrDrift} uderzeń od 1. do ostatniej serii – zmęczenie narasta.` : 'Tętno stabilne między seriami.'}
          </span>
        </section>
      )}

      {summary.efforts.length > 0 && (
        <section className={s.card} aria-label="Wysiłki">
          <span className={s.eyebrow}>Wysiłki wykryte automatycznie</span>
          {summary.efforts.map((x, i) => (
            <div key={i} className={s.row}>
              <span className={s.small}>{hmmss(x.startSec)}</span>
              <span className={s.statValue} style={{ fontSize: 20 }}>{mmss(x.durationSec)}</span>
              <span className={s.statValue} style={{ fontSize: 20, color: 'var(--cyan)' }}>{x.avgPower} W</span>
            </div>
          ))}
        </section>
      )}

      {onAskCoach && (
        <section className={s.cardCyan} style={{ backgroundColor: 'var(--cyan-wash)' }}>
          <span className={s.eyebrowCyan} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><IconSpark />Analiza VeloIQ</span>
          <p className={s.body} style={{ color: 'var(--text)' }}>{saving === 'saved' ? 'Trening zapisany. Trener AI porówna serie z planem i zaproponuje kolejny krok.' : 'Zapisz trening, a trener AI porówna serie z planem i zaproponuje kolejny krok.'}</p>
          <button type="button" className={s.btnText} style={{ justifyContent: 'flex-start', padding: 0, color: 'var(--cyan)' }} onClick={onAskCoach} disabled={saving !== 'saved'} aria-disabled={saving !== 'saved'}>{saving === 'saved' ? 'Zapytaj trenera AI →' : 'Najpierw zapisz trening'}</button>
        </section>
      )}

      {saving === 'error' && (
        <div className={s.banner} role="alert">
          <strong className={s.strong}>Nie udało się zapisać.</strong> Trening zostaje w telefonie – wróci na ekranie „Jedź”, dopóki go nie zapiszesz.
          <span style={{ display: 'block', fontSize: 12, marginTop: 6, opacity: 0.85 }}>{saveErr}</span>
        </div>
      )}

      <section className={s.stack} style={{ gap: 10 }}>
        <button type="button" className={s.btnPrimary} onClick={save} disabled={saving === 'saving' || saving === 'saved'}>
          {saving === 'saving' ? 'Zapisuję…' : saving === 'saved' ? 'Zapisano ✓' : 'Zapisz w VeloIQ'}
        </button>
        <div className={s.grid2}>
          <button type="button" className={s.btnGhost} disabled title="Wkrótce">Strava · wkrótce</button>
          <button type="button" className={s.btnGhost} disabled title="Wkrótce">FIT · wkrótce</button>
        </div>
        {saving === 'saved'
          ? <button type="button" className={s.btnText} onClick={() => onDone(false)}>Gotowe</button>
          : <button type="button" className={s.btnText} style={confirmDiscard ? { color: 'var(--danger)' } : undefined}
              onClick={() => (confirmDiscard ? onDone(true) : setConfirmDiscard(true))}>
              {confirmDiscard ? 'Na pewno odrzucić? Dotknij jeszcze raz' : 'Odrzuć trening'}
            </button>}
      </section>
    </div>
  );
}
