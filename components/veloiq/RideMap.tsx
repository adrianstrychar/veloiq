'use client';

// Mapa trasy (Leaflet + CARTO Dark Matter), kolorowana strefami mocy. WYŁĄCZNIE przez
// dynamic import z ssr:false (Leaflet dotyka window przy imporcie) — stąd default export.
import { MapContainer, TileLayer, Polyline } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { C } from '@/lib/theme';
import { buildRouteSegments } from '@/lib/streams-view';
import type { StreamsJson } from '@/lib/strava/streams';

const MAP_HEIGHT = 280; // ≥260 px na iPhone Safari (spec PR2)

export default function RideMap({ streams, ftp }: { streams: StreamsJson; ftp: number | null }) {
  const segments = buildRouteSegments(streams, ftp);
  if (segments.length === 0) return null; // parent sprawdza hasGps, to tylko pas bezpieczeństwa

  const bounds = latLngBounds(segments.flatMap((s) => s.points));

  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', border: `1px solid ${C.border}` }}>
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [24, 24] }}
        style={{ height: MAP_HEIGHT, width: '100%', background: C.card }}
        attributionControl={true}
        scrollWheelZoom={false} /* scroll strony na mobile nie może porywać zoomu mapy */
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd"
          maxZoom={19}
        />
        {segments.map((seg, i) => (
          <Polyline
            key={i}
            positions={seg.points}
            pathOptions={{ color: seg.color, weight: 3, opacity: 0.9, lineJoin: 'round', lineCap: 'round' }}
          />
        ))}
      </MapContainer>
    </div>
  );
}
