'use client';
// Podkład mapy dla Leaflet. CARTO od 2026 bez klucza zwraca kafelki ze znakiem „API KEY REQUIRED”, więc:
//   ciemna   – CARTO Dark Matter z kluczem z NEXT_PUBLIC_CARTO_KEY; bez klucza mapa OpenStreetMap przyciemniona filtrem CSS
//   rowerowa – CyclOSM: drogi rowerowe, nawierzchnie, szlaki MTB (OSM France, bez klucza)
//   teren    – OpenTopoMap: poziomice i cieniowanie (bez klucza)
import { TileLayer } from 'react-leaflet';

export type MapStyle = 'dark' | 'bike' | 'topo';
export const MAP_STYLES: { id: MapStyle; label: string }[] = [
  { id: 'dark', label: 'Ciemna' },
  { id: 'bike', label: 'Rowerowa' },
  { id: 'topo', label: 'Teren' },
];

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_KEY;

export default function BaseTiles({ style = 'dark' }: { style?: MapStyle }) {
  if (style === 'bike') {
    return (
      <TileLayer key="bike" url="https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png" subdomains="abc" maxZoom={19}
        attribution={`${OSM} &copy; <a href="https://www.cyclosm.org">CyclOSM</a>`} />
    );
  }
  if (style === 'topo') {
    return (
      <TileLayer key="topo" url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png" subdomains="abc" maxZoom={17}
        attribution={`${OSM} &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`} />
    );
  }
  if (CARTO_KEY) {
    return (
      <TileLayer key="carto" url={`https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${encodeURIComponent(CARTO_KEY)}`} maxZoom={19}
        attribution={`${OSM} &copy; <a href="https://carto.com/attributions">CARTO</a>`} />
    );
  }
  // jasna mapa OSM odwrócona do ciemnej (kolory wracają dzięki hue-rotate) – patrz .map-dark w globals.css
  return <TileLayer key="osm-dark" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} className="map-dark" attribution={OSM} />;
}
