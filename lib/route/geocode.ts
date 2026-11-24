// Wyszukiwanie miejsc do planera tras (Photon / komoot – geokoder na danych OSM, bez klucza).
// Wyniki bliżej zawodnika wyżej (lat/lon jako podpowiedź), etykieta po polsku: nazwa · miejscowość · region.
export const PHOTON_URL = () => process.env.PHOTON_URL || 'https://photon.komoot.io/api';

export interface Place { name: string; label: string; lat: number; lon: number }

export function photonUrl(q: string, near?: { lat: number; lon: number } | null, limit = 6): string {
  const p = new URLSearchParams({ q, limit: String(limit), lang: 'pl' });
  if (near) { p.set('lat', near.lat.toFixed(4)); p.set('lon', near.lon.toFixed(4)); }
  return `${PHOTON_URL()}?${p.toString()}`;
}

export function placesFromPhoton(j: unknown): Place[] {
  const feats = (j as { features?: { geometry?: { coordinates?: number[] }; properties?: Record<string, string> }[] })?.features ?? [];
  const out: Place[] = [];
  for (const f of feats) {
    const c = f.geometry?.coordinates;
    const p = f.properties ?? {};
    if (!c || c.length < 2) continue;
    const name = p.name || p.street || p.city || 'Miejsce';
    const where = [p.city && p.city !== name ? p.city : null, p.county ?? p.state, p.country && p.country !== 'Polska' ? p.country : null].filter(Boolean);
    const label = [name, ...where].join(' · ');
    if (out.some((x) => x.label === label)) continue;
    out.push({ name, label, lat: c[1], lon: c[0] });
  }
  return out;
}
