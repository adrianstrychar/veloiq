// Parser GPX — hand-rolled, ZERO zależności (@xmldom nie ma w drzewie; struktura GPX 1.1
// topografix jest płaska i regularna, regex wystarcza — zweryfikowane na 5 realnych plikach).
// Wyciąga trackpointy lat/lon/ele + dystans skumulowany (haversine). Fallback <trkpt> → <rtept>.
// Parse-and-discard: surowy XML nigdzie nie trafia poza tę funkcję.

export interface TrackPoint {
  lat: number;
  lon: number;
  ele: number;   // m n.p.m. (po fill braków)
  distM: number; // dystans skumulowany od startu, w metrach
}

export type GpxErrorCode = 'not_gpx' | 'empty' | 'no_elevation';

// Typed error — route handler mapuje code → czytelny komunikat + status (nie crash).
export class GpxError extends Error {
  code: GpxErrorCode;
  constructor(code: GpxErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'GpxError';
  }
}

const R = 6371000; // promień Ziemi [m]
function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const attr = (frag: string, name: string): number | null => {
  const m = frag.match(new RegExp(`${name}\\s*=\\s*"([\\d.\\-]+)"`, 'i'));
  return m ? Number(m[1]) : null;
};

// Nazwa trasy z <name> (pierwsze wystąpienie w metadata/trk) — do UI, opcjonalna.
export function gpxName(xml: string): string | null {
  const m = xml.match(/<name>\s*([^<]+?)\s*<\/name>/i);
  return m ? m[1].trim().slice(0, 120) : null;
}

export function parseGpx(xml: string): TrackPoint[] {
  if (!xml || !/<gpx[\s>]/i.test(xml)) {
    throw new GpxError('not_gpx', 'To nie wygląda na plik GPX.');
  }

  // Trasa planowana bywa <rtept>, nagranie/kurs <trkpt> — bierzemy to, czego jest więcej.
  const tag = (xml.match(/<trkpt\b/gi)?.length ?? 0) >= (xml.match(/<rtept\b/gi)?.length ?? 0) ? 'trkpt' : 'rtept';
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, 'gi');

  const raw: { lat: number; lon: number; ele: number | null }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const lat = attr(m[1], 'lat');
    const lon = attr(m[1], 'lon');
    if (lat == null || lon == null) continue;
    const eleM = m[2].match(/<ele>\s*([\d.\-]+)\s*<\/ele>/i);
    raw.push({ lat, lon, ele: eleM ? Number(eleM[1]) : null });
  }

  if (raw.length === 0) {
    throw new GpxError('empty', 'GPX nie zawiera punktów trasy.');
  }
  if (!raw.some((p) => p.ele != null)) {
    throw new GpxError('no_elevation', 'GPX bez danych wysokości — Etap 2 wymaga profilu (elewacji).');
  }

  // Fill pojedynczych braków ele: przenieś ostatnią znaną (a początkowe — pierwszą znaną w przód).
  const firstEle = raw.find((p) => p.ele != null)!.ele!;
  let last = firstEle;
  const pts: TrackPoint[] = [];
  let dist = 0;
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    const ele = p.ele != null ? p.ele : last;
    last = ele;
    if (i > 0) dist += haversine(raw[i - 1].lat, raw[i - 1].lon, p.lat, p.lon);
    pts.push({ lat: p.lat, lon: p.lon, ele, distM: dist });
  }
  return pts;
}
