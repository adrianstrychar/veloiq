'use client';

// Mapa trasy (Leaflet + CARTO Dark Matter), jednokolorowa linia z animacją "draw-on"
// (rysowanie od startu do mety ~4 s). WYŁĄCZNIE przez dynamic import z ssr:false (Leaflet
// dotyka window przy imporcie) — stąd default export.
//
// Animacja: stroke-dashoffset (WAAPI). Każdy ciągły przebieg GPS to OSOBNY <Polyline> (osobny
// <path>, jedna podścieżka) — bo iPhone Safari resetuje fazę dash na każdym "M", więc multi-
// subpath w jednym path animowałby wszystkie odcinki równolegle ("kilka kresek naraz"). Odcinki
// animujemy SEKWENCYJNIE po skumulowanej długości pikselowej → jedno pióro o stałej prędkości
// płynie start→meta, przeskakując luki GPS. Koszt/klatkę stały, niezależny od liczby punktów.
import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet';
import { latLngBounds, type Polyline as LPolyline } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { C } from '@/lib/theme';
import type { StreamsJson } from '@/lib/strava/streams';

const MAP_HEIGHT = 280;      // ≥260 px na iPhone Safari (spec PR2)
const DRAW_MS = 4000;        // czas rysowania CAŁEJ trasy (sumarycznie przez wszystkie odcinki)

// Ciągłe przebiegi GPS z pełnej rozdzielczości streams. Luka (lat/lng null — tunel, dropout)
// PRZERYWA linię: każdy ciągły przebieg to osobny odcinek (osobny <Polyline> — patrz nagłówek).
function buildTrack(streams: StreamsJson): [number, number][][] {
  const { lat, lng } = streams.series;
  const lines: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (let i = 0; i < streams.n; i++) {
    const la = lat[i];
    const ln = lng[i];
    if (la == null || ln == null) {
      if (cur.length >= 2) lines.push(cur);
      cur = [];
      continue;
    }
    cur.push([la, ln]);
  }
  if (cur.length >= 2) lines.push(cur);
  return lines;
}

// Steruje sekwencyjną animacją draw-on na <path> narysowanych przez Leaflet. Osadzony w
// MapContainer, żeby mieć instancję mapy (useMap). replayKey++ → re-run (ponowne rysowanie).
function DrawController({ polyRefs, replayKey }: { polyRefs: React.MutableRefObject<(LPolyline | null)[]>; replayKey: number }) {
  const map = useMap();

  useEffect(() => {
    const paths = polyRefs.current
      .map((p) => p?.getElement() as SVGPathElement | null | undefined)
      .filter((el): el is SVGPathElement => !!el);
    if (paths.length === 0) return;

    const clearAll = () => paths.forEach((p) => { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; });

    // Guard 3: reduced-motion → bez animacji, od razu pełna statyczna trasa.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      clearAll();
      return;
    }

    const lens = paths.map((p) => p.getTotalLength());
    const total = lens.reduce((a, b) => a + b, 0);
    if (total === 0) { clearAll(); return; }

    // Sekwencja: odcinek i rysuje się w oknie czasu proporcjonalnym do jego długości, po
    // zakończeniu poprzednich (delay = skumulowana długość / całość). Stała prędkość pióra.
    const anims: Animation[] = [];
    let acc = 0;
    paths.forEach((path, i) => {
      const len = lens[i];
      const delay = (acc / total) * DRAW_MS;
      const duration = Math.max(1, (len / total) * DRAW_MS);
      acc += len;
      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = `${len}`;
      const anim = path.animate(
        [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
        { duration, delay, easing: 'linear', fill: 'both' } // fill:both → odcinek czeka ukryty do swojej kolejki
      );
      // Guard 2: po zakończeniu czyścimy dash danego odcinka (statyczny, odporny na późniejsze zoomy).
      anim.onfinish = () => { path.style.strokeDasharray = ''; path.style.strokeDashoffset = ''; };
      anims.push(anim);
    });

    // Guard 1: zoom/pan przepisuje "d" (Leaflet reprojektuje) → stare dasharray dałyby artefakty.
    // Zoomstart: przerwij wszystkie animacje i pokaż całość.
    const onZoom = () => { anims.forEach((a) => a.cancel()); clearAll(); };
    map.on('zoomstart', onZoom);

    return () => {
      map.off('zoomstart', onZoom);
      anims.forEach((a) => a.cancel());
    };
  }, [map, polyRefs, replayKey]);

  return null;
}

export default function RideMap({ streams }: { streams: StreamsJson }) {
  const lines = buildTrack(streams);
  const polyRefs = useRef<(LPolyline | null)[]>([]);
  const [replayKey, setReplayKey] = useState(0);

  if (lines.length === 0) return null; // parent sprawdza hasGps; pas bezpieczeństwa

  const bounds = latLngBounds(lines.flat());

  return (
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: `1px solid ${C.border}` }}>
      <MapContainer
        bounds={bounds}                 /* kamera ustawiona PRZED animacją — brak skoku */
        boundsOptions={{ padding: [24, 24] }}
        style={{ height: MAP_HEIGHT, width: '100%', background: C.card }}
        attributionControl={true}
        scrollWheelZoom={false}          /* scroll strony na mobile nie porywa zoomu mapy */
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd"
          maxZoom={19}
        />
        {lines.map((run, i) => (
          <Polyline
            key={i}
            ref={(el) => { polyRefs.current[i] = el; }}
            positions={run}
            pathOptions={{ color: C.cyan, weight: 3, opacity: 0.95, lineJoin: 'round', lineCap: 'round' }}
          />
        ))}
        <DrawController polyRefs={polyRefs} replayKey={replayKey} />
      </MapContainer>

      {/* Replay — restart animacji bez zamykania karty (bump replayKey → DrawController re-run). */}
      <button
        onClick={() => setReplayKey((k) => k + 1)}
        aria-label="Odtwórz trasę ponownie"
        style={{
          position: 'absolute', right: 10, bottom: 10, zIndex: 500,
          width: 36, height: 36, borderRadius: 18, cursor: 'pointer',
          background: C.card + 'E6', border: `1px solid ${C.border}`, color: C.cyan,
          fontSize: 17, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ↻
      </button>
    </div>
  );
}
