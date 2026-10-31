'use client';
// Trasa GPX do nawigacji Enzo: wgranie pliku, podgląd (mapa + profil), zapamiętanie na kolejne jazdy.
import { useRef, useState } from 'react';
import s from './ride.module.css';
import { routeFromGpx, type RideRoute } from '@/lib/ride/gpx';

const KEY = 'veloiq.route.v1';

export function loadSavedRoute(): RideRoute | null {
  try { const r = localStorage.getItem(KEY); return r ? (JSON.parse(r) as RideRoute) : null; } catch { return null; }
}
function saveRoute(r: RideRoute | null) {
  try { if (r) localStorage.setItem(KEY, JSON.stringify(r)); else localStorage.removeItem(KEY); } catch { /* pełna pamięć – trasa i tak działa w tej jeździe */ }
}

/** Mini-mapa trasy (SVG) z opcjonalną pozycją zawodnika. */
export function RouteMap({ route, pos, done, height = 140 }: { route: RideRoute; pos?: { lat: number; lon: number } | null; done?: number; height?: number }) {
  const pts = route.pts;
  let minLa = Infinity, maxLa = -Infinity, minLo = Infinity, maxLo = -Infinity;
  for (const p of pts) { minLa = Math.min(minLa, p[0]); maxLa = Math.max(maxLa, p[0]); minLo = Math.min(minLo, p[1]); maxLo = Math.max(maxLo, p[1]); }
  const k = Math.cos(((minLa + maxLa) / 2) * Math.PI / 180);
  const w = Math.max(1e-6, (maxLo - minLo) * k), h = Math.max(1e-6, maxLa - minLa);
  const W = 300, H = height, pad = 8;
  const sc = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h);
  const ox = (W - w * sc) / 2, oy = (H - h * sc) / 2;
  const xy = (la: number, lo: number) => [ox + (lo - minLo) * k * sc, H - (oy + (la - minLa) * sc)];
  const step = Math.max(1, Math.floor(pts.length / 600));
  const path = (arr: typeof pts) => arr.filter((_, i) => i % step === 0 || i === arr.length - 1)
    .map((p, i) => { const [x, y] = xy(p[0], p[1]); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('');
  const doneIdx = done != null ? pts.findIndex((p) => p[3] >= done) : -1;
  const me = pos ? xy(pos.lat, pos.lon) : null;
  const [sx, sy] = xy(pts[0][0], pts[0][1]);
  const [ex, ey] = xy(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`Mapa trasy ${route.name}`} style={{ display: 'block' }}>
      <path d={path(pts)} fill="none" stroke="#3A404A" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      {doneIdx > 0 && <path d={path(pts.slice(0, doneIdx + 1))} fill="none" stroke="#4A8FC7" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />}
      <circle cx={sx} cy={sy} r={4} fill="#5B9B7E" />
      <circle cx={ex} cy={ey} r={4} fill="#D98A57" />
      {me && <circle cx={me[0]} cy={me[1]} r={6} fill="#EDEFF2" stroke="#4A8FC7" strokeWidth={3} />}
    </svg>
  );
}

/** Profil wysokości (mały). */
function RouteProfile({ route }: { route: RideRoute }) {
  const e = route.pts.map((p) => p[2]).filter((x): x is number => x != null);
  if (e.length < 10) return null;
  const mn = Math.min(...e), mx = Math.max(...e), W = 300, H = 40;
  const step = Math.max(1, Math.floor(route.pts.length / 300));
  const d = route.pts.filter((_, i) => i % step === 0).map((p, i) => {
    const x = (p[3] / route.total) * W, y = H - (((p[2] ?? mn) - mn) / Math.max(1, mx - mn)) * (H - 4) - 2;
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-hidden="true" style={{ display: 'block' }}>
      <path d={`${d}L${W},${H}L0,${H}Z`} fill="rgba(74,143,199,0.18)" stroke="#4A8FC7" strokeWidth={1.5} />
    </svg>
  );
}

export function RouteCard({ route, onRoute }: { route: RideRoute | null; onRoute: (r: RideRoute | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true); setErr(null);
    try {
      const r = routeFromGpx(await f.text());
      if (r.total < 500) throw new Error('Trasa jest krótsza niż 500 m.');
      saveRoute(r); onRoute(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Nie udało się wczytać pliku.');
    } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }

  return (
    <section className={s.card} aria-label="Trasa GPX">
      <div className={s.row}>
        <span className={s.strong}>Nawigacja po trasie</span>
        {route && <button type="button" className={s.btnText} onClick={() => { saveRoute(null); onRoute(null); }}>Usuń</button>}
      </div>
      {route ? (
        <>
          <span className={s.small} style={{ color: 'var(--text-2)' }}>{route.name}</span>
          <RouteMap route={route} />
          <RouteProfile route={route} />
          <div className={s.grid4}>
            <div className={s.stack}><span className={s.metricLabel}>Dystans</span><span className={s.statValue}>{(route.total / 1000).toFixed(1)} km</span></div>
            <div className={s.stack}><span className={s.metricLabel}>W górę</span><span className={s.statValue}>{route.gain} m</span></div>
            <div className={s.stack}><span className={s.metricLabel}>Skręty</span><span className={s.statValue}>{route.cues.length}</span></div>
            <div className={s.stack}><span className={s.metricLabel}>Podjazdy</span><span className={s.statValue}>{route.climbs.length}</span></div>
          </div>
          <span className={s.small}>Enzo zapowie skręty, podjazdy i kilometry do mety. Działa offline, z GPS telefonu.</span>
        </>
      ) : (
        <span className={s.small}>Wgraj plik GPX (Komoot, Strava, RideWithGPS, Garmin) – Enzo poprowadzi Cię po trasie głosem.</span>
      )}
      <input ref={input} type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <button type="button" className={s.btnGhost} onClick={() => input.current?.click()} disabled={busy}>
        {busy ? 'Wczytuję…' : route ? 'Zmień trasę (GPX)' : 'Wgraj trasę (GPX)'}
      </button>
      {err && <span className={s.small} style={{ color: '#D98A57' }} role="alert">{err}</span>}
    </section>
  );
}

const ARROW: Record<string, string> = { left: '↰', right: '↱', slightLeft: '↖', slightRight: '↗', sharpLeft: '⤺', sharpRight: '⤻', uturn: '⮌' };
const DIR_PL: Record<string, string> = { left: 'w lewo', right: 'w prawo', slightLeft: 'lekko w lewo', slightRight: 'lekko w prawo', sharpLeft: 'ostro w lewo', sharpRight: 'ostro w prawo', uturn: 'zawróć' };

export interface NavState {
  name: string; total: number; progress: number; left: number; acquired: boolean; offRoute: boolean;
  enabled?: boolean;   // false = wyłączona w trakcie jazdy
  muted?: boolean;     // długo poza trasą – Enzo milczy do powrotu
  nextTurn?: { dir: string; in: number };
  nextClimb?: { in: number; len: number; grade: number; gain: number; onIt: boolean };
}

/** Karta nawigacji na ekranie jazdy. */
export function NavCard({ nav, route, pos, onToggle }: {
  nav: NavState | null; route: RideRoute; pos?: { lat: number; lon: number } | null; onToggle?: (on: boolean) => void;
}) {
  const m = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)} km` : `${Math.round(x / 10) * 10} m`);
  if (nav?.enabled === false) {
    return (
      <section className={s.card} aria-label="Nawigacja" style={{ padding: '6px 12px' }}>
        <div className={s.row} style={{ alignItems: 'center' }}>
          <span className={s.small}>Nawigacja wyłączona</span>
          {onToggle && <button type="button" className={s.btnText} style={{ height: 40, fontSize: 14, color: 'var(--cyan)' }} onClick={() => onToggle(true)}>Włącz</button>}
        </div>
      </section>
    );
  }
  return (
    <section className={nav?.offRoute ? s.cardAmber : s.card} aria-label="Nawigacja" style={{ padding: '10px 12px', gap: 8 }}>
      {!nav?.acquired ? (
        <span className={s.strong}>Jedź do startu trasy „{route.name}”</span>
      ) : nav.offRoute ? (
        <span className={s.strong}>{nav.muted ? 'Poza trasą – nawigacja wyciszona do powrotu' : 'Zjechałeś z trasy – wróć na niebieską linię'}</span>
      ) : (
        <div className={s.row} style={{ alignItems: 'center' }}>
          {nav.nextTurn && nav.nextTurn.in < 2000 ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 34, lineHeight: 1, color: 'var(--cyan)' }} aria-hidden="true">{ARROW[nav.nextTurn.dir] ?? '↑'}</span>
              <span className={s.stack}>
                <span className={s.statValue}>{m(nav.nextTurn.in)}</span>
                <span className={s.small}>{DIR_PL[nav.nextTurn.dir] ?? 'skręt'}</span>
              </span>
            </span>
          ) : <span className={s.strong}>Prosto</span>}
          <span className={s.stack} style={{ textAlign: 'right' }}>
            <span className={s.statValue}>{(nav.left / 1000).toFixed(1)} km</span>
            <span className={s.small}>do mety</span>
          </span>
        </div>
      )}
      {nav?.nextClimb && nav.nextClimb.in < 5000 && (
        <span className={s.small}>
          {nav.nextClimb.onIt ? 'Na podjeździe' : `Podjazd za ${m(nav.nextClimb.in)}`}: {(nav.nextClimb.len / 1000).toFixed(1)} km · {nav.nextClimb.grade}% · +{nav.nextClimb.gain} m
        </span>
      )}
      <RouteMap route={route} pos={pos} done={nav?.progress} height={110} />
      {onToggle && (
        <button type="button" className={s.btnText} style={{ height: 34, fontSize: 13, alignSelf: 'flex-end' }} onClick={() => onToggle(false)}>
          Wyłącz nawigację
        </button>
      )}
    </section>
  );
}
