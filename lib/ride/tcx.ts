// Zapis jazdy z VeloIQ (1 Hz) → plik TCX dla Stravy: czas, pozycja GPS, dystans, tętno, kadencja, moc.
// Sekundy zapisu to czas JAZDY (postoje/auto-pauza wycięte), więc znaczniki czasu idą od startu bez przerw.
import type { SavedSample } from './save-ride';
import { rideDistances } from './virtual-speed';

export interface TcxLap { startSec: number; name?: string; type?: string }

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));


export function buildTcx(o: { startedAt: string; samples: SavedSample[]; name: string; kJ?: number | null; laps?: TcxLap[] | null }): string {
  const t0 = new Date(o.startedAt).getTime();
  const iso = (s: number) => new Date(t0 + s * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const D = rideDistances(o.samples);   // GPS albo – na trenażerze – wirtualny dystans z mocy
  const pts: string[] = [];
  o.samples.forEach((x, i) => {
    pts.push(
      `<Trackpoint><Time>${iso(x.s)}</Time>` +
      (x.lat != null && x.lon != null ? `<Position><LatitudeDegrees>${x.lat}</LatitudeDegrees><LongitudeDegrees>${x.lon}</LongitudeDegrees></Position>` : '') +
      `<DistanceMeters>${D[i].toFixed(1)}</DistanceMeters>` +
      (x.hr ? `<HeartRateBpm><Value>${x.hr}</Value></HeartRateBpm>` : '') +
      (x.cad != null ? `<Cadence>${x.cad}</Cadence>` : '') +
      `<Extensions><ns3:TPX><ns3:Watts>${Math.max(0, Math.round(x.p ?? 0))}</ns3:Watts></ns3:TPX></Extensions></Trackpoint>`,
    );
  });
  // lapy = kroki planu (rozgrzewka, interwały, przerwy…) – Strava pokaże strukturę treningu
  const n = o.samples.length;
  const starts = Array.from(new Set([0, ...(o.laps ?? []).map((l) => o.samples.findIndex((x) => x.s >= l.startSec)).filter((i) => i > 0)])).sort((a, b) => a - b);
  const kcalPerSample = n ? (o.kJ ?? 0) / n : 0;
  const lapXml = starts.map((a, k) => {
    const b = k + 1 < starts.length ? starts[k + 1] : n;
    const seg = o.samples.slice(a, b);
    const hrs = seg.map((x) => x.hr ?? 0).filter((h) => h > 0);
    const avgHr = hrs.length ? Math.round(hrs.reduce((x, y) => x + y, 0) / hrs.length) : 0;
    const w = seg.map((x) => x.p ?? 0);
    const avgW = w.length ? Math.round(w.reduce((x, y) => x + y, 0) / w.length) : 0;
    const lap = (o.laps ?? []).find((l) => o.samples.findIndex((x) => x.s >= l.startSec) === a);
    const rest = lap?.type === 'recovery' || lap?.type === 'cooldown' || lap?.type === 'warmup';
    const dist = (D[b - 1] ?? 0) - (a > 0 ? D[a - 1] : 0);
    return `<Lap StartTime="${iso(o.samples[a]?.s ?? 0)}"><TotalTimeSeconds>${b - a}</TotalTimeSeconds><DistanceMeters>${dist.toFixed(1)}</DistanceMeters>` +
      `<Calories>${Math.round(kcalPerSample * (b - a))}</Calories>` +
      (avgHr ? `<AverageHeartRateBpm><Value>${avgHr}</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>${Math.max(...hrs)}</Value></MaximumHeartRateBpm>` : '') +
      `<Intensity>${rest ? 'Resting' : 'Active'}</Intensity><TriggerMethod>Manual</TriggerMethod>` +
      `<Track>${pts.slice(a, b).join('\n')}</Track>` +
      `<Extensions><ns3:LX><ns3:AvgWatts>${avgW}</ns3:AvgWatts></ns3:LX></Extensions></Lap>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="Biking"><Id>${iso(0)}</Id>
${lapXml}
<Notes>${esc(o.name)}</Notes>
<Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Name>VeloIQ</Name></Creator>
</Activity></Activities></TrainingCenterDatabase>`;
}
