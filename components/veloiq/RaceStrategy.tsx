'use client';

// Sekcja "Strategia wyścigu AI" — wygląd 1:1 z veloiq_landing_v6.html TAB 2 (docs/).
// Generacja przez POST /api/races/[id]/strategy (cache po fingerprincie). Paleta z landingu,
// NIE motyw aplikacji — świadomie (landing to źródło prawdy wizualnej dla tej sekcji).
import { useState } from 'react';
import type { RaceStrategy, PacingTier } from '@/lib/ai/race-strategy';

const L = {
  bg: '#0B0E12', card: 'rgba(255,255,255,0.025)', border: 'rgba(255,255,255,0.08)',
  white: '#F2F5F8', dim: '#8A94A0',
  accent: '#00CFFF', green: '#00E87A', gold: '#FFB830', red: '#FF3C64', blue: '#64B4FF',
};

// Kolory tierów pacing — dokładnie z .oszczedz/.atak/.full landingu.
const TIER: Record<PacingTier, { bg: string; fg: string }> = {
  oszczedz: { bg: 'rgba(100,180,255,0.12)', fg: L.blue },
  atak: { bg: 'rgba(0,232,122,0.12)', fg: L.green },
  full: { bg: 'rgba(255,60,100,0.12)', fg: L.red },
};

export interface RaceStrategyRace {
  id: string;
  name: string;
  distance_km: number | null;
  elevation_m: number | null;
  discipline: string | null;
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: L.card, border: `1px solid ${L.border}`, borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ padding: '0.7rem 1rem', borderBottom: `1px solid ${L.border}`, fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: L.white, fontWeight: 500 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  );
}

function StratRows({ items, tierOf }: { items: { left: string; tip: string; tier?: PacingTier }[]; tierOf?: boolean }) {
  return (
    <>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0.75rem 1rem', borderBottom: i < items.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}>
          {tierOf && it.tier ? (
            <span style={{ alignSelf: 'flex-start', fontSize: '0.58rem', fontWeight: 600, letterSpacing: '0.04em', padding: '0.2rem 0.6rem', borderRadius: 2, background: TIER[it.tier].bg, color: TIER[it.tier].fg }}>
              {it.left}
            </span>
          ) : (
            <div style={{ fontSize: '0.58rem', fontWeight: 600, color: L.dim, whiteSpace: 'nowrap' }}>{it.left}</div>
          )}
          <div style={{ fontSize: '0.7rem', color: L.dim, lineHeight: 1.6 }}>{it.tip}</div>
        </div>
      ))}
    </>
  );
}

export default function RaceStrategyView({ race, initialStrategy }: { race: RaceStrategyRace; initialStrategy: RaceStrategy | null }) {
  const [strategy, setStrategy] = useState<RaceStrategy | null>(initialStrategy);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (loading) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/races/${race.id}/strategy`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.strategy) setStrategy(data.strategy as RaceStrategy);
      else setError(data?.error ?? 'Nie udało się przygotować strategii.');
    } catch {
      setError('Błąd połączenia — spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
  }

  // Empty state — przycisk generacji (jeszcze nie ma planu w race_plans).
  if (!strategy) {
    return (
      <div style={{ background: L.card, border: `1px solid ${L.border}`, borderRadius: 3, padding: '1.2rem', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: L.dim, marginBottom: 12, lineHeight: 1.5 }}>
          Strategia wyścigu AI — rozkład tempa, żywienie i sprzęt pod Twój profil i ten start.
        </div>
        <button
          onClick={() => void generate()}
          disabled={loading}
          style={{ minHeight: 44, padding: '0 18px', border: 'none', borderRadius: 8, background: L.accent, color: '#04212B', fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}
        >
          {loading ? 'Generuję strategię…' : 'Generuj strategię'}
        </button>
        {error && <div style={{ fontSize: 12, color: L.red, marginTop: 10 }}>{error}</div>}
      </div>
    );
  }

  const s = strategy;
  return (
    <div style={{ background: L.bg, border: `1px solid ${L.border}`, borderRadius: 6, overflow: 'hidden' }}>
      {/* wk-header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '1rem 1.1rem', borderBottom: `1px solid ${L.border}` }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: L.white }}>
          {race.name}{s.meta.distance_km ? ` · ${s.meta.distance_km} km` : ''}{s.meta.elevation_m ? ` / ${s.meta.elevation_m} m` : ''}
        </div>
        <div style={{ fontSize: 9, background: 'rgba(0,207,255,0.15)', color: L.accent, borderRadius: 4, padding: '3px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>AI Strategy</div>
      </div>

      {/* wk-meta — 4 kafle jak landing; POGODA "—" (Etap 3: geocoding location→lat/lon + Open-Meteo ≤16 dni, świeży fetch poza cache strategii) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: `1px solid ${L.border}` }}>
        {[
          { v: s.meta.distance_km != null ? `${s.meta.distance_km} km` : '—', l: 'Dystans' },
          { v: s.meta.elevation_m != null ? `${s.meta.elevation_m} m` : '—', l: 'Przewyższenie' },
          { v: s.meta.surface, l: 'Nawierzchnia' },
          { v: '—', l: 'Pogoda', tip: 'Dostępna bliżej startu (~2 tyg.)' },
        ].map((m, i) => (
          <div key={i} title={m.tip} style={{ padding: '0.7rem 0.6rem', borderRight: i < 3 ? `1px solid ${L.border}` : 'none', textAlign: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: L.white }}>{m.v}</div>
            <div style={{ fontSize: 9, color: L.dim, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 2 }}>{m.l}</div>
          </div>
        ))}
      </div>

      {/* wk-blocks */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', padding: '1rem' }}>
        <Block title="Rozkład tempa">
          <StratRows tierOf items={s.pacing.map((p) => ({ left: `${p.phase} · ${p.watts}`, tip: p.tip, tier: p.tier }))} />
        </Block>

        <Block title="Strategia żelów i bidonów">
          <StratRows items={s.fueling.map((f) => ({ left: f.km, tip: f.tip }))} />
        </Block>

        <Block title="Sprzęt · Opony i ciśnienie">
          <div style={{ padding: '0.85rem 1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.6rem' }}>
              {[{ l: 'PRZÓD', v: s.tires.front, c: L.gold }, { l: 'TYŁ', v: s.tires.rear, c: L.green }].map((t, i) => (
                <div key={i} style={{ background: L.card, borderRadius: 6, padding: '0.55rem 0.7rem' }}>
                  <div style={{ fontSize: 9, color: L.dim, marginBottom: 2 }}>{t.l}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: t.c }}>{t.v}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10, color: L.dim, lineHeight: 1.5 }}>{s.tires.note}</div>
          </div>
        </Block>

        {/* Podsumowanie: Co zabrać na start */}
        <div style={{ background: 'rgba(255,184,48,0.07)', border: '1px solid rgba(255,184,48,0.2)', borderRadius: 6, padding: '1rem 1.1rem' }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: L.gold, marginBottom: '0.7rem', textTransform: 'uppercase' }}>
            Co zabrać na start{s.meta.distance_km ? ` — ${s.meta.distance_km} km` : ''}{s.meta.elevation_m ? ` / ${s.meta.elevation_m} m` : ''}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            {[{ h: 'Żywienie', items: s.packing.nutrition, dot: L.gold }, { h: 'Nawodnienie', items: s.packing.hydration, dot: L.accent }].map((col, i) => (
              <div key={i} style={{ fontSize: 12, color: L.dim, flex: 1, minWidth: 140 }}>
                <div style={{ color: L.white, fontWeight: 500, marginBottom: '0.35rem' }}>{col.h}</div>
                {col.items.map((it, j) => (
                  <div key={j} style={{ marginBottom: '0.2rem' }}>
                    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: col.dot, marginRight: 6, verticalAlign: 'middle' }} />
                    {it}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {s.packing.summary && (
            <div style={{ marginTop: '0.8rem', paddingTop: '0.7rem', borderTop: '1px solid rgba(255,184,48,0.15)', fontSize: 11, color: L.dim }}>
              {s.packing.summary}
            </div>
          )}
        </div>

        {s.strengths.length > 0 && (
          <Block title="AI rekomenduje · Twoje mocne strony">
            <StratRows items={s.strengths.map((x) => ({ left: x.km, tip: x.tip }))} />
          </Block>
        )}
      </div>

      {/* wk-footer */}
      <div style={{ padding: '0.7rem 1.1rem', borderTop: `1px solid ${L.border}`, fontSize: 10, color: L.dim, textAlign: 'center' }}>
        Analiza z Twoich parametrów startu i profilu · bez GPX (trasa wzbogaci strategię w kolejnym kroku)
        {s.targets.finish_time || s.targets.avg_watts ? ` · cel: ${[s.targets.finish_time, s.targets.avg_watts ? `${s.targets.avg_watts}W` : null, s.targets.if ? `IF ${s.targets.if}` : null].filter(Boolean).join(' · ')}` : ''}
      </div>
    </div>
  );
}
