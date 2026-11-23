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

console.log(`\n${n} testów OK`);
