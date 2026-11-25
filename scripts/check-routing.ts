// Testy planera tras. Bez sieci: format BRouter (GeoJSON z wskazówkami i tagami dróg) → RideRoute, nawierzchnia,
// skręty, czas z fizyki, pętle, warianty, „Przed tobą”, geokoder. Z LIVE=1 – żywe zapytania do brouter.de,
// Overpass i Photon (uruchamiane w GitHub Actions, gdzie jest internet):
//   npx -y tsx --tsconfig tsconfig.json scripts/check-routing.ts
//   LIVE=1 npx -y tsx --tsconfig tsconfig.json scripts/check-routing.ts
import assert from 'node:assert/strict';
import { brouterProfile, brouterUrl, hintsToCues, parseBrouter, routingError, surfaceRuns } from '../lib/route/brouter';
import { destination, loopRadius, loopWaypoints, planRoutes, similarity, surfacePct, toPlanned, type PlannedRoute } from '../lib/route/plan';
import { estimateSeconds, speedFor } from '../lib/route/estimate';
import { surfaceOf, parseTags } from '../lib/route/surface';
import { fetchPois, nearestPoi, kindOf, overpassQuery, poisFromOverpass, samplePath } from '../lib/route/pois';
import { photonUrl, placesFromPhoton } from '../lib/route/geocode';
import { buildCourse, courseMeta, decodeParts } from '../lib/garmin/course';
import { rejoinIndex, spliceCourse } from '../lib/route/reroute';
import { dist } from '../lib/ride/gpx';

let n = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log(`ok  ${name}`); };
const M_LAT = 1 / 110_540;
const mLon = (lat: number) => 1 / (111_320 * Math.cos((lat * Math.PI) / 180));

/** Syntetyczna odpowiedź BRouter: odcinki [kierunek °, długość m, zmiana wysokości m, tagi]. */
function fakeBrouter(start: { lat: number; lon: number }, legs: [number, number, number, string][]) {
  const coords: number[][] = [[start.lon, start.lat, 400]];
  const msgs: string[][] = [['Longitude', 'Latitude', 'Elevation', 'Distance', 'CostPerKm', 'ElevCost', 'TurnCost', 'NodeCost', 'InitialCost', 'WayTags', 'NodeTags', 'Time', 'Energy']];
  const hints: number[][] = [];
  let cur = { lat: start.lat, lon: start.lon, ele: 400 };
  legs.forEach(([brg, len, dEle, tags], li) => {
    const steps = Math.round(len / 20);
    const b = (brg * Math.PI) / 180;
    for (let i = 1; i <= steps; i++) {
      cur = { lat: cur.lat + Math.cos(b) * 20 * M_LAT, lon: cur.lon + Math.sin(b) * 20 * mLon(cur.lat), ele: cur.ele + dEle / steps };
      coords.push([cur.lon, cur.lat, Math.round(cur.ele)]);
    }
    msgs.push([String(Math.round(cur.lon * 1e6)), String(Math.round(cur.lat * 1e6)), String(Math.round(cur.ele)), String(len), '1000', '0', '0', '0', '0', tags, '', '0', '0']);
    if (li < legs.length - 1) {
      const turn = ((legs[li + 1][0] - brg + 540) % 360) - 180;
      hints.push([coords.length - 1, turn > 0 ? 5 : 2, 0, 0, Math.round(turn)]);
    }
  });
  const total = legs.reduce((a, l) => a + l[1], 0);
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {
    creator: 'BRouter-1.7.8', name: 'brouter', 'track-length': String(total), 'filtered ascend': '120', 'plain-ascend': '120',
    'total-time': '1000', 'total-energy': '0', cost: '1000', voicehints: hints, messages: msgs,
  }, geometry: { type: 'LineString', coordinates: coords } }] };
}

const KARPACZ = { lat: 50.7753, lon: 15.7550 };
const JELENIA = { lat: 50.9044, lon: 15.7194 };
const rider = { ftp: 300, weight: 72 };

async function offline() {
  await ok('tagi OSM → asfalt / szuter / teren', () => {
    assert.equal(surfaceOf(parseTags('highway=secondary surface=asphalt')), 0);
    assert.equal(surfaceOf(parseTags('highway=residential')), 0);
    assert.equal(surfaceOf(parseTags('highway=track tracktype=grade2')), 1);
    assert.equal(surfaceOf(parseTags('highway=track surface=compacted')), 1);
    assert.equal(surfaceOf(parseTags('highway=path surface=ground')), 2);
    assert.equal(surfaceOf(parseTags('highway=track tracktype=grade4')), 2);
    assert.equal(surfaceOf(parseTags('highway=cycleway')), 0);
    assert.equal(surfaceOf(parseTags('highway=path bicycle=designated')), 0);
  });

  await ok('profile: szosa/gravel/MTB/spokojna → profil BRouter i parametry', () => {
    const road = brouterProfile('road', { quiet: true, flow: true });
    assert.equal(road.name, 'fastbike-verylowtraffic'); assert.equal(road.params.consider_town, 1);
    assert.equal(brouterProfile('road', { quiet: false }).name, 'fastbike');
    const gr = brouterProfile('gravel', { flat: true });
    assert.equal(gr.name, 'gravel'); assert.equal(gr.params.prefer_unpaved_paths, 1); assert.equal(gr.params.avoid_steep_inclines, 1);
    assert.equal(brouterProfile('gravel', { moreUnpaved: false }).params.prefer_unpaved_paths, 0);
    assert.ok(Object.values(brouterProfile('calm', { green: true }).params).every((v) => typeof v === 'number'), 'tylko liczby');
    assert.equal(brouterProfile('mtb', { moreUnpaved: true }).params.MTB_factor, 1.5);
    assert.equal(brouterProfile('calm', {}).name, 'trekking');
    const url = brouterUrl([KARPACZ, JELENIA], 'gravel', { prefer_unpaved_paths: 1 }, 1);
    assert.ok(url.includes('lonlats=15.755000,50.775300|15.719400,50.904400'));
    assert.ok(url.includes('profile=gravel') && url.includes('alternativeidx=1') && url.includes('profile:prefer_unpaved_paths=1'));
  });

  await ok('błędy serwera tras → zrozumiały komunikat', () => {
    assert.equal(routingError(500, 'to-position not mapped in existing datafile').code, 'no_route');
    assert.equal(routingError(500, 'operation killed by thread-priority-watchdog after 60 seconds').code, 'timeout');
    assert.equal(routingError(500, 'error parsing profile gravel: profile not found').code, 'profile');
  });

  const fake = fakeBrouter(KARPACZ, [
    [0, 2000, 10, 'highway=secondary surface=asphalt'],
    [90, 1500, 90, 'highway=track tracktype=grade2'],
    [0, 1000, 60, 'highway=path surface=ground'],
    [270, 2500, -160, 'highway=residential'],
  ]);

  await ok('GeoJSON BRouter → ślad, wskazówki, nawierzchnia odcinkami', () => {
    const t = parseBrouter(fake);
    assert.ok(Math.abs(t.cum[t.cum.length - 1] - 7000) < 30, `długość ${t.cum[t.cum.length - 1]}`);
    assert.equal(t.hints.length, 3);
    assert.deepEqual(t.segs.map((s) => s.surface), [0, 1, 2, 0]);
    const cues = hintsToCues(t);
    assert.deepEqual(cues.map((c) => c.dir), ['right', 'left', 'left']);
    assert.ok(Math.abs(cues[0].d - 2000) < 30);
    const { runs, meters } = surfaceRuns(t, 7000);
    assert.deepEqual(runs.map((r) => r[1]), [0, 1, 2, 0]);
    assert.deepEqual(meters.map((m) => Math.round(m / 100) * 100), [4500, 1500, 1000, 0]);
  });

  await ok('trasa z planera: RideRoute, czas jazdy, statystyki, kurs na licznik', () => {
    const p = toPlanned(parseBrouter(fake), 'Test', 'gravel', rider);
    assert.ok(Math.abs(p.route.total - 7000) < 40);
    assert.equal(p.route.profile, 'gravel');
    assert.equal(p.route.cues.length, 3);
    assert.ok(p.stats.estSec > 900 && p.stats.estSec < 1900, `czas ${p.stats.estSec}`);
    const pct = surfacePct(p.stats);
    assert.equal(pct.paved + pct.gravel + pct.trail, 100);
    const c = buildCourse(p.route);
    const meta = courseMeta(c);
    assert.ok(meta.n > 10 && meta.cues.length === 3);
    assert.ok(Array.isArray(meta.surf) && meta.surf.length === 4, 'nawierzchnia w kursie');
  });

  await ok('fizyka: prędkości rozsądne (płasko, podjazd, szuter)', () => {
    const flat = speedFor(200, 0, 80, 0.004, 0.3) * 3.6;
    const climb = speedFor(250, 0.07, 80, 0.004, 0.3) * 3.6;
    const gravel = speedFor(200, 0, 80, 0.01, 0.34) * 3.6;
    assert.ok(flat > 31 && flat < 36, `płasko ${flat}`);
    assert.ok(climb > 13 && climb < 16.5, `podjazd ${climb}`);   // 250 W, 80 kg, 7% ≈ 15 km/h
    assert.ok(gravel < flat - 2, `szuter ${gravel}`);
    const pts: [number, number, number | null, number][] = Array.from({ length: 101 }, (_, i) => [50, 15, 400, i * 100]);
    const road = estimateSeconds(pts, [[0, 0]], rider, 'road'), mtb = estimateSeconds(pts, [[0, 2]], rider, 'mtb');
    assert.ok(road < mtb, '10 km asfaltu szosą szybciej niż terenem MTB');
  });

  await ok('pętla: punkty na okręgu przez start, promień z dystansu', () => {
    const w = loopWaypoints(KARPACZ, loopRadius(60), 90, 3);
    assert.equal(w.length, 5);
    assert.deepEqual(w[0], KARPACZ); assert.deepEqual(w[4], KARPACZ);
    const c = destination(KARPACZ, loopRadius(60), 90);
    for (const p of w.slice(1, 4)) {
      const r = dist({ ...p, ele: null }, { ...c, ele: null });
      assert.ok(Math.abs(r - loopRadius(60)) < 20);
    }
    assert.ok(w[2].lon > KARPACZ.lon, 'pętla na wschód');
  });

  await ok('planer (podstawiony serwer): A→B w 3 wariantach, pętla z korektą promienia, bez dubli', async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      const alt = Number(/alternativeidx=(\d)/.exec(url)?.[1] ?? 0);
      const legs: [number, number, number, string][] = alt === 1
        ? [[0, 3000, 50, 'highway=track tracktype=grade2'], [90, 3000, 20, 'highway=track surface=gravel']]
        : alt === 2 ? [[0, 2000, 10, 'highway=secondary'], [90, 2000, 10, 'highway=secondary']]
        : [[0, 2000, 10, 'highway=secondary'], [90, 2000, 10, 'highway=secondary']];
      return new Response(JSON.stringify(fakeBrouter(KARPACZ, legs)), { status: 200 });
    };
    const ab = await planRoutes({ mode: 'ab', start: KARPACZ, end: JELENIA, profile: 'gravel' }, rider, fetcher as typeof fetch);
    assert.equal(calls.length, 3);
    assert.equal(ab.length, 2, 'alternatywa 2 = 0 → odrzucona jako duplikat');
    assert.ok(ab.every((x: PlannedRoute) => x.tag.length > 0));
    calls.length = 0;
    const loop = await planRoutes({ mode: 'loop', start: KARPACZ, loopKm: 40, profile: 'road', heading: 45 }, rider, fetcher as typeof fetch);
    assert.ok(calls.length >= 6, 'trzy kierunki + poprawka promienia');
    assert.ok(loop.length >= 1);
    assert.ok(similarity(loop[0].route, loop[0].route) > 0.99);
  });

  await ok('„Przed tobą”: zapytanie Overpass, rodzaje, rzut na trasę, bez dubli', () => {
    const p = toPlanned(parseBrouter(fake), 'Test', 'road', rider);
    const path = samplePath(p.route);
    assert.ok(path.length >= 10);
    assert.ok(overpassQuery(path).includes('around:150,'));
    assert.equal(kindOf({ amenity: 'drinking_water' }), 'water');
    assert.equal(kindOf({ shop: 'bicycle' }), 'bike');
    assert.equal(kindOf({ amenity: 'bench' }), null);
    const at = (d: number) => { const q = p.route.pts.find((x) => x[3] >= d)!; return { lat: q[0] + 0.0003, lon: q[1] }; };
    const els = [
      { ...at(1000), tags: { amenity: 'cafe', name: 'Kawiarnia Pod Śnieżką' } },
      { ...at(1200), tags: { amenity: 'cafe', name: 'Druga kawiarnia' } },     // ten sam rodzaj < 400 m → pomijamy
      { ...at(3000), tags: { amenity: 'drinking_water' } },
      { lat: 51.5, lon: 16.5, tags: { amenity: 'cafe', name: 'Daleko' } },     // daleko od trasy
    ];
    const pois = poisFromOverpass(p.route, els);
    assert.deepEqual(pois.map((x) => x.kind), ['cafe', 'water']);
    assert.ok(Math.abs(pois[0].d - 1000) < 60);
    assert.equal(pois[1].name, 'Woda pitna');
    const c = courseMeta(buildCourse({ ...p.route, pois }));
    assert.equal(c.pois?.length, 2);
  });

  await ok('powrót na trasę: punkt powrotu przed nami, dojazd + reszta trasy (skręty, podjazdy, nawierzchnia przesunięte)', () => {
    const main = toPlanned(parseBrouter(fake), 'Pętla testowa', 'gravel', rider);
    const stored = buildCourse({ ...main.route, pois: [{ d: 6000, kind: 'water', name: 'Źródło' }] });
    const pts = decodeParts(stored.parts);
    // zjechaliśmy ~200 m w bok po 2,2 km – powrót co najmniej 300 m dalej po trasie
    const at = pts.find((p) => p.d >= 2200)!;
    const pos = { lat: at.lat + 0.0018, lon: at.lon };
    const idx = rejoinIndex(pts, pos, 2200);
    assert.ok(pts[idx].d >= 2500 && pts[idx].d <= 8000, `punkt powrotu ${pts[idx].d}`);
    const approach = toPlanned(parseBrouter(fakeBrouter(pos, [[180, 400, 0, 'highway=track tracktype=grade2'], [90, 300, 5, 'highway=track tracktype=grade2']])), 'Pętla testowa', 'gravel', rider);
    const sp = spliceCourse(approach.route, stored, idx);
    const restLen = stored.total - pts[idx].d;
    assert.ok(Math.abs(sp.total - (approach.route.total + restLen)) < 30, `długość ${sp.total}`);
    assert.ok(sp.cues.every((c, i) => i === 0 || c.d >= sp.cues[i - 1].d), 'skręty po kolei');
    assert.ok(sp.cues.some((c) => c.d > approach.route.total + 100), 'skręty z dalszej części trasy');
    assert.equal(sp.pois?.length, 1);
    assert.ok(sp.pois![0].d > approach.route.total);
    assert.ok((sp.surface ?? []).length >= 2);
    const c2 = buildCourse(sp);
    assert.equal(c2.name, 'Pętla testowa');
    assert.ok(c2.n > 10);
  });

  await ok('geokoder: adres zapytania i etykiety miejsc', () => {
    assert.ok(photonUrl('Szklarska', KARPACZ).includes('lat=50.7753'));
    const pl = placesFromPhoton({ features: [{ geometry: { coordinates: [15.52, 50.83] }, properties: { name: 'Szklarska Poręba', state: 'województwo dolnośląskie', country: 'Polska' } }] });
    assert.equal(pl[0].label, 'Szklarska Poręba · województwo dolnośląskie');
  });
}

// ------------------------------------------------------------------ żywe testy (GitHub Actions)
async function live() {
  const km = (m: number) => (m / 1000).toFixed(1);
  const show = (title: string, list: PlannedRoute[]) => {
    console.log(`  ${title}:`);
    for (const x of list) {
      const s = surfacePct(x.stats);
      console.log(`    ${x.tag.padEnd(20)} ${km(x.stats.total)} km, +${x.stats.gain} m, ${Math.round(x.stats.estSec / 60)} min, asfalt ${s.paved}% szuter ${s.gravel}% teren ${s.trail}%, główne drogi ${km(x.stats.mainRoad)} km, skręty ${x.route.cues.length}, podjazdy ${x.route.climbs.length}`);
    }
  };
  let road: PlannedRoute[] = [], gravel: PlannedRoute[] = [];
  await ok('LIVE szosa Karpacz → Jelenia Góra (warianty)', async () => {
    road = await planRoutes({ mode: 'ab', start: KARPACZ, end: JELENIA, profile: 'road', opts: { quiet: true } }, rider);
    show('szosa', road);
    assert.ok(road.length >= 1 && road[0].stats.total > 15000 && road[0].stats.total < 40000);
  });
  await ok('LIVE gravel Karpacz → Jelenia Góra', async () => {
    gravel = await planRoutes({ mode: 'ab', start: KARPACZ, end: JELENIA, profile: 'gravel' }, rider);
    show('gravel', gravel);
    const unp = (l: PlannedRoute[]) => Math.max(...l.map((x) => x.stats.surface[1] + x.stats.surface[2]));
    console.log(`    nieutwardzone: gravel ${km(unp(gravel))} km vs szosa ${km(unp(road))} km`);
    assert.ok(unp(gravel) >= unp(road), 'gravel wybiera więcej szutru niż szosa');
  });
  await ok('LIVE MTB pętla 25 km Szklarska Poręba', async () => {
    const l = await planRoutes({ mode: 'loop', start: { lat: 50.8268, lon: 15.5214 }, loopKm: 25, profile: 'mtb', opts: { moreUnpaved: true } }, rider);
    show('mtb pętla', l);
    assert.ok(l.length >= 1 && l.every((x) => x.stats.total > 12000 && x.stats.total < 45000));
  });
  await ok('LIVE szosa pętla 60 km Karpacz (3 kierunki)', async () => {
    const l = await planRoutes({ mode: 'loop', start: KARPACZ, loopKm: 60, profile: 'road', opts: { quiet: true, flow: true } }, rider);
    show('szosa pętla', l);
    assert.ok(l.length >= 1 && l.some((x) => Math.abs(x.stats.total / 1000 - 60) < 18));
  });
  await ok('LIVE spokojna A→B', async () => {
    const l = await planRoutes({ mode: 'ab', start: KARPACZ, end: JELENIA, profile: 'calm' }, rider);
    show('spokojna', l);
  });
  await ok('LIVE „Przed tobą” (Overpass) dla trasy szosowej', async () => {
    const pois = await fetchPois(road[0].route);
    console.log(`    punkty: ${pois.length} → ${pois.slice(0, 8).map((p) => `${p.name} @${km(p.d)}`).join(', ')}`);
    assert.ok(Array.isArray(pois));
  });
  await ok('LIVE „prowadź do najbliższej kawiarni” (Overpass, 8 km)', async () => {
    const p = await nearestPoi(KARPACZ, 'cafe');
    console.log(`    najbliższa kawiarnia: ${p ? `${p.name} (${p.lat.toFixed(4)}, ${p.lon.toFixed(4)})` : 'brak'}`);
    assert.ok(p != null && Math.abs(p.lat - KARPACZ.lat) < 0.08 && Math.abs(p.lon - KARPACZ.lon) < 0.12);
  });
  await ok('LIVE geokoder „Szklarska Poręba”', async () => {
    const r = await fetch(photonUrl('Szklarska Poręba', KARPACZ));
    const pl = placesFromPhoton(await r.json());
    console.log(`    ${pl.slice(0, 3).map((p) => p.label).join(' | ')}`);
    assert.ok(pl.length > 0 && Math.abs(pl[0].lat - 50.83) < 0.1);
  });
}

(async () => {
  await offline();
  if (process.env.LIVE === '1') await live();
  console.log(`\n${n} testów OK`);
})().catch((e) => { console.error('FAIL', e, (e as { detail?: string })?.detail ?? ''); process.exit(1); });
