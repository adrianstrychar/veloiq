'use client';
// Mapa planera tras (Leaflet; podkład ciemny / rowerowy CyclOSM / terenowy – components/map/BaseTiles). Tylko przez dynamic import z ssr:false – Leaflet dotyka window.
// Dotknięcie mapy ustawia start / cel / punkt pośredni (decyduje rodzic). Warianty: wybrany kolorowany nawierzchnią
// (asfalt, szuter, teren), pozostałe szare – dotknięcie wybiera wariant.
import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { RideRoute } from '@/lib/ride/gpx';
import BaseTiles, { MAP_STYLES, type MapStyle } from '@/components/map/BaseTiles';

const STYLE_KEY = 'veloiq.map.style';
function savedStyle(): MapStyle {
  try { const v = localStorage.getItem(STYLE_KEY); return v === 'bike' || v === 'topo' ? v : 'dark'; } catch { return 'dark'; }
}

export const SURFACE_COLOR = ['#4A8FC7', '#D9A557', '#5B9B7E', '#8A8F98'];
const POI_COLOR: Record<string, string> = { water: '#4AC7E0', cafe: '#D98A57', bike: '#EDEFF2', toilets: '#9B8AC7', shop: '#C7C24A', fuel: '#C75B5B', food: '#D98A57' };

type LL = { lat: number; lon: number };

function Clicks({ onClick }: { onClick: (p: LL) => void }) {
  useMapEvents({ click: (e) => onClick({ lat: e.latlng.lat, lon: e.latlng.lng }) });
  return null;
}

function Fit({ pts, k }: { pts: [number, number][]; k: string }) {
  const map = useMap();
  useEffect(() => {
    if (pts.length < 2) return;
    map.fitBounds(latLngBounds(pts.map(([a, b]) => [a, b] as [number, number])), { padding: [28, 28], maxZoom: 15 });
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Recenter({ c }: { c: LL | null }) {
  const map = useMap();
  useEffect(() => { if (c) map.setView([c.lat, c.lon], Math.max(map.getZoom(), 12)); }, [c?.lat, c?.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Ślad wybranej trasy pocięty na odcinki o tej samej nawierzchni. */
function surfaceLines(r: RideRoute): { color: string; pts: [number, number][] }[] {
  const runs = r.surface?.length ? r.surface : [[0, 0] as [number, number]];
  const out: { color: string; pts: [number, number][] }[] = [];
  let ri = 0;
  for (const p of r.pts) {
    while (ri + 1 < runs.length && runs[ri + 1][0] <= p[3]) ri++;
    const color = SURFACE_COLOR[runs[ri][1]] ?? SURFACE_COLOR[3];
    const cur = out[out.length - 1];
    if (!cur || cur.color !== color) {
      const last = cur ? cur.pts[cur.pts.length - 1] : undefined;
      out.push({ color, pts: last ? [last, [p[0], p[1]]] : [[p[0], p[1]]] });
    } else cur.pts.push([p[0], p[1]]);
  }
  return out;
}

export default function PlannerMap({ center, start, end, vias, routes, selected, onTap, onSelect, height = 300 }: {
  center: LL | null; start: LL | null; end: LL | null; vias: LL[];
  routes: RideRoute[]; selected: number; onTap: (p: LL) => void; onSelect: (i: number) => void; height?: number;
}) {
  const sel = routes[selected] ?? null;
  const lines = useMemo(() => (sel ? surfaceLines(sel) : []), [sel]);
  const fitPts = useMemo(() => {
    const all: [number, number][] = [];
    for (const r of routes) for (let i = 0; i < r.pts.length; i += 20) all.push([r.pts[i][0], r.pts[i][1]]);
    return all;
  }, [routes]);
  const fitKey = routes.map((r) => `${r.total}:${r.pts.length}`).join('|');
  const c = center ?? start ?? { lat: 50.7753, lon: 15.755 };
  const poiPt = (d: number) => { const p = sel?.pts.find((x) => x[3] >= d); return p ? [p[0], p[1]] as [number, number] : null; };
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark');
  useEffect(() => { setMapStyle(savedStyle()); }, []);
  const pickStyle = (v: MapStyle) => { setMapStyle(v); try { localStorage.setItem(STYLE_KEY, v); } catch { /* prywatny tryb */ } };
  return (
    <div style={{ position: 'relative', height, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}>
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 500, display: 'flex', gap: 4, background: 'rgba(14,16,19,0.85)', padding: 3, borderRadius: 10, border: '1px solid var(--line)' }}>
        {MAP_STYLES.map((m) => (
          <button key={m.id} type="button" onClick={() => pickStyle(m.id)}
            style={{ border: 'none', borderRadius: 8, padding: '5px 9px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: mapStyle === m.id ? '#EDEFF2' : 'transparent', color: mapStyle === m.id ? '#0E1013' : '#B8BDC6' }}>
            {m.label}
          </button>
        ))}
      </div>
      <MapContainer center={[c.lat, c.lon]} zoom={12} style={{ height: '100%', width: '100%', background: '#0E1013' }} zoomControl={false} attributionControl>
        <BaseTiles style={mapStyle} />
        <Clicks onClick={onTap} />
        <Recenter c={routes.length ? null : center} />
        {routes.length > 0 && <Fit pts={fitPts} k={fitKey} />}
        {routes.map((r, i) => i === selected ? null : (
          <Polyline key={`alt${i}`} positions={r.pts.filter((_, j) => j % 2 === 0).map((p) => [p[0], p[1]] as [number, number])}
            pathOptions={{ color: '#5A616C', weight: 5, opacity: 0.75 }} eventHandlers={{ click: () => onSelect(i) }} />
        ))}
        {lines.map((l, i) => <Polyline key={`s${i}`} positions={l.pts} pathOptions={{ color: l.color, weight: 5, opacity: 0.95 }} />)}
        {sel?.pois?.map((p, i) => {
          const at = poiPt(p.d);
          return at ? (
            <CircleMarker key={`p${i}`} center={at} radius={5} pathOptions={{ color: '#0E1013', weight: 2, fillColor: POI_COLOR[p.kind] ?? '#EDEFF2', fillOpacity: 1 }}>
              <Tooltip>{p.name}</Tooltip>
            </CircleMarker>
          ) : null;
        })}
        {vias.map((v, i) => <CircleMarker key={`v${i}`} center={[v.lat, v.lon]} radius={6} pathOptions={{ color: '#0E1013', weight: 2, fillColor: '#4AC7E0', fillOpacity: 1 }} />)}
        {end && <CircleMarker center={[end.lat, end.lon]} radius={8} pathOptions={{ color: '#0E1013', weight: 2, fillColor: '#D98A57', fillOpacity: 1 }} />}
        {start && <CircleMarker center={[start.lat, start.lon]} radius={8} pathOptions={{ color: '#0E1013', weight: 2, fillColor: '#5B9B7E', fillOpacity: 1 }} />}
      </MapContainer>
    </div>
  );
}
