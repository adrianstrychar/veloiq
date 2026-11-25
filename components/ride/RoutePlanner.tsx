'use client';
// Planer tras VeloIQ: profil roweru (szosa / gravel / MTB / spokojna) dobiera drogi, pętla na zadany dystans albo
// trasa do celu z punktami pośrednimi, 2–3 warianty do porównania (czas z Twojej mocy, przewyższenie, nawierzchnia,
// kilometry po drogach z ruchem). Wybrana trasa trafia do nawigacji w telefonie i na licznik Garmin.
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import s from './ride.module.css';
import { routeToGpx, type RideRoute, type RoutePoi } from '@/lib/ride/gpx';

const PlannerMap = dynamic(() => import('./PlannerMap'), { ssr: false, loading: () => <div style={{ height: 300, borderRadius: 14, background: '#14171C' }} /> });

type Profile = 'road' | 'gravel' | 'mtb' | 'calm';
type LL = { lat: number; lon: number };
interface Stats { total: number; gain: number; estSec: number; surface: [number, number, number, number]; mainRoad: number }
interface Variant { route: RideRoute; stats: Stats; tag: string; heading?: number }
interface Place { name: string; label: string; lat: number; lon: number }

const PROFILES: { k: Profile; label: string; sub: string }[] = [
  { k: 'road', label: 'Szosa', sub: 'asfalt, mało ruchu' },
  { k: 'gravel', label: 'Gravel', sub: 'szutry i drogi polne' },
  { k: 'mtb', label: 'MTB', sub: 'ścieżki i single' },
  { k: 'calm', label: 'Spokojna', sub: 'bezpiecznie, rekreacyjnie' },
];
const DIRS: { label: string; deg: number | null }[] = [
  { label: 'Dowolny', deg: null }, { label: 'N', deg: 0 }, { label: 'NE', deg: 45 }, { label: 'E', deg: 90 }, { label: 'SE', deg: 135 },
  { label: 'S', deg: 180 }, { label: 'SW', deg: 225 }, { label: 'W', deg: 270 }, { label: 'NW', deg: 315 },
];
const SURF = [{ c: '#4A8FC7', l: 'asfalt' }, { c: '#D9A557', l: 'szuter' }, { c: '#5B9B7E', l: 'teren' }, { c: '#8A8F98', l: '?' }];
const POI_ICON: Record<string, string> = { water: '💧', cafe: '☕', bike: '🔧', toilets: 'WC', shop: '🛒', fuel: '⛽', food: '🍽' };
const PREFS = 'veloiq.planner.v1';

const hm = (sec: number) => { const m = Math.round(sec / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
const km = (m: number) => (m / 1000).toFixed(m < 10000 ? 1 : 0);

function SurfaceBar({ st }: { st: Stats }) {
  const all = st.surface.reduce((a, b) => a + b, 0) || 1;
  return (
    <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--surface-3)' }} aria-hidden="true">
      {st.surface.map((m, i) => (m > 0 ? <div key={i} style={{ width: `${(m / all) * 100}%`, background: SURF[i].c }} /> : null))}
    </div>
  );
}

export function RoutePlanner({ onPick, onClose }: { onPick: (r: RideRoute) => void; onClose: () => void }) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Record<string, unknown>; } catch { return {}; } })();
  const [profile, setProfile] = useState<Profile>((saved.profile as Profile) ?? 'road');
  const [mode, setMode] = useState<'loop' | 'ab'>((saved.mode as 'loop' | 'ab') ?? 'loop');
  const [loopKm, setLoopKm] = useState<number>(Number(saved.loopKm) || 60);
  const [heading, setHeading] = useState<number | null>(null);
  const [opts, setOpts] = useState({ quiet: true, flow: false, flat: false, green: false, moreUnpaved: true, ...(saved.opts as object ?? {}) });
  const [here, setHere] = useState<LL | null>(null);
  const [start, setStart] = useState<LL | null>(null);
  const [end, setEnd] = useState<LL | null>(null);
  const [vias, setVias] = useState<LL[]>([]);
  const [tapMode, setTapMode] = useState<'start' | 'end' | 'via'>('end');
  const [q, setQ] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [sel, setSel] = useState(0);
  const [seed, setSeed] = useState(0);
  const [pois, setPois] = useState<{ state: 'idle' | 'busy' | 'ok' | 'err'; list: RoutePoi[] }>({ state: 'idle', list: [] });
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try { localStorage.setItem(PREFS, JSON.stringify({ profile, mode, loopKm, opts })); } catch { /* bez pamięci – trudno */ }
  }, [profile, mode, loopKm, opts]);

  // pozycja telefonu jako start (zawodnik może ją zmienić dotknięciem mapy)
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (p) => { const ll = { lat: p.coords.latitude, lon: p.coords.longitude }; setHere(ll); setStart((s0) => s0 ?? ll); },
      () => { /* bez zgody – start z mapy */ }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  }, []);

  const clearResult = () => { setVariants([]); setSel(0); setPois({ state: 'idle', list: [] }); };

  const search = useCallback((text: string) => {
    setQ(text);
    if (qTimer.current) clearTimeout(qTimer.current);
    if (text.trim().length < 3) { setPlaces([]); return; }
    qTimer.current = setTimeout(async () => {
      try {
        const near = here ?? start;
        const r = await fetch(`/api/route/geocode?q=${encodeURIComponent(text.trim())}${near ? `&lat=${near.lat}&lon=${near.lon}` : ''}`);
        const j = (await r.json()) as { places?: Place[] };
        setPlaces(j.places ?? []);
      } catch { setPlaces([]); }
    }, 350);
  }, [here, start]);

  const tap = (p: LL) => {
    clearResult();
    if (tapMode === 'start' || !start) { setStart(p); if (tapMode === 'start') setTapMode(mode === 'ab' ? 'end' : 'start'); return; }
    if (mode === 'loop') { setStart(p); return; }
    if (tapMode === 'via' && end) { setVias((v) => [...v, p].slice(0, 6)); return; }
    setEnd(p);
  };

  const plan = async (nextSeed = seed) => {
    if (!start) { setErr('Ustaw start: zezwól na lokalizację albo dotknij mapy.'); return; }
    if (mode === 'ab' && !end) { setErr('Wybierz cel: wyszukaj miejsce albo dotknij mapy.'); return; }
    setBusy(true); setErr(null); clearResult();
    try {
      const r = await fetch('/api/route/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, start, end, vias, loopKm, heading, seed: nextSeed, profile, opts }),
      });
      const j = (await r.json().catch(() => ({}))) as { routes?: Variant[]; message?: string };
      if (!r.ok || !j.routes?.length) throw new Error(j.message ?? 'Nie udało się wyznaczyć trasy.');
      setVariants(j.routes); setSel(0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Nie udało się wyznaczyć trasy.');
    } finally { setBusy(false); }
  };

  // „Przed tobą” dla wybranego wariantu – w tle (Overpass bywa wolny), dołączane do trasy przed wysłaniem
  const chosen = variants[sel] ?? null;
  useEffect(() => {
    if (!chosen) return;
    let stop = false;
    setPois({ state: 'busy', list: [] });
    fetch('/api/route/pois', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route: chosen.route }) })
      .then((r) => r.json()).then((j: { pois?: RoutePoi[] }) => { if (!stop) setPois({ state: 'ok', list: j.pois ?? [] }); })
      .catch(() => { if (!stop) setPois({ state: 'err', list: [] }); });
    return () => { stop = true; };
  }, [chosen]);

  const pick = () => {
    if (!chosen) return;
    onPick({ ...chosen.route, pois: pois.list.length ? pois.list : undefined });
  };
  const download = () => {
    if (!chosen) return;
    const blob = new Blob([routeToGpx(chosen.route)], { type: 'application/gpx+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${chosen.route.name.replace(/[\\/:*?"<>|]/g, '').trim() || 'trasa'}.gpx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const toggle = (k: keyof typeof opts) => { clearResult(); setOpts((o) => ({ ...o, [k]: !o[k] })); };
  const optRows: { k: keyof typeof opts; label: string; sub: string; show: boolean }[] = [
    { k: 'quiet', label: 'Omijaj ruch', sub: 'mniej dróg krajowych i wojewódzkich', show: true },
    { k: 'flow', label: 'Płynna jazda', sub: 'omija miasta: mniej świateł, skrzyżowań i hamowania', show: true },
    { k: 'flat', label: 'Bez stromizn', sub: 'łagodniejsze podjazdy', show: true },
    { k: 'green', label: 'Lasy i zieleń', sub: 'przyjemniej, mniej spalin', show: profile !== 'mtb' },
    { k: 'moreUnpaved', label: profile === 'mtb' ? 'Więcej singli' : 'Więcej szutru', sub: profile === 'mtb' ? 'ścieżki zamiast dróg leśnych' : 'drogi polne i leśne zamiast asfaltu', show: profile === 'gravel' || profile === 'mtb' },
  ];

  return (
    <div role="dialog" aria-modal="true" aria-label="Planer trasy"
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--bg, #0B0D10)', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <div className={s.stack} style={{ gap: 12, padding: '14px 16px calc(24px + env(safe-area-inset-bottom))', maxWidth: 640, margin: '0 auto' }}>
        <div className={s.row}>
          <span className={s.title} style={{ fontSize: 24 }}>Zaplanuj trasę</span>
          <button type="button" className={s.btnText} style={{ height: 40 }} onClick={onClose}>Zamknij</button>
        </div>

        <div className={s.grid4} role="radiogroup" aria-label="Profil">
          {PROFILES.map((p) => (
            <button key={p.k} type="button" role="radio" aria-checked={profile === p.k} onClick={() => { clearResult(); setProfile(p.k); }}
              className={profile === p.k ? s.segBtnOn : s.segBtn}
              style={{ height: 58, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, border: '1px solid var(--line)', padding: '0 2px' }}>
              <span style={{ fontWeight: 700 }}>{p.label}</span>
              <span style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.1, textAlign: 'center' }}>{p.sub}</span>
            </button>
          ))}
        </div>

        <div className={s.segment}>
          <button type="button" className={mode === 'loop' ? s.segBtnOn : s.segBtn} onClick={() => { clearResult(); setMode('loop'); }}>Pętla</button>
          <button type="button" className={mode === 'ab' ? s.segBtnOn : s.segBtn} onClick={() => { clearResult(); setMode('ab'); setTapMode('end'); }}>Do celu</button>
        </div>

        {mode === 'loop' ? (
          <div className={s.card} style={{ gap: 10, padding: 12 }}>
            <div className={s.row}>
              <span className={s.metricLabel}>Dystans</span>
              <span className={s.statValue}>{loopKm} km</span>
            </div>
            <input type="range" min={10} max={200} step={5} value={loopKm} aria-label="Dystans pętli"
              onChange={(e) => { clearResult(); setLoopKm(Number(e.target.value)); }} style={{ width: '100%', accentColor: 'var(--cyan)' }} />
            <span className={s.metricLabel}>Kierunek</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {DIRS.map((d) => (
                <button key={d.label} type="button" onClick={() => { clearResult(); setHeading(d.deg); }}
                  className={heading === d.deg ? s.segBtnOn : s.segBtn} style={{ height: 34, padding: '0 10px', border: '1px solid var(--line)', fontSize: 13 }}>{d.label}</button>
              ))}
            </div>
            <span className={s.small}>Start: {start ? (here && start.lat === here.lat && start.lon === here.lon ? 'Twoja pozycja' : 'punkt na mapie') : 'dotknij mapy'} – dotknięcie mapy przenosi start.</span>
          </div>
        ) : (
          <div className={s.card} style={{ gap: 8, padding: 12 }}>
            <input type="search" value={q} onChange={(e) => search(e.target.value)} placeholder="Dokąd? (miejscowość, schronisko, kawiarnia…)"
              aria-label="Cel trasy" style={{ height: 46, borderRadius: 10, border: '1px solid var(--line-2)', background: 'var(--surface-2)', color: 'var(--text)', padding: '0 12px', font: '500 15px var(--body)' }} />
            {places.length > 0 && (
              <ul className={s.list} style={{ borderRadius: 12 }}>
                {places.map((p) => (
                  <li key={p.label}>
                    <button type="button" className={s.sensorBtn} style={{ minHeight: 46 }} onClick={() => { clearResult(); setEnd({ lat: p.lat, lon: p.lon }); setPlaces([]); setQ(p.name); }}>
                      <span>{p.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className={s.segment}>
              {(['start', 'end', 'via'] as const).map((t) => (
                <button key={t} type="button" className={tapMode === t ? s.segBtnOn : s.segBtn} style={{ height: 36, fontSize: 13 }} onClick={() => setTapMode(t)}>
                  {t === 'start' ? 'Mapa: start' : t === 'end' ? 'Mapa: cel' : 'Mapa: przez'}
                </button>
              ))}
            </div>
            {vias.length > 0 && (
              <div className={s.row}>
                <span className={s.small}>Punkty pośrednie: {vias.length}</span>
                <button type="button" className={s.btnText} style={{ height: 32, fontSize: 13 }} onClick={() => { clearResult(); setVias([]); }}>Usuń</button>
              </div>
            )}
          </div>
        )}

        <PlannerMap center={here} start={start} end={mode === 'ab' ? end : null} vias={mode === 'ab' ? vias : []}
          routes={variants.map((v) => (v === chosen ? { ...v.route, pois: pois.list } : v.route))} selected={sel} onTap={tap} onSelect={setSel} />

        <section className={s.card} style={{ gap: 0, padding: '4px 14px' }} aria-label="Opcje trasy">
          {optRows.filter((o) => o.show).map((o) => (
            <label key={o.k} className={s.toggleRow} style={{ minHeight: 50 }}>
              <span className={s.stack} style={{ gap: 0 }}>
                <span style={{ fontSize: 15 }}>{o.label}</span>
                <span className={s.small} style={{ fontSize: 12 }}>{o.sub}</span>
              </span>
              <input type="checkbox" className={s.checkbox} checked={!!opts[o.k]} onChange={() => toggle(o.k)} />
            </label>
          ))}
        </section>

        <button type="button" className={s.btnPrimary} onClick={() => void plan()} disabled={busy}>
          {busy ? 'Wyznaczam trasy…' : variants.length ? 'Wyznacz ponownie' : 'Wyznacz trasę'}
        </button>
        {busy && <span className={s.small}>Silnik tras liczy {mode === 'loop' ? 'trzy pętle w różnych kierunkach' : 'warianty'} – długie trasy do ~20 s.</span>}
        {err && <span className={s.small} style={{ color: '#D98A57' }} role="alert">{err}</span>}

        {variants.length > 0 && (
          <div className={s.stack} style={{ gap: 8 }} aria-label="Warianty trasy">
            {variants.map((v, i) => {
              const all = v.stats.surface.reduce((a, b) => a + b, 0) || 1;
              const un = Math.round(((v.stats.surface[1] + v.stats.surface[2]) / all) * 100);
              return (
                <button key={i} type="button" onClick={() => setSel(i)} aria-pressed={i === sel}
                  className={i === sel ? s.cardCyan : s.card} style={{ textAlign: 'left', gap: 8, padding: 12, cursor: 'pointer', color: 'var(--text)' }}>
                  <div className={s.row}>
                    <span className={s.strong}>{v.tag}</span>
                    <span className={s.statValue}>{hm(v.stats.estSec)} h</span>
                  </div>
                  <div className={s.grid4}>
                    <div className={s.stack}><span className={s.metricLabel}>Dystans</span><span className={s.statValue}>{km(v.stats.total)} km</span></div>
                    <div className={s.stack}><span className={s.metricLabel}>W górę</span><span className={s.statValue}>{v.stats.gain} m</span></div>
                    <div className={s.stack}><span className={s.metricLabel}>Szuter/teren</span><span className={s.statValue}>{un}%</span></div>
                    <div className={s.stack}><span className={s.metricLabel}>Główne drogi</span><span className={s.statValue}>{km(v.stats.mainRoad)} km</span></div>
                  </div>
                  <SurfaceBar st={v.stats} />
                  <span className={s.small} style={{ fontSize: 12 }}>{v.route.climbs.length ? `Podjazdy: ${v.route.climbs.length} (najdłuższy ${(Math.max(...v.route.climbs.map((c) => c.end - c.start)) / 1000).toFixed(1)} km)` : 'Bez większych podjazdów'} · skręty: {v.route.cues.length}</span>
                </button>
              );
            })}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {SURF.slice(0, 3).map((x) => <span key={x.l} className={s.small} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 14, height: 4, borderRadius: 2, background: x.c, display: 'inline-block' }} />{x.l}</span>)}
            </div>
            {chosen && (
              <section className={s.card} style={{ gap: 6, padding: 12 }} aria-label="Przed tobą">
                <span className={s.metricLabel}>Przed tobą (na trasie)</span>
                {pois.state === 'busy' && <span className={s.small}>Szukam wody, kawiarni i serwisów przy trasie…</span>}
                {pois.state === 'err' && <span className={s.small}>Nie udało się pobrać punktów – trasa działa bez nich.</span>}
                {pois.state === 'ok' && !pois.list.length && <span className={s.small}>Brak oznaczonych punktów przy trasie.</span>}
                {pois.list.slice(0, 12).map((p, i) => (
                  <span key={i} className={s.small} style={{ color: 'var(--text-2)' }}>{POI_ICON[p.kind] ?? '•'} {km(p.d)} km · {p.name}</span>
                ))}
                {pois.list.length > 12 && <span className={s.small}>…i {pois.list.length - 12} więcej (wszystkie trafią na licznik)</span>}
              </section>
            )}
            <button type="button" className={s.btnPrimary} onClick={pick} disabled={!chosen}>Jedź tą trasą</button>
            <div className={s.grid2}>
              {mode === 'loop'
                ? <button type="button" className={s.btnGhost} onClick={() => { const n = seed + 1; setSeed(n); void plan(n); }} disabled={busy}>Inne pętle</button>
                : <span />}
              <button type="button" className={s.btnGhost} onClick={download} disabled={!chosen}>Pobierz GPX</button>
            </div>
            <span className={s.small} style={{ fontSize: 12 }}>Czas z Twojego FTP i wagi (fizyka: nachylenie, nawierzchnia, opór powietrza). Trasy: BRouter i OpenStreetMap.</span>
          </div>
        )}
      </div>
    </div>
  );
}
