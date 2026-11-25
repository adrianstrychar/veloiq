// Nawierzchnia i typ drogi z tagów OSM (WayTags z BRouter, np. "highway=track surface=gravel tracktype=grade2").
// Trzy klasy, które rowerzysta rozumie od razu: asfalt · szuter (utwardzona, da się jechać szosą z trudem,
// gravelem szybko) · teren (ścieżka, grunt, korzenie – MTB). Bez tagu nawierzchni zgadujemy z typu drogi.
import type { SurfaceCode } from '@/lib/ride/gpx';

export const SURFACE_LABEL = ['asfalt', 'szuter', 'teren', 'nieznana'] as const;

export function parseTags(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of s.trim().split(/\s+/)) {
    const i = kv.indexOf('=');
    if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return out;
}

const PAVED = new Set(['asphalt', 'paved', 'concrete', 'concrete:plates', 'concrete:lanes', 'paving_stones', 'chipseal', 'metal', 'wood']);
const GRAVEL = new Set(['gravel', 'fine_gravel', 'compacted', 'unpaved', 'pebblestone', 'sett', 'cobblestone', 'unhewn_cobblestone', 'grass_paver']);
const TRAIL = new Set(['ground', 'dirt', 'earth', 'grass', 'mud', 'sand', 'rock', 'roots', 'woodchips', 'clay', 'stone']);
const ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
  'primary_link', 'secondary_link', 'tertiary_link', 'trunk_link', 'road']);

/** Kod nawierzchni dla odcinka. */
export function surfaceOf(t: Record<string, string>): SurfaceCode {
  const sf = t.surface;
  if (sf) {
    if (PAVED.has(sf)) return 0;
    if (GRAVEL.has(sf)) return 1;
    if (TRAIL.has(sf)) return 2;
  }
  const hw = t.highway ?? '';
  if (hw === 'track') {
    const g = t.tracktype;
    if (g === 'grade1') return sf ? 1 : 0;           // grade1 bez tagu to zwykle beton / asfalt polny
    if (g === 'grade2' || g === 'grade3') return 1;
    if (g === 'grade4' || g === 'grade5') return 2;
    return 1;
  }
  if (hw === 'path' || hw === 'bridleway' || hw === 'footway') return t.bicycle === 'designated' && !sf ? 0 : 2;
  if (hw === 'cycleway') return 0;
  if (ROADS.has(hw)) return 0;
  return 3;
}

/** Droga z ruchem samochodowym (główna) – do ostrzeżeń „X km po drogach z ruchem”. */
export function isMainRoad(t: Record<string, string>): boolean {
  return /^(trunk|primary|secondary)(_link)?$/.test(t.highway ?? '');
}
