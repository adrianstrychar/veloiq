// Żywy test logiki serwera dla licznika Garmin (bez bazy i sieci): kodowanie próbek tak, jak robi to
// aplikacja na Edge → dekodowanie i rozwinięcie do zapisu 1 Hz; walidacja podsumowania; format treningu.
//   npm run check:garmin
import assert from 'node:assert/strict';
import { cleanExtra, cleanSummary, decodeGps, decodeSamples, expandSamples } from '../lib/garmin/ride';
import { plainText, scriptToGarmin } from '../lib/garmin/sync';
import { parseAnswer, stateLines } from '../lib/garmin/ask';
import { deviceName, newCode, newToken, sha256 } from '../lib/garmin/auth';
import { planDayToScript } from '../lib/ride/plan-to-script';
import type { PlanDayRow } from '../lib/planned-day';
import { buildCourse, courseMeta, CourseError, decodeParts, MAX_POINTS, PART_POINTS } from '../lib/garmin/course';
import { pickLocalDuplicates } from '../lib/ride/dedupe';
import { cleanAction } from '../lib/ride/coach-actions';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log(`ok  ${name}`); };

// --- próbki: [moc lo, moc hi, tętno, kadencja], bloki po 2248 B jak BlockStore na liczniku
ok('próbki 5 s: dekodowanie i rozwinięcie do 1 Hz', () => {
  const rec = (p: number, hr: number, cad: number) => Buffer.from([p & 0xff, (p >> 8) & 0xff, hr, cad]);
  const all = Buffer.concat(Array.from({ length: 600 }, (_, i) => rec(200 + (i % 100), i % 7 === 0 ? 0 : 140, i % 5 === 0 ? 255 : 90)));
  const chunks = [all.subarray(0, 2248).toString('base64'), all.subarray(2248).toString('base64')];
  assert.equal(chunks[0].length, 3000);
  const raw = decodeSamples(chunks);
  assert.equal(raw.length, 600);
  assert.deepEqual(raw[0], { p: 200, hr: null, cad: null });
  assert.deepEqual(raw[1], { p: 201, hr: 140, cad: 90 });
  assert.deepEqual(raw[599], { p: 299, hr: 140, cad: 90 });
  const s = expandSamples(raw, [], 2998);          // 2998 s jazdy: ostatnia próbka niepełna
  assert.equal(s.length, 2998);
  assert.deepEqual(s[0], { s: 0, p: 200 });
  assert.deepEqual(s[4], { s: 4, p: 200 });
  assert.deepEqual(s[5], { s: 5, p: 201, hr: 140, cad: 90 });
  assert.equal(s[2997].p, 299);
  assert.equal(expandSamples(raw, [], 99999).length, 3000);   // nie dłużej niż faktyczne próbki
});

ok('GPS co 10 s: mikrostopnie, brak pozycji, interpolacja', () => {
  const pt = (lat: number, lon: number, alt: number) => {
    const b = Buffer.alloc(10);
    b.writeInt32LE(Math.trunc(lat * 1e6), 0); b.writeInt32LE(Math.trunc(lon * 1e6), 4); b.writeUInt16LE(alt + 500, 8);
    return b;
  };
  const none = Buffer.alloc(10); none.writeInt32LE(0x7fffffff, 0); none.writeInt32LE(0x7fffffff, 4);
  const g = decodeGps([Buffer.concat([pt(50.778, 15.756, 620), pt(50.779, 15.758, 630), none, pt(-33.5, -70.6, 0)]).toString('base64')]);
  assert.equal(g.length, 4);
  assert.deepEqual(g[0], { lat: 50.778, lon: 15.756, alt: 620 });
  assert.equal(g[2], null);
  assert.deepEqual(g[3], { lat: -33.5, lon: -70.6, alt: 0 });
  const raw = Array.from({ length: 8 }, () => ({ p: 100, hr: null, cad: null }));
  const s = expandSamples(raw, g, 40);
  assert.equal(s[0].lat, 50.778);
  assert.equal(s[5].lat, 50.7785);           // połowa drogi między punktami
  assert.equal(s[5].lon, 15.757);
  assert.equal(s[10].lat, 50.779);           // punkt dokładnie w sekundzie
  assert.equal(s[15].lat, undefined);        // następny punkt bez pozycji → bez zgadywania
  assert.equal(s[25].lat, undefined);
  assert.equal(s[30].lat, -33.5);
});

ok('podsumowanie: zakresy i odrzucanie złych danych', () => {
  const now = Math.floor(Date.now() / 1000);
  const good = cleanSummary({ durationSec: 3600, avgPower: 210, np: 235, tss: 62, kJ: 756, avgHr: 141, maxHr: 172, ftp: 305, outdoor: 1,
    distanceM: 31234, ascentM: 420, workoutId: 'plan-2026-11-23', workoutName: 'Threshold 2x8 min', best: [900, 500, 400, 320, 0], zones: [1, 2, 3, 4, 5, 6, 7] }, now - 4000);
  assert.ok(good);
  assert.equal(good.outdoor, true);
  assert.equal(good.elapsedSec, 3600);
  assert.equal(good.samplePeriod, 5);
  assert.equal(cleanSummary({ durationSec: 100 }, now + 86400), null);           // z przyszłości
  assert.equal(cleanSummary({ durationSec: 100 }, now - 400 * 86400), null);     // sprzed ponad roku
  assert.equal(cleanSummary(null, now), null);
  const wild = cleanSummary({ durationSec: 1e12, avgPower: -5, np: 'x', ftp: 5, workoutName: 'a'.repeat(500) }, now - 10)!;
  assert.equal(wild.durationSec, 86400);
  assert.equal(wild.avgPower, 0);
  assert.equal(wild.np, 0);
  assert.equal(wild.ftp, 50);
  assert.equal(wild.workoutName.length, 80);

  const ex = cleanExtra({
    series: [{ n: 1, durationSec: 480, plannedSec: 480, avgPower: 301, compliancePct: 97, endedEarly: false, startSec: 325, verdict: 'ok', deltaW: 0, avgHr: 165, restBeforeSec: 325, junk: 'x' }, 'bad'],
    laps: [{ startSec: 0, name: 'Rozgrzewka', type: 'warmup' }], efforts: [{ startSec: 10, durationSec: 200, avgPower: 310 }],
    steps: [['Rozgrzewka', 0, 300, 150, 195, 0, 0, 0, 0, 142], ['Interwał 1', 1, 480, 290, 310, 85, 95, 0, 0, 0], ['zły']],
  }, good);
  assert.equal(ex.series.length, 1);
  assert.equal((ex.series[0] as { junk?: unknown }).junk, undefined);
  assert.equal(ex.script.steps.length, 2);
  assert.deepEqual(ex.script.steps[1], { name: 'Interwał 1', type: 'interval', durationSec: 480, powerLow: 290, powerHigh: 310, cadenceLow: 85, cadenceHigh: 95 });
  assert.equal(ex.script.steps[0].hrHigh, 142);
});

ok('trening z planu → format licznika (te same waty co w telefonie)', () => {
  const day = { dow: 1, type: 'THR', label: 'Threshold 2×20 min', watt: '290–310 W', hr: '', tss: 95, dur_min: 90,
    structure: { reps: 2, work_min: 20, work_w: 300, rest_min: 5 } } as unknown as PlanDayRow;
  const script = planDayToScript(day, 305, 'plan-2026-11-23', 189);
  assert.ok(script && script.steps.length >= 4);
  const g = scriptToGarmin(script, '2026-11-23', 95);
  assert.equal(g.steps.length, script.steps.length);
  assert.equal(g.dur, script.steps.reduce((a, s) => a + s.durationSec, 0));
  const iv = g.steps.find((s) => s[1] === 1)!;
  const src = script.steps.find((s) => s.type === 'interval')!;
  assert.deepEqual([iv[2], iv[3], iv[4]], [src.durationSec, src.powerLow, src.powerHigh]);
  assert.ok(!/[×–]/.test(g.name), `nazwa bez znaków spoza czcionek licznika: ${g.name}`);
  assert.ok(JSON.stringify(g).length < 7000, 'jeden trening mieści się w jednej wartości pamięci licznika');
  assert.equal(plainText('Sweet Spot 3×12 min – „mocno” … →'), 'Sweet Spot 3x12 min - "mocno" ... >');
});

ok('Enzo na ekran: JSON z odpowiedzi, akcje, czyszczenie tekstu', () => {
  assert.deepEqual(parseAnswer('{"say": "Trzymasz **302 W** – idealnie. Forza!", "action": null}'), { say: 'Trzymasz 302 W - idealnie. Forza!', action: null });
  assert.equal(parseAnswer('Tekst {"say":"Pauza.","action":"pause"}').action, 'pause');
  assert.equal(parseAnswer('{"say":"x","action":"usun_konto"}').action, null);
  assert.equal(parseAnswer('zwykły tekst bez JSON').say, 'zwykły tekst bez JSON');
  const lines = stateLines({ workout: 'Threshold', elapsedSec: 1234, phase: 'running', power3s: 302, hr: 165, np: 250, tss: 40,
    step: { name: 'Interwał 1', type: 'interval', intervalNo: 1, intervalCount: 2, targetLow: 296, targetHigh: 314, avgPower: 303, elapsedSec: 200, remainingSec: 280 } },
  { name: 'Adrian', ftp_watts: 305, hrmax: 189, weight_kg: 67 });
  assert.ok(lines.includes('FTP 305 W') && lines.includes('interwał 1 z 2') && lines.includes('zostało 4 min 40 s'));
});

ok('token i kod parowania', () => {
  const t = newToken();
  assert.ok(t.startsWith('vqg_') && t.length > 40);
  assert.equal(sha256(t).length, 64);
  assert.match(newCode(), /^\d{6}$/);
  assert.equal(deviceName('006-B2713-00'), 'Edge 1030');
  assert.equal(deviceName('???'), 'Garmin Edge');
});

ok('trasa GPX dla licznika: uproszczenie, pakowanie binarne, skręty i podjazdy', () => {
  // kręta trasa 120 km: sinusoida z podjazdem, punkty co 10 m (jak z lib/ride/gpx.ts)
  const pts: [number, number, number | null, number][] = [];
  const kLon = 1 / (111_320 * Math.cos((50.78 * Math.PI) / 180));
  for (let d = 0; d <= 120_000; d += 10) {
    const east = d * 0.9, north = 1500 * Math.sin(d / 900) + 400 * Math.sin(d / 130);
    pts.push([50.78 + north / 110_540, 15.75 + east * kLon, 600 + 300 * Math.sin(d / 9000), d]);
  }
  const route = { name: 'Runda – „Karkonosze” 120', total: 120_000, gain: 2100, pts,
    cues: [{ d: 5000, dir: 'left', angle: -80 }, { d: 300, dir: 'sharpRight', angle: 130 }, { d: 9000, dir: 'bogus', angle: 0 }],
    climbs: [{ start: 20_000, end: 26_500, gain: 410, grade: 6.3, low: 280, high: 300, tier: 'atak' }, { start: 60_000, end: 61_000, gain: 60, grade: 6 }] };
  const c = buildCourse(route);
  assert.ok(c.n <= MAX_POINTS && c.n > 200, `punktów: ${c.n}`);
  assert.equal(c.parts.length, Math.ceil(c.n / PART_POINTS));
  for (const part of c.parts) assert.ok(part.length <= 2992, 'część mieści się w jednej wartości pamięci licznika');
  const dec = decodeParts(c.parts);
  assert.equal(dec.length, c.n);
  assert.ok(Math.abs(dec[dec.length - 1].d - 120_000) <= c.n, 'dystans po trasie zachowany (zaokrąglenia do 1 m na punkt)');
  assert.ok(Math.abs(dec[0].lat - 50.78) < 1e-5 && Math.abs(dec[0].lon - 15.75) < 1e-5);
  // żaden punkt oryginału nie leży dalej niż 60 m od uproszczonego śladu, a odstępy nie przekraczają 200 m + krok
  let j = 0, worst = 0;
  for (const p of pts) {
    while (j < dec.length - 2 && dec[j + 1].d < p[3]) j++;
    const a = dec[j], b = dec[j + 1];
    const t = Math.max(0, Math.min(1, (p[3] - a.d) / Math.max(1, b.d - a.d)));
    const dy = (p[0] - (a.lat + (b.lat - a.lat) * t)) * 110_540, dx = (p[1] - (a.lon + (b.lon - a.lon) * t)) / kLon;
    worst = Math.max(worst, Math.hypot(dx, dy));
  }
  assert.ok(worst < 60, `największe odchylenie ${worst.toFixed(1)} m`);
  for (let i = 1; i < dec.length; i++) assert.ok(dec[i].d - dec[i - 1].d <= 215, 'punkt co najwyżej co ~200 m');
  assert.deepEqual(c.cues, [[300, 5], [5000, 0]]);                     // posortowane, nieznany kierunek pominięty
  assert.deepEqual(c.climbs, [[20000, 26500, 410, 63, 280, 300, 2], [60000, 61000, 60, 60, 0, 0, 0]]);
  assert.equal(c.name, 'Runda - "Karkonosze" 120');
  assert.ok(JSON.stringify(courseMeta(c)).length < 6000);
  assert.throws(() => buildCourse({ pts: [[50, 15, null, 0], [50.001, 15, null, 100]] }), CourseError);   // krótsza niż 500 m
  assert.throws(() => buildCourse({ pts: 'x' }), CourseError);
  // krótka trasa: uproszczenie zostawia narożniki
  const short = buildCourse({ name: 'L', pts: Array.from({ length: 201 }, (_, i) => (i <= 100
    ? [50 + (i * 10) / 110_540, 15, 500, i * 10] : [50 + 1000 / 110_540, 15 + ((i - 100) * 10) * kLon, 500, i * 10])) });
  assert.ok(short.n >= 3 && short.n <= 14, `krótka trasa: ${short.n} punktów`);
});

ok('ta sama jazda z telefonu i z licznika: jedna zostaje', () => {
  const r = (id: string, at: string, dur: number, source: string) => ({ id, started_at: at, duration_sec: dur, source });
  const phone = r('p', '2026-11-24T19:49:04Z', 4874, 'veloiq-ios');
  const edge = r('g', '2026-11-24T19:49:20Z', 4860, 'veloiq-garmin');
  const other = r('o', '2026-11-23T10:00:00Z', 3600, 'veloiq-garmin');
  // podobna długość → zostaje zapis z telefonu (1 Hz)
  assert.deepEqual(pickLocalDuplicates([edge, phone, other]).map((x) => [x.drop.id, x.keep.id]), [['g', 'p']]);
  // telefon włączony później (krótszy o > 5 %) → zostaje pełniejsza jazda z licznika
  const late = r('p2', '2026-11-24T19:59:00Z', 4200, 'veloiq-ios');
  assert.deepEqual(pickLocalDuplicates([late, edge]).map((x) => [x.drop.id, x.keep.id]), [['p2', 'g']]);
  // różne dni / brak nakładania – nic
  assert.equal(pickLocalDuplicates([phone, other]).length, 0);
});

ok('akcje Enzo: tylko znane polecenia, bezpieczne zakresy', () => {
  assert.equal(cleanAction('next'), 'next');
  assert.equal(cleanAction('extend:120'), 'extend:120');
  assert.equal(cleanAction('extend:-60'), 'extend:-60');
  assert.equal(cleanAction('extend:99999'), null);
  assert.equal(cleanAction('extend:9999'), 'extend:1800');
  assert.equal(cleanAction('bias:+5'), 'bias:+5');
  assert.equal(cleanAction('bias:-40'), 'bias:-25');
  assert.equal(cleanAction('bias:0'), 'bias:0');
  assert.equal(cleanAction('eat:25'), 'eat:25');
  assert.equal(cleanAction('route:start'), 'route:start');
  assert.equal(cleanAction('page:mapa'), 'page:mapa');
  assert.equal(cleanAction('rm -rf'), null);
  assert.equal(cleanAction('route:poi:cafe'), 'route:poi:cafe');
  assert.equal(cleanAction('route:place:Szklarska Poręba'), 'route:place:Szklarska Poręba');
  assert.equal(cleanAction('route:place:<b>Jelenia</b>'), 'route:place:bJeleniab');
  assert.equal(cleanAction('route:place:x'), null);
  assert.equal(cleanAction(null), null);
});

console.log(`\n${n} testów OK`);
