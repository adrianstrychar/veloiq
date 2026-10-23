'use client';
// Wybór lektora: głos (z zainstalowanych w iOS), tempo mowy, odsłuch.
import { useEffect } from 'react';
import s from './ride.module.css';
import type { Ride } from './useRide';
import { IconSpeaker } from './parts';

const RATES = [{ v: 0.45, l: 'Wolniej' }, { v: 0.5, l: 'Normalnie' }, { v: 0.56, l: 'Szybciej' }];
const Q: Record<string, string> = { premium: 'Premium', enhanced: 'Rozszerzony', default: 'Podstawowy' };
const SAMPLE = 'Za minutę interwał 2 z 4. 8 minut, 305 do 320 watów. Zacznij, kiedy będziesz gotowy.';

export function VoiceSettings({ ride }: { ride: Ride }) {
  useEffect(() => { ride.loadVoices(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const { voices, current, rate, packs = [] } = ride.voice;
  const mode = packs.length ? ride.voice.mode ?? 'enzo' : 'system';
  const best = voices.some((v) => v.quality !== 'default');
  const nearest = RATES.reduce((a, b) => (Math.abs(b.v - rate) < Math.abs(a.v - rate) ? b : a));

  return (
    <div className={s.stack} style={{ gap: 10 }}>
      <span style={{ fontSize: 15, fontWeight: 600 }}>Lektor</span>
      {packs.length > 0 && (
        <div className={s.segment} role="radiogroup" aria-label="Rodzaj lektora" style={{ backgroundColor: '#14171C', border: 0 }}>
          {[{ v: 'enzo' as const, l: 'Dyrektor Enzo' }, { v: 'system' as const, l: 'Głos systemowy' }].map((o) => (
            <button key={o.v} type="button" role="radio" aria-checked={mode === o.v}
              className={mode === o.v ? s.segBtnOn : s.segBtn} onClick={() => ride.setVoice({ mode: o.v })}>{o.l}</button>
          ))}
        </div>
      )}
      {mode === 'enzo' ? (
        <span className={s.small} style={{ fontSize: 13 }}>
          Dyrektor sportowy w słuchawce: emocje, włoskie „Forza!” i „Bravissimo!”, efekt radia. Działa bez internetu.
          Nietypowe komunikaty, których nie ma w nagraniach, przeczyta głos systemowy.
        </span>
      ) : voices.length > 0 ? (
        <div className={s.list} role="radiogroup" aria-label="Głos lektora">
          {voices.map((v) => (
            <button key={v.id} type="button" role="radio" aria-checked={current === v.id} className={s.sensorBtn}
              onClick={() => { ride.setVoice({ id: v.id }); setTimeout(() => ride.testVoice('Cześć, będę prowadził Twój trening.'), 150); }}>
              <span className={s.stack} style={{ gap: 2 }}>
                <span>{v.name}</span>
                <span className={s.small} style={{ fontSize: 12 }}>{Q[v.quality] ?? v.quality}</span>
              </span>
              <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 10, boxSizing: 'border-box',
                border: current === v.id ? '6px solid var(--cyan)' : '2px solid var(--line-2)' }} />
            </button>
          ))}
        </div>
      ) : (
        <span className={s.small} style={{ fontSize: 12 }}>Głos systemowy pl-PL.</span>
      )}
      {mode === 'system' && !best && (
        <span className={s.small} style={{ fontSize: 12 }}>
          Naturalniejszy głos: iPhone → Ustawienia → Dostępność → Treść mówiona → Głosy → Polski → pobierz „Zosia (rozszerzony)” lub Premium. Potem wróć tutaj.
        </span>
      )}
      {mode === 'system' && <div className={s.segment} role="radiogroup" aria-label="Tempo mowy" style={{ backgroundColor: '#14171C', border: 0 }}>
        {RATES.map((r) => (
          <button key={r.v} type="button" role="radio" aria-checked={nearest.v === r.v}
            className={nearest.v === r.v ? s.segBtnOn : s.segBtn} onClick={() => ride.setVoice({ rate: r.v })}>{r.l}</button>
        ))}
      </div>}
      <button type="button" className={s.btnGhost} style={{ height: 46, gap: 8 }} onClick={() => ride.testVoice(SAMPLE)}>
        <IconSpeaker />Odsłuchaj w słuchawkach
      </button>
    </div>
  );
}
