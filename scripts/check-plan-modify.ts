// Offline check (bez API i bazy): odtwarza bug „zmienia się tytuł, rozpiska nie” i sprawdza naprawę
// end-to-end: kontrakt bloków → walidacja/modyfikacja → diff czatu → rozpiska/profil → skrypt jazdy (głos).
// Uruchom: npm run check:plan-modify
import assert from 'node:assert/strict';
import { parseDayStructure, buildLabel, describeStructure, structureMainMin } from '@/lib/structure';
import { validateWeek, type PlanDay } from '@/lib/ai/plan-generate';
import { buildWorkout } from '@/lib/workout';
import { planDayToScript } from '@/lib/ride/plan-to-script';
import { evaluateAttempt } from '@/lib/ai/plan-modify';
import { buildPlanDiff } from '@/lib/ai/chat-write-tools';
import { buildIntensityCorrection } from '@/lib/overload-correction';

const FTP = 280;
const WEEK = '2026-10-26';
let pass = 0;
const t = (name: string, fn: () => void) => { fn(); pass++; console.log('✓', name); };

// ── Kontrakt ──
const sprintsZ2 = { blocks: [
  { repeat: 6, name: 'Sprinty', steps: [{ sec: 15, w: 650, name: 'Sprint' }, { sec: 585, w: 185 }] },
  { repeat: 1, steps: [{ sec: 300, w: 185 }] },
] };
t('parse: bloki poprawne dla Z2', () => {
  const p = parseDayStructure(sprintsZ2, 'Z2');
  assert.ok(p.ok);
  if (p.ok) assert.equal(structureMainMin(p.structure), 65);
});
t('parse: bloki odrzucone dla OFF', () => assert.ok(!parseDayStructure(sprintsZ2, 'OFF').ok));
t('parse: śmieci odrzucone', () => {
  assert.ok(!parseDayStructure({ blocks: [] }, 'THR').ok);
  assert.ok(!parseDayStructure({ blocks: [{ repeat: 2, steps: [{ sec: 2, w: 300 }] }] }, 'THR').ok);
  assert.ok(!parseDayStructure({ blocks: [{ repeat: 2, steps: [{ sec: 60, w: 9000 }] }] }, 'THR').ok);
});
t('parse: legacy dalej działa', () => {
  assert.ok(parseDayStructure({ reps: 3, work_min: 15, work_w: 280, rest_min: 5 }, 'THR').ok);
  assert.ok(!parseDayStructure({ reps: 3, work_min: 15, work_w: 280, rest_min: 5 }, 'Z2').ok);
});
t('label z bloków', () => {
  const p = parseDayStructure(sprintsZ2, 'Z2'); assert.ok(p.ok);
  if (p.ok) assert.equal(buildLabel('Z2', p.structure), 'Endurance + 6×Sprinty');
  const pyr = parseDayStructure({ blocks: [{ repeat: 1, steps: [{ sec: 180, w: 290 }, { sec: 240, w: 300 }, { sec: 300, w: 310 }] }] }, 'THR');
  assert.ok(pyr.ok); if (pyr.ok) assert.equal(buildLabel('THR', pyr.structure), 'Threshold 3min/4min/5min');
  console.log('   ', describeStructure(sprintsZ2 as never));
});

// ── Plan bazowy ──
const baseRaw = [
  { dow: 1, type: 'OFF', tss: 0, dur_min: 0, zones: [0,0,0,0,0], structure: null },
  { dow: 2, type: 'THR', tss: 85, dur_min: 90, hr: '160–172', zones: [30,10,10,50,0], structure: { reps: 3, work_min: 15, work_w: 285, rest_min: 5 } },
  { dow: 3, type: 'Z2', label: 'Endurance', tss: 60, dur_min: 90, watt: '175–210W', hr: '128–145', zones: [20,80,0,0,0], structure: null },
  { dow: 4, type: 'OFF', tss: 0, dur_min: 0, zones: [0,0,0,0,0], structure: null },
  { dow: 5, type: 'SST', tss: 75, dur_min: 85, hr: '150–165', zones: [35,5,60,0,0], structure: { reps: 3, work_min: 15, work_w: 255, rest_min: 5 } },
  { dow: 6, type: 'LONG', label: 'Long gravel', tss: 140, dur_min: 210, watt: '170–200W', hr: '130–148', zones: [15,80,5,0,0], structure: null },
  { dow: 7, type: 'Z2', label: 'Endurance', tss: 55, dur_min: 80, watt: '175–210W', hr: '128–145', zones: [20,80,0,0,0], structure: null },
];
const v = validateWeek(baseRaw, WEEK, { outline: false });
assert.ok(v.ok && v.days, v.error);
const current = v.days! as PlanDay[];
const TODAY = '2026-10-26';
const clone = () => JSON.parse(JSON.stringify(baseRaw));

t('BUG: zmiana samego tytułu Z2 → tytuł cofnięty + ostrzeżenie', () => {
  const days = clone(); days[2].label = 'Z2 + sprinty 6×15s';
  const r = evaluateAttempt({ days, userSpecifiedDays: [3], changedDays: [3] }, current, 'w środę dodaj 6 sprintów po 15 sekund', WEEK, TODAY);
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') {
    assert.equal(r.result.days[2].label, 'Endurance');
    assert.equal(r.softIssues.length, 1);
    console.log('   ', r.softIssues[0]);
  }
});
t('FIX: Z2 ze sprintami jako bloki → rozpiska, label, czas z serwera', () => {
  const days = clone(); days[2].structure = sprintsZ2; days[2].tss = 70;
  const r = evaluateAttempt({ days, userSpecifiedDays: [3], changedDays: [3] }, current, 'w środę dodaj 6 sprintów po 15 sekund', WEEK, TODAY);
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') {
    const d = r.result.days[2];
    assert.equal(r.softIssues.length, 0);
    assert.equal(d.label, 'Endurance + 6×Sprinty');
    assert.equal(d.dur_min, 15 + 65 + 10);
    assert.equal(d.watt, '175–210W');
    const diff = buildPlanDiff(current, r.result, WEEK);
    assert.match(diff, /rozpiska:/);
    console.log(diff.split('\n').map((l) => '    ' + l).join('\n'));
  }
});
t('FIX: zmiana interwałów THR (4×10) → diff pokazuje rozpiskę mimo równego czasu', () => {
  const days = clone(); days[1].structure = { reps: 5, work_min: 10, work_w: 295, rest_min: 4 };
  const r = evaluateAttempt({ days, userSpecifiedDays: [2], changedDays: [2] }, current, 'wtorek zamiast 3x15 zrób 5x10 na 295W', WEEK, TODAY);
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') {
    assert.equal(r.result.days[1].label, 'Threshold 5×10min');
    const diff = buildPlanDiff(current, r.result, WEEK);
    assert.match(diff, /5×10min@295W/);
  }
});
t('TWARDE: zmieniony THR bez structure → retry z feedbackiem', () => {
  const days = clone(); days[1].structure = null; days[1].dur_min = 100; days[1].label = 'Threshold 4×12';
  const r = evaluateAttempt({ days, userSpecifiedDays: [2], changedDays: [2] }, current, 'wtorek 4x12', WEEK, TODAY);
  assert.equal(r.kind, 'retry');
  if (r.kind === 'retry') assert.ok(r.feedback && /structure/.test(r.feedback));
});
t('unsupported → bez ostrzeżenia o braku zmian, przekazane dalej', () => {
  const days = clone();
  const r = evaluateAttempt({ days, userSpecifiedDays: [6], unsupported: ['jazda po szutrze w lesie'] }, current, 'w sobotę jedź po szutrze w lesie', WEEK, TODAY);
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') {
    assert.equal(r.softIssues.length, 0);
    assert.deepEqual(r.result.unsupported, ['jazda po szutrze w lesie']);
    assert.match(buildPlanDiff(current, r.result, WEEK), /Nie da się zapisać/);
  }
});
t('niezmienione dni: brak structure od modelu → oryginał przywrócony', () => {
  const days = clone(); days[4].structure = null; days[4].label = 'cokolwiek';
  const r = evaluateAttempt({ days, userSpecifiedDays: [7], off: [7] }, current, 'niedziela wolna', WEEK, TODAY);
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') {
    assert.deepEqual(r.result.days[4].structure, current[4].structure);
    assert.equal(r.result.days[6].type, 'OFF');
    assert.equal(r.softIssues.length, 0);
  }
});
t('LONG z tempem > 240 min akceptowany', () => {
  const days = clone(); days[5].structure = { blocks: [
    { repeat: 1, steps: [{ sec: 3600, w: 185 }] },
    { repeat: 3, name: 'Tempo', steps: [{ sec: 1200, w: 240 }, { sec: 600, w: 180 }] },
    { repeat: 1, steps: [{ sec: 3600, w: 185 }] },
  ] }; days[5].tss = 220;
  const r = evaluateAttempt({ days, userSpecifiedDays: [6], changedDays: [6] }, current, 'sobota 4h z 3x20 tempo', WEEK, TODAY);
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') { assert.equal(r.result.days[5].dur_min, 20 + 210 + 10); assert.equal(r.result.days[5].label, 'Long + 3×Tempo'); }
});

// ── Rozpiska, profil, jazda ──
t('WorkoutDetail: lista i profil z bloków', () => {
  const day = { type: 'Z2', label: 'Endurance + 6×Sprinty', dur_min: 90, structure: sprintsZ2 as never };
  const wk = buildWorkout(day, FTP);
  assert.equal(wk.segs[0].k, 'Rozgrzewka');
  assert.equal(wk.segs[1].k, 'Sprinty');
  assert.equal(wk.segs[1].t, '6× (15s + 9m45s)');
  const total = wk.expanded.reduce((a, s) => a + s.min, 0);
  assert.equal(Math.round(total), 90);
  assert.equal(wk.expanded.filter((s) => s.kind === 'work').length, 6);
});
t('Jazda (głos): kroki 1:1 z bloków, sprint bez kary za „za mocno”', () => {
  const script = planDayToScript({ date: '2026-10-28', type: 'Z2', label: 'x', dur_min: 90, tss: 70, structure: sprintsZ2 } as never, FTP, 'id')!;
  const sprints = script.steps.filter((s) => s.type === 'interval');
  assert.equal(sprints.length, 6);
  assert.equal(sprints[0].durationSec, 15);
  assert.ok(sprints[0].powerHigh >= 650 * 1.5);
  assert.equal(script.steps.reduce((a, s) => a + s.durationSec, 0), 90 * 60);
  console.log('    kroki:', script.steps.slice(0, 4).map((s) => `${s.name}(${s.type},${s.durationSec}s,${s.powerLow}-${s.powerHigh}W)`).join(' | '));
});
t('Jazda: legacy THR bez zmian zachowania', () => {
  const script = planDayToScript({ date: '2026-10-27', type: 'THR', label: 'x', dur_min: 90, tss: 85, structure: { reps: 3, work_min: 15, work_w: 285, rest_min: 5 } } as never, FTP, 'id')!;
  assert.equal(script.steps.filter((s) => s.type === 'interval').length, 3);
});
t('Kadencja z bloków trafia do skryptu', () => {
  const s = { blocks: [{ repeat: 4, steps: [{ sec: 480, w: 250, name: 'Siła', cad: [55, 65] }, { sec: 240, w: 150 }] }] };
  const script = planDayToScript({ date: '2026-10-27', type: 'SST', label: 'x', dur_min: 78, tss: 70, structure: s } as never, FTP, 'id')!;
  const w = script.steps.find((x) => x.type === 'interval')!;
  assert.equal(w.cadenceLow, 55); assert.equal(w.cadenceHigh, 65);
});
t('Auto-korekta przeciążenia: bloki redukowane o ~1/3', () => {
  const days = current.map((d) => d.dow === 2 ? { ...d, structure: { blocks: [{ repeat: 6, steps: [{ sec: 240, w: 300 }, { sec: 120, w: 140 }] }] } } as PlanDay : d);
  const r = buildIntensityCorrection(days, '2026-10-26', [], () => false, WEEK);
  assert.ok(r.ok);
  if (r.ok) {
    const tue = r.result.days.find((d) => d.dow === 2)!;
    assert.equal((tue.structure as { blocks: { repeat: number }[] }).blocks[0].repeat, 4);
  }
});
console.log(`\n${pass} testów OK`);
