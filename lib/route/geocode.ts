// Wyszukiwanie miejsc do planera tras (Photon / komoot – geokoder na danych OSM, bez klucza).
// Wyniki bliżej zawodnika wyżej (lat/lon jako podpowiedź), etykieta po polsku: nazwa · miejscowość · region.
export const PHOTON_URL = () => process.env.PHOTON_URL || 'https://photon.komoot.io/api';
/** Publiczny Photon (komoot) prosi o opisowy User-Agent. */
export const PHOTON_HEADERS: Record<string, string> = { 'User-Agent': 'VeloIQ/1.0 (planer tras rowerowych; +https://veloiq-three.vercel.app)', Referer: 'https://veloiq-three.vercel.app/' };

export interface Place { name: string; label: string; lat: number; lon: number; place?: boolean }

export function photonUrl(q: string, near?: { lat: number; lon: number } | null, limit = 6, placesOnly = false): string {
  // „pl” Photon już nie przyjmuje (400: wspiera default/de/en/fr); „default” = nazwy lokalne z OSM, w Polsce po polsku
  const p = new URLSearchParams({ q, limit: String(limit), lang: 'default' });
  if (near) { p.set('lat', near.lat.toFixed(4)); p.set('lon', near.lon.toFixed(4)); }
  if (placesOnly) p.set('osm_tag', 'place');     // tylko miejscowości, wsie, osiedla, przysiółki
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
    out.push({ name, label, lat: c[1], lon: c[0], ...(p.osm_key === 'place' ? { place: true } : {}) });
  }
  return out;
}

const kmBetween = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((a.lat - b.lat) * 111.2, (a.lon - b.lon) * 111.2 * Math.cos((a.lat * Math.PI) / 180));

/** Cel z polecenia głosowego („prowadź do Szklarskiej Poręby”): najpierw miejscowość o tej nazwie w zasięgu jazdy
 *  (do 80 km), dopiero potem dowolny obiekt – inaczej dopełniacz trafia w „Obelisk … Szklarskiej Poręby”. */
export function pickPlace(placesOnly: Place[], any: Place[], near: { lat: number; lon: number }, maxKm = 80): Place | null {
  return placesOnly.find((p) => kmBetween(p, near) <= maxKm) ?? any.find((p) => kmBetween(p, near) <= maxKm) ?? null;
}

export async function findPlace(q: string, near: { lat: number; lon: number }, fetcher: typeof fetch = fetch): Promise<Place | null> {
  const get = async (placesOnly: boolean) => {
    const r = await fetcher(photonUrl(q, near, 5, placesOnly), { headers: PHOTON_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`photon ${r.status}`);
    return placesFromPhoton(await r.json());
  };
  const [a, b] = await Promise.all([get(true).catch(() => [] as Place[]), get(false)]);
  return pickPlace(a, b, near);
}
