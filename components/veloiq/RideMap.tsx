'use client';

// Mapa trasy (Leaflet + CARTO Dark Matter), jednokolorowa linia z animacją "draw-on"
// (rysowanie od startu do mety ~4 s). WYŁĄCZNIE przez dynamic import z ssr:false (Leaflet
// dotyka window przy imporcie) — stąd default export.
//
// Animacja: stroke-dashoffset (WAAPI) na ścieżce SVG Leafleta, NIE progresywne dodawanie
// punktów. Ścieżka budowana raz w pełnej rozdzielczości; animowana jest jedna właściwość CSS
// → koszt/klatkę stały, niezależny od liczby punktów (2000+ pkt płynne na iPhone Safari).
import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet';
import { latLngBounds, type Polyline as LPolyline } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { C } from '@/lib/theme';
import type { StreamsJson } from '@/lib/strava/streams';

const MAP_HEIGHT = 280;      // ≥260 px na iPhone Safari (spec PR2)
const DRAW_MS = 4000;        // czas rysowania trasy

// Ciągłe przebiegi GPS z pełnej rozdzielczości streams. Luka (lat/lng null — tunel, dropout)
// PRZERYWA linię: każdy ciągły przebieg to osobna podścieżka, ale wszystkie w JEDNYM <Polyline>
// (Leaflet renderuje je jako jeden <path> z wieloma "M ... L ..." → dashoffset działa na całości).
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

// Steruje animacją draw-on na <path> narysowanym przez Leaflet. Osadzony w MapContainer,
// żeby mieć dostęp do instancji mapy (useMap) i do warstwy polyline (ref). replayKey++ → re-run.
function DrawController({ polylineRef, replayKey }: { polylineRef: React.RefObject<LPolyline>; replayKey: number }) {
  const map = useMap();

  useEffect(() => {
    const path = polylineRef.current?.getElement() as SVGPathElement | null | undefined;
    if (!path) return;

    const clearDash = () => {
      path.style.strokeDasharray = '';
      path.style.strokeDashoffset = '';
    };

    // Guard 3: reduced-motion → bez animacji, od razu pełna statyczna trasa.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      clearDash();
      return;
    }

    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = `${len}`;
    const anim = path.animate(
      [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
      { duration: DRAW_MS, easing: 'ease-in-out', fill: 'forwards' }
    );
    // Guard 2: po zakończeniu czyścimy dash-style (trasa statyczna, odporna na późniejsze zoomy).
    anim.onfinish = clearDash;

    // Guard 1: zoom/pan przepisuje atrybut "d" (Leaflet reprojektuje) → stary dasharray zostawiłby
    // artefakt kresek. Zoomstart: przerwij animację i pokaż całość.
    const onZoom = () => { anim.cancel(); clearDash(); };
    map.on('zoomstart', onZoom);

    return () => {
      map.off('zoomstart', onZoom);
      anim.cancel();
    };
  }, [map, polylineRef, replayKey]);

  return null;
}

export default function RideMap({ streams }: { streams: StreamsJson }) {
  const lines = buildTrack(streams);
  const polylineRef = useRef<LPolyline>(null);
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
        <Polyline
          ref={polylineRef}
          positions={lines}
          pathOptions={{ color: C.cyan, weight: 3, opacity: 0.95, lineJoin: 'round', lineCap: 'round' }}
        />
        <DrawController polylineRef={polylineRef} replayKey={replayKey} />
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
