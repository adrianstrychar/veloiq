// Zapis jazdy z VeloIQ (1 Hz) → plik TCX dla Stravy: czas, pozycja GPS, dystans, tętno, kadencja, moc.
// Sekundy zapisu to czas JAZDY (postoje/auto-pauza wycięte), więc znaczniki czasu idą od startu bez przerw.
import type { SavedSample } from './save-ride';

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));

function haversine(a: SavedSample, b: SavedSample) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat! - a.lat!) * r, dLon = (b.lon! - a.lon!) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat! * r) * Math.cos(b.lat! * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function buildTcx(o: { startedAt: string; samples: SavedSample[]; name: string; kJ?: number | null }): string {
  const t0 = new Date(o.startedAt).getTime();
  const iso = (s: number) => new Date(t0 + s * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const n = o.samples.length;
  const hrs = o.samples.map((x) => x.hr ?? 0).filter((h) => h > 0);
  let dist = 0, prev: SavedSample | null = null;
  const pts: string[] = [];
  for (const x of o.samples) {
    if (x.lat != null && x.lon != null) {
      if (prev) { const d = haversine(prev, x); if (d < 60) dist += d; }   // skoki GPS > 60 m/s pomijamy
      prev = x;
    }
    pts.push(
      `<Trackpoint><Time>${iso(x.s)}</Time>` +
      (x.lat != null && x.lon != null ? `<Position><LatitudeDegrees>${x.lat}</LatitudeDegrees><LongitudeDegrees>${x.lon}</LongitudeDegrees></Position>` : '') +
      (prev ? `<DistanceMeters>${dist.toFixed(1)}</DistanceMeters>` : '') +
      (x.hr ? `<HeartRateBpm><Value>${x.hr}</Value></HeartRateBpm>` : '') +
      (x.cad != null ? `<Cadence>${x.cad}</Cadence>` : '') +
      `<Extensions><ns3:TPX><ns3:Watts>${Math.max(0, Math.round(x.p ?? 0))}</ns3:Watts></ns3:TPX></Extensions></Trackpoint>`,
    );
  }
  const avgHr = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : 0;
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="Biking"><Id>${iso(0)}</Id>
<Lap StartTime="${iso(0)}"><TotalTimeSeconds>${n}</TotalTimeSeconds><DistanceMeters>${dist.toFixed(1)}</DistanceMeters>` +
    `<Calories>${Math.round(o.kJ ?? 0)}</Calories>` +
    (avgHr ? `<AverageHeartRateBpm><Value>${avgHr}</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>${Math.max(...hrs)}</Value></MaximumHeartRateBpm>` : '') +
    `<Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod>
<Track>${pts.join('\n')}</Track></Lap>
<Notes>${esc(o.name)}</Notes>
<Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Name>VeloIQ</Name></Creator>
</Activity></Activities></TrainingCenterDatabase>`;
}
