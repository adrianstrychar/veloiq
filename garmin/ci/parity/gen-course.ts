// Generator trasy testowej dla nawigacji na liczniku: syntetyczny ślad przechodzi przez TEN SAM kod co
// prawdziwy plik GPX (lib/ride/gpx.ts → skręty i podjazdy, lib/garmin/course.ts → uproszczenie i pakowanie),
// a wynik trafia do testów Monkey C (dekodowanie części, dopasowanie pozycji, zapowiedzi) i do trybu demo.
//
//   npx -y tsx garmin/ci/parity/gen-course.ts
//
// Zapisuje garmin/source/tests/NavData.mc (testy) i garmin/source/DemoCourse.mc (zrzuty ekranu).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRoute } from '../../../lib/ride/gpx';
import { buildCourse, courseMeta, decodeParts } from '../../../lib/garmin/course';

interface Raw { lat: number; lon: number; ele: number | null }

const M_LAT = 1 / 110_540;                                   // stopnie na metr (szerokość)
const mLon = (lat: number) => 1 / (111_320 * Math.cos((lat * Math.PI) / 180));

/** Odcinki [kierunek ° (0 = północ, 90 = wschód), długość m, zmiana wysokości m] → punkty co 5 m. */
function track(start: Raw, legs: [number, number, number][]): Raw[] {
  const out: Raw[] = [start];
  let cur = { ...start, ele: start.ele ?? 0 };
  for (const [bearing, len, dEle] of legs) {
    const n = Math.round(len / 5);
    const b = (bearing * Math.PI) / 180;
    for (let i = 1; i <= n; i++) {
      const lat = cur.lat + Math.cos(b) * 5 * i * M_LAT;
      const lon = cur.lon + Math.sin(b) * 5 * i * mLon(cur.lat);
      out.push({ lat, lon, ele: cur.ele + (dEle * i) / n });
    }
    const last = out[out.length - 1];
    cur = { lat: last.lat, lon: last.lon, ele: last.ele ?? 0 };
  }
  return out;
}

// 1200 m na północ płasko → w prawo → 1500 m na wschód pod górę (+120 m, 8%) → w lewo → 900 m na północ lekko w dół
const raw = track({ lat: 50.78, lon: 15.75, ele: 600 }, [[0, 1200, 0], [90, 1500, 120], [0, 900, -30]]);
const route = buildRoute('Pętla testowa', raw);
// tryb startowy: cel mocy i taktyka na pierwszym podjeździe (jak po applyRaceTargets)
if (route.climbs[0]) Object.assign(route.climbs[0], { low: 280, high: 300, tier: 'atak' });
// trasa z planera (v2): nawierzchnia odcinkami (asfalt → szuter na podjeździe → teren na końcu) i punkty „Przed tobą”
route.profile = 'gravel';
route.surface = [[0, 0], [1250, 1], [2900, 2]];
route.pois = [{ d: 900, kind: 'water', name: 'Źródełko' }, { d: 2400, kind: 'cafe', name: 'Schronisko' }, { d: 3300, kind: 'bike', name: 'Serwis Karkonosze' }];

const course = buildCourse(route);
const meta = courseMeta(course);
const decoded = decodeParts(course.parts);

// przejazd: punkt co 10 m (36 km/h przy 1 Hz), z wycieczką 150 m w bok między 400 a 700 m trasy
const micro = (v: number) => Math.round(v * 1e6);
const drive: number[] = [];
for (const p of route.pts) drive.push(micro(p[0]), micro(p[1]));
const detour: number[] = [];
for (const p of route.pts) {
  const d = p[3];
  let lon = p[1];
  if (d >= 400 && d <= 700) {
    const k = d < 460 ? (d - 400) / 60 : d > 640 ? (700 - d) / 60 : 1;     // odjazd, 180 m równolegle, powrót
    lon += 150 * k * mLon(p[0]);
  }
  if (d <= 1000) detour.push(micro(p[0]), micro(lon));
}

const str = (s: string) => JSON.stringify(s);
const arr = (a: unknown[]): string => `[${a.map((x) => (Array.isArray(x) ? arr(x) : String(x))).join(', ')}]`;
const chunks = (a: number[], per = 16) => {
  const lines: string[] = [];
  for (let i = 0; i < a.length; i += per) lines.push('            ' + a.slice(i, i + per).join(', '));
  return lines.join(',\n');
};

function moduleSrc(name: string, annotation: string, withDrive: boolean): string {
  return `// PLIK GENEROWANY – nie edytuj ręcznie.  npx -y tsx garmin/ci/parity/gen-course.ts
import Toybox.Application;
import Toybox.Lang;

(:${annotation})
module ${name} {
    const N = ${course.n};
    const TOTAL = ${course.total};
    const CUES = ${course.cues.length};
    const CLIMBS = ${course.climbs.length};
    // pierwszy i ostatni punkt po zdekodowaniu (mikrostopnie) oraz dystans ostatniego punktu
    const FIRST = ${arr([micro(decoded[0].lat), micro(decoded[0].lon)])};
    const LAST = ${arr([micro(decoded[decoded.length - 1].lat), micro(decoded[decoded.length - 1].lon), Math.round(decoded[decoded.length - 1].d)])};

    //! Zapisuje trasę w pamięci licznika tak, jak robi to pobieranie z VeloIQ.
    function install() as Void {
        var parts = [
${course.parts.map((p) => '            ' + str(p)).join(',\n')}
        ];
        for (var i = 0; i < parts.size(); i++) { Application.Storage.setValue("crs_p" + i, parts[i]); }
        Application.Storage.setValue("crs_t", ${arr(meta.cues)});
        Application.Storage.setValue("crs_c", ${arr(meta.climbs)});
        Application.Storage.setValue("crs_s", ${arr(meta.surf ?? [])});
        Application.Storage.setValue("crs_q", ${arr((meta.pois ?? []).map((p) => [p[0], p[1], str(String(p[2]))]))});
        Application.Storage.setValue("crs", { "id" => ${str(meta.id)}, "name" => ${str(meta.name)}, "total" => ${meta.total}, "gain" => ${meta.gain}, "n" => ${meta.n}, "parts" => ${meta.parts}, "prof" => ${str(meta.prof ?? '')} });
        Application.Storage.setValue("crs_ok", ${str(meta.id)});
    }
${withDrive ? `
    //! Przejazd po trasie: [szer., dług.] w mikrostopniach co 10 m (jedna para na sekundę).
    function drive() {
        return [
${chunks(drive)}
        ];
    }

    //! Pierwszy kilometr z wycieczką 150 m w bok między 400 a 700 m trasy.
    function detour() {
        return [
${chunks(detour)}
        ];
    }
` : `
    //! Przejazd po trasie: [szer., dług.] w mikrostopniach co 10 m.
    function drive() {
        return [
${chunks(drive)}
        ];
    }
`}}
`;
}

const root = join(__dirname, '..', '..', 'source');
writeFileSync(join(root, 'tests', 'NavData.mc'), moduleSrc('NavData', 'test', true));
writeFileSync(join(root, 'DemoCourse.mc'), moduleSrc('DemoCourse', 'demo', false));
console.log(`trasa: ${course.n} pkt (z ${route.pts.length}), ${course.total} m, skręty ${JSON.stringify(course.cues)}, podjazdy ${JSON.stringify(course.climbs)}, części ${course.parts.length}`);
