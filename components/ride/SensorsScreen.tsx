'use client';
import { useEffect } from 'react';
import s from './ride.module.css';
import type { Ride } from './useRide';
import { BackHeader, IconBolt, IconHeart, IconInfo, StatusDot } from './parts';

export function SensorsScreen({ ride, onBack }: { ride: Ride; onBack: () => void }) {
  // skanuj od razu po wejściu, zatrzymaj po wyjściu
  useEffect(() => {
    ride.scan();
    return () => { ride.stopScan(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const power = ride.sensors.power;
  const power2 = ride.sensors.power2;
  const dual = !!power2;
  const hr = ride.sensors.hr;
  // w trakcie treningu dane z 'live', poza nim podgląd z 'sensorData'
  const live = ride.active && ride.live ? ride.live : ride.sensorData;
  const candidates = ride.found.filter((f) => f.id !== power?.id && f.id !== power2?.id && f.id !== hr?.id);
  // pomiar dwustronny z osobnymi czujnikami (np. korby InPeak L + R): drugi dokładamy jako „2. stronę”
  const canAddSide = !!power?.connected && !power2;

  return (
    <div className={s.screen}>
      <BackHeader onBack={onBack} title="Czujniki" />

      <h2 className={s.h2}>Połączone</h2>
      <section className={s.card}>
        <div className={s.row}>
          <div className={s.row} style={{ justifyContent: 'flex-start', gap: 12 }}>
            <span style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: '#1B2B3C', color: 'var(--cyan)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><IconBolt /></span>
            <div className={s.stack} style={{ gap: 2 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{!power ? 'Brak pomiaru mocy' : dual ? 'Pomiar mocy · obie strony' : 'Pomiar mocy'}</span>
              <span className={s.small} style={{ fontSize: 12 }}>
                {power ? [power.name, power2?.name].filter(Boolean).join(' + ') : 'Zakręć korbą, żeby obudzić pedały'}
                {dual && !power2?.connected ? ' · 2. strona: łączę…' : ''}
              </span>
            </div>
          </div>
          <StatusDot ok={!!power?.connected}>{power?.connected ? 'Połączono' : power ? 'Łączę…' : '–'}</StatusDot>
        </div>
        {power?.connected && (
          <>
            <div className={s.grid3} style={{ backgroundColor: '#14171C', borderRadius: 12, padding: '10px 12px' }}>
              <div className={s.stack} style={{ gap: 2 }}><span className={s.metricLabel}>Moc</span><span className={s.statValue}>{live?.power ?? 0} W</span></div>
              <div className={s.stack} style={{ gap: 2 }}><span className={s.metricLabel}>Kadencja</span><span className={s.statValue}>{live?.cadence ?? 0}</span></div>
              <div className={s.stack} style={{ gap: 2 }}><span className={s.metricLabel}>Balans</span><span className={s.statValue}>{live?.balanceL != null ? `${Math.round(live.balanceL)} / ${100 - Math.round(live.balanceL)}` : '–'}</span></div>
            </div>
            <button type="button" className={s.btnGhost} onClick={ride.zeroOffset} style={{ height: 44 }}>Kalibracja zera</button>
            <span className={s.small} style={{ fontSize: 12 }}>Przed każdym treningiem: korby pionowo, bez nacisku na pedały.</span>
            {dual
              ? <button type="button" className={s.btnGhost} style={{ height: 40 }} onClick={() => ride.connect({ power2Id: '' })}>Odłącz 2. stronę</button>
              : <span className={s.small} style={{ fontSize: 12 }}>Widzisz połowę mocy? Masz osobny czujnik na każdej korbie – dodaj drugi poniżej jako „2. stronę”.</span>}
          </>
        )}
      </section>

      <section className={s.card} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className={s.row} style={{ justifyContent: 'flex-start', gap: 12 }}>
          <span style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: '#2A1C1E', color: 'var(--hr)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><IconHeart /></span>
          <div className={s.stack} style={{ gap: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>{hr ? 'Pas tętna' : 'Brak pasa tętna'}</span>
            <span className={s.small} style={{ fontSize: 12 }}>{hr?.name ?? 'Zwilż elektrody i załóż pas'}</span>
          </div>
        </div>
        {hr?.connected ? <span className={s.statValue}>{live?.hr ?? '–'}</span> : <StatusDot ok={false}>–</StatusDot>}
      </section>

      <h2 className={s.h2}>W pobliżu</h2>
      <div className={s.list} role="list">
        {candidates.length === 0 && <div className={s.small} style={{ padding: '14px 16px' }}>Szukam… Pedały LOOK pokażą się po zakręceniu korbą.</div>}
        {candidates.map((f) => {
          const asSide = f.kind === 'power' && canAddSide;
          return (
            <div key={f.id} role="listitem" className={s.sensorBtn}>
              <span className={s.stack} style={{ gap: 2, minWidth: 0 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <span className={s.small} style={{ fontSize: 12 }}>{f.kind === 'power' ? 'Pomiar mocy' : 'Tętno'} · sygnał {f.rssi} dBm</span>
              </span>
              <span style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
                {asSide && (
                  <button type="button" onClick={() => ride.connect({ power2Id: f.id })}
                    style={{ all: 'unset', cursor: 'pointer', color: 'var(--cyan)', fontWeight: 700 }}>+ 2. strona</button>
                )}
                <button type="button" onClick={() => ride.connect(f.kind === 'power' ? { powerId: f.id } : { hrId: f.id })}
                  style={{ all: 'unset', cursor: 'pointer', color: asSide ? 'var(--muted, #9AA0AB)' : 'var(--cyan)', fontWeight: 600 }}>
                  {asSide ? 'Zamień' : 'Połącz'}
                </button>
              </span>
            </div>
          );
        })}
      </div>

      <aside className={s.cue} style={{ marginTop: 'auto' }}>
        <span className={s.cueIcon}><IconInfo /></span>
        <span className={s.body} style={{ fontSize: 14 }}>Jedziesz z Edge? Ustaw w nim pedały i pas na <strong className={s.strong}>ANT+</strong>. Bluetooth zostaje wolny dla telefonu i oba urządzenia widzą dane naraz.</span>
      </aside>
      <button type="button" className={s.btnGhost} onClick={ride.scan}>Szukaj ponownie</button>
    </div>
  );
}
