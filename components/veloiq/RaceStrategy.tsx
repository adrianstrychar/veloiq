'use client';

// Sekcja "Strategia wyścigu AI" — wygląd 1:1 z veloiq_landing_v6.html TAB 2 (docs/).
// Generacja przez POST /api/races/[id]/strategy (cache po fingerprincie). Paleta z landingu,
// NIE motyw aplikacji — świadomie (landing to źródło prawdy wizualnej dla tej sekcji).
import { useRef, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis } from 'recharts';
import type { RaceStrategy, PacingTier } from '@/lib/ai/race-strategy';
import type { RouteAnalysis } from '@/lib/route/detect-climbs';

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

// "Zwiń" — subtelny przycisk (outline, dim), spójny z wk-* landingu. Nad i pod blokami.
function CollapseBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ width: '100%', minHeight: 40, border: `1px solid ${L.border}`, borderRadius: 8, background: 'transparent', color: L.dim, fontSize: 13, fontWeight: 600, letterSpacing: '0.02em', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
    >
      Zwiń <span style={{ fontSize: 9 }}>▲</span>
    </button>
  );
}

// Przycisk wgrania GPX (ukryty input file). Outline w akcencie landingu.
function GpxButton({ label, onFile, busy }: { label: string; onFile: (f: File) => void; busy: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref} type="file" accept=".gpx,application/gpx+xml,application/xml" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
      />
      <button
        onClick={() => ref.current?.click()} disabled={busy}
        style={{ minHeight: 40, padding: '0 14px', border: `1px solid ${L.accent}`, borderRadius: 8, background: 'transparent', color: L.accent, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
      >
        {busy ? 'Wczytuję trasę…' : label}
      </button>
    </>
  );
}

// Mini-wykres profilu wysokości (recharts, jak sparkline) + licznik podjazdów.
function RouteProfile({ analysis, name }: { analysis: RouteAnalysis; name: string | null }) {
  return (
    <Block title={`Profil trasy${name ? ` · ${name}` : ''} · ${analysis.climbs.length} podjazdów`}>
      <div style={{ padding: '0.6rem 0.8rem 0.5rem' }}>
        <div style={{ height: 90 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={analysis.profile} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
              <defs>
                <linearGradient id="eleFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={L.accent} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={L.accent} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="km" hide />
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Area type="monotone" dataKey="ele" stroke={L.accent} strokeWidth={1.5} fill="url(#eleFill)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div style={{ fontSize: 10, color: L.dim, marginTop: 4 }}>
          {analysis.distance_km} km · +{analysis.elevation_m} m
        </div>
      </div>
    </Block>
  );
}

export default function RaceStrategyView({ race, initialStrategy, initialRoute }: { race: RaceStrategyRace; initialStrategy: RaceStrategy | null; initialRoute: { name: string | null; analysis: RouteAnalysis } | null }) {
  const [strategy, setStrategy] = useState<RaceStrategy | null>(initialStrategy);
  // Domyślnie ZWINIĘTA gdy strategia istnieje przy montowaniu (wejście na Races → zwinięta).
  // useState czyta initialStrategy tylko raz — po re-mount (przełączenie zakładki) znów TRUE.
  const [collapsed, setCollapsed] = useState<boolean>(initialStrategy != null);
  const [route, setRoute] = useState(initialRoute);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function generate() {
    if (loading) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/races/${race.id}/strategy`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.strategy) {
        setStrategy(data.strategy as RaceStrategy);
        setCollapsed(false); // świeżo wygenerowana → od razu rozwinięta (do przeczytania)
      } else setError(data?.error ?? 'Nie udało się przygotować strategii.');
    } catch {
      setError('Błąd połączenia — spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
  }

  // Wgranie GPX → zapis route_analysis → auto-przeliczenie strategii (fingerprint się zmienił).
  async function uploadGpx(file: File) {
    if (uploading || loading) return;
    setUploading(true); setUploadError(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`/api/races/${race.id}/gpx`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.analysis) {
        setRoute({ name: (data.route_name as string | null) ?? null, analysis: data.analysis as RouteAnalysis });
        await generate();
      } else setUploadError(data?.error ?? 'Nie udało się wczytać trasy.');
    } catch {
      setUploadError('Błąd połączenia — spróbuj ponownie.');
    } finally {
      setUploading(false);
    }
  }

  // Empty state — przycisk generacji (jeszcze nie ma planu w race_plans). Trasę GPX można wgrać
  // od razu (opcjonalnie) — wtedy strategia policzy się per realny podjazd.
  if (!strategy) {
    return (
      <div style={{ background: L.card, border: `1px solid ${L.border}`, borderRadius: 3, padding: '1.2rem', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: L.dim, marginBottom: 12, lineHeight: 1.5 }}>
          Strategia wyścigu AI — rozkład tempa, żywienie i sprzęt pod Twój profil i ten start.
        </div>
        {route && <div style={{ marginBottom: 12, textAlign: 'left' }}><RouteProfile analysis={route.analysis} name={route.name} /></div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => void generate()}
            disabled={loading || uploading}
            style={{ minHeight: 44, padding: '0 18px', border: 'none', borderRadius: 8, background: L.accent, color: '#04212B', fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: loading || uploading ? 0.6 : 1 }}
          >
            {loading ? 'Generuję strategię…' : 'Generuj strategię'}
          </button>
          <GpxButton label={route ? 'Zmień trasę GPX' : 'Dodaj trasę GPX'} onFile={(f) => void uploadGpx(f)} busy={uploading} />
        </div>
        {error && <div style={{ fontSize: 12, color: L.red, marginTop: 10 }}>{error}</div>}
        {uploadError && <div style={{ fontSize: 12, color: L.red, marginTop: 10 }}>{uploadError}</div>}
      </div>
    );
  }

  // Stan ZWINIĘTY — strategia jest w bazie/stanie, ale pokazujemy TYLKO przycisk (bez teasera, bez bloków).
  // Wczesny return → CAŁE wk-blocks (w tym profil GPX i podjazdy) zwija się razem ze strategią.
  if (collapsed) {
    return (
      <div style={{ background: L.card, border: `1px solid ${L.border}`, borderRadius: 3, padding: '1.2rem', textAlign: 'center' }}>
        <button
          onClick={() => setCollapsed(false)}
          style={{ minHeight: 44, padding: '0 18px', border: 'none', borderRadius: 8, background: L.accent, color: '#04212B', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
        >
          Pokaż strategię
        </button>
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
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {route && (
            <div title={route.name ?? undefined} style={{ fontSize: 9, background: 'rgba(0,232,122,0.14)', color: L.green, borderRadius: 4, padding: '3px 8px', fontWeight: 600, whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              🗺 {route.name ?? 'trasa'}
            </div>
          )}
          <div style={{ fontSize: 9, background: 'rgba(0,207,255,0.15)', color: L.accent, borderRadius: 4, padding: '3px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>AI Strategy</div>
        </div>
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
        {/* Zwiń — NA GÓRZE (nad blokami) */}
        <CollapseBtn onClick={() => setCollapsed(true)} />

        {/* Profil trasy z GPX (Etap 2) — pierwszy blok, zwija się razem z resztą */}
        {route && <RouteProfile analysis={route.analysis} name={route.name} />}

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

        {/* Wgranie/zmiana trasy GPX — przelicza strategię per realny podjazd */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '0.2rem' }}>
          <GpxButton label={route ? 'Zmień trasę GPX' : 'Dodaj trasę GPX'} onFile={(f) => void uploadGpx(f)} busy={uploading || loading} />
        </div>
        {uploadError && <div style={{ fontSize: 12, color: L.red, textAlign: 'center' }}>{uploadError}</div>}

        {/* Zwiń — NA DOLE (pod blokami) */}
        <CollapseBtn onClick={() => setCollapsed(true)} />
      </div>

      {/* wk-footer */}
      <div style={{ padding: '0.7rem 1.1rem', borderTop: `1px solid ${L.border}`, fontSize: 10, color: L.dim, textAlign: 'center' }}>
        {route
          ? `Analiza z profilu trasy GPX · ${route.analysis.climbs.length} podjazdów · pacing per realny podjazd`
          : 'Analiza z Twoich parametrów startu i profilu · bez GPX (dodaj trasę, by liczyć per realny podjazd)'}
        {s.targets.finish_time || s.targets.avg_watts ? ` · cel: ${[s.targets.finish_time, s.targets.avg_watts ? `${s.targets.avg_watts}W` : null, s.targets.if ? `IF ${s.targets.if}` : null].filter(Boolean).join(' · ')}` : ''}
      </div>
    </div>
  );
}
