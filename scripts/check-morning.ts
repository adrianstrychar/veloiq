// Symulacja silnika raportu porannego (bez bazy): scenariusze WHOOP × plan dnia.
// npx tsx --tsconfig tsconfig.json scripts/check-morning.ts
import { decideMorning, type MorningInput } from '@/lib/morning/engine';
import { summarizeWhoop, type WhoopDay } from '@/lib/whoop-summary';
import { shiftISO } from '@/lib/timezone';
import type { PlanDay } from '@/lib/ai/plan-generate';

const TODAY = '2026-11-18'; // środa
const MON = '2026-11-16';
let fails = 0;
const check = (name: string, cond: boolean, info: string) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name} :: ${info}`); if (!cond) fails++; };

function day(i: number, type: string, label: string, dur: number, tss: number, structure: unknown = null): PlanDay {
  return { dow: i + 1, date: shiftISO(MON, i), type, label, dur_min: dur, tss, watt: '–', hr: '–', zones: [0, 0, 0, 0, 0], outline: false, structure } as PlanDay;
}
const THR = { reps: 3, work_min: 15, work_w: 280, rest_min: 5 };
const VO2 = { reps: 5, work_min: 4, work_w: 340, rest_min: 4 };
function week(todayDay: PlanDay, tue: PlanDay | null = null, thu: PlanDay | null = null, fri: PlanDay | null = null): PlanDay[] {
  return [
    day(0, 'OFF', 'Wolne', 0, 0),
    tue ?? day(1, 'Z2', 'Wytrzymałość Z2', 90, 60),
    { ...todayDay, dow: 3, date: TODAY },
    thu ?? day(3, 'Z2', 'Wytrzymałość Z2', 75, 50),
    fri ?? day(4, 'Z1', 'Regeneracja', 45, 25),
    day(5, 'LONG', 'Długa 3h', 180, 150),
    day(6, 'Z2', 'Wytrzymałość Z2', 90, 60),
  ];
}
// 30 dni historii: HRV 70, RHR 50, sen 7h45 z 8h, temp 33.5, oddech 14.5
function hist(today: Partial<WhoopDay>, yesterday: Partial<WhoopDay> = {}): WhoopDay[] {
  const rows: WhoopDay[] = [];
  for (let k = 30; k >= 0; k--) {
    const date = shiftISO(TODAY, -k);
    const baseRow: WhoopDay = { date, recovery_score: 60, hrv_ms: 70, rhr: 50, spo2: 96, skin_temp: 33.5, calibrating: false, sleep_performance: 92, sleep_min: 465, sleep_need_min: 480, deep_min: 90, rem_min: 100, light_min: 275, awake_min: 30, resp_rate: 14.5, day_strain: 12, workouts: null };
    rows.push(k === 0 ? { ...baseRow, ...today } : k === 1 ? { ...baseRow, ...yesterday } : baseRow);
  }
  return rows;
}
function inp(todayDay: PlanDay, w: Partial<WhoopDay>, extra: Partial<MorningInput> = {}, y: Partial<WhoopDay> = {}): MorningInput {
  const h = hist(w, y);
  return { today: TODAY, whoop: summarizeWhoop(h, TODAY)!, history: h, tsb: -5, ftp: 290, days: week(todayDay), isDone: () => false, races: [], wakeAt: '2026-11-18T06:00:00Z', ...extra };
}
const show = (r: ReturnType<typeof decideMorning>) => `${r.verdict}/${r.mode ?? '-'} | ${r.title} | ${r.reason}${r.tips.length ? ' | ' + r.tips.join(' ') : ''}`;

// 1. zielono 85, Z2 90 → propozycja +30
let r = decideMorning(inp(day(2, 'Z2', 'Wytrzymałość Z2', 90, 60), { recovery_score: 85, hrv_ms: 78 }));
check('green Z2 boost', r.verdict === 'boost' && r.mode === 'proposal' && r.after?.dur_min === 120, show(r));
// 2. zielono 85, THR 3×15 → 4×15
r = decideMorning(inp(day(2, 'THR', 'THR 3×15min', 95, 90, THR), { recovery_score: 85, hrv_ms: 78 }));
check('green THR boost +1 rep', r.verdict === 'boost' && (r.after?.structure as { reps: number })?.reps === 4 && r.after!.dur_min === 115, show(r));
// 3. żółto 50, niskie HRV + krótki sen, THR → 2×15
r = decideMorning(inp(day(2, 'THR', 'THR 3×15min', 95, 90, THR), { recovery_score: 50, hrv_ms: 55, sleep_min: 330, sleep_performance: 68 }));
check('yellow THR trim', r.verdict === 'trim' && r.mode === 'auto' && (r.after?.structure as { reps: number })?.reps === 2 && r.after!.dur_min < 95, show(r));
// 4. żółto 55, jeden sygnał, VO2 → bez zmian
r = decideMorning(inp(day(2, 'VO2', 'VO2 5×4min', 80, 85, VO2), { recovery_score: 55, sleep_min: 340, sleep_performance: 70 }));
check('yellow VO2 keep', r.verdict === 'keep' && r.mode === null, show(r));
// 5. czerwono 28, VO2 dziś, czw Z2 (pt Z1) → Z1 + VO2 na czwartek
r = decideMorning(inp(day(2, 'VO2', 'VO2 5×4min', 80, 85, VO2), { recovery_score: 28, hrv_ms: 52 }));
check('red VO2 easy+swap', r.verdict === 'easy' && r.after?.type === 'Z1' && r.moved?.to.date === '2026-11-19' && r.days!.find((d) => d.date === '2026-11-19')!.type === 'VO2', show(r));
// 5b. czerwono, czwartek przed kluczem w piątek → nie przenosimy na czw (pt klucz), szukamy dalej (pt=klucz → nie, sob LONG → nie) → brak przeniesienia
{
  const i = inp(day(2, 'VO2', 'VO2 5×4min', 80, 85, VO2), { recovery_score: 28 });
  i.days = week({ ...i.days[2] }, null, null, day(4, 'THR', 'THR 3×15min', 95, 90, THR));
  r = decideMorning(i);
  check('red no swap before key', r.verdict === 'easy' && !r.moved, show(r));
}
// 6. czerwono 15 → odpoczynek
r = decideMorning(inp(day(2, 'THR', 'THR 3×15min', 95, 90, THR), { recovery_score: 15 }));
check('very red rest', r.verdict === 'rest' && r.after?.type === 'OFF', show(r));
// 7. infekcja: temp +0.8, RHR +6 przy zielonej regeneracji
r = decideMorning(inp(day(2, 'Z2', 'Wytrzymałość Z2', 90, 60), { recovery_score: 70, skin_temp: 34.3, rhr: 56 }));
check('illness rest', r.verdict === 'rest' && r.signals.illness, show(r));
// 8. dzień startu
r = decideMorning(inp(day(2, 'RACE', 'Gran Fondo', 300, 300), { recovery_score: 30 }));
check('race day no change', r.verdict === 'race' && r.mode === null, show(r));
// 9. taper (start A za 2 dni), czerwono → tylko rada
r = decideMorning(inp(day(2, 'VO2', 'VO2 5×4min', 80, 85, VO2), { recovery_score: 25 }, { races: [{ date: shiftISO(TODAY, 2), priority: 'A' }] }));
check('taper frozen', r.verdict === 'taper' && r.mode === null, show(r));
// 10. LONG żółto ciężko → 0.75
r = decideMorning(inp(day(2, 'LONG', 'Długa 4h', 240, 200), { recovery_score: 42, hrv_ms: 56 }));
check('yellow LONG trim', r.verdict === 'trim' && r.after?.dur_min === 180 && r.after.label === 'Długa 3h', show(r));
// 11. już przejechane
r = decideMorning(inp(day(2, 'THR', 'THR 3×15min', 95, 90, THR), { recovery_score: 20 }, { isDone: (d) => d === TODAY }));
check('done no change', r.verdict === 'done' && r.mode === null, show(r));
// 12. własny trening
r = decideMorning(inp(day(2, 'THR', 'Mój trening', 90, 90, { own: true, blocks: [{ repeat: 2, steps: [{ sec: 1200, w: 280 }] }] }), { recovery_score: 25 }));
check('own frozen', r.verdict === 'keep' && r.mode === null, show(r));
// 13. czerwono 2. dzień z rzędu + niskie HRV → odpoczynek
r = decideMorning(inp(day(2, 'Z2', 'Wytrzymałość Z2', 90, 60), { recovery_score: 30, hrv_ms: 50 }, {}, { recovery_score: 25 }));
check('red streak rest', r.verdict === 'rest', show(r));
// 14. zielono, jutro klucz → wskazówka snu z godziną
{
  const i = inp(day(2, 'Z2', 'Wytrzymałość Z2', 90, 60), { recovery_score: 75 });
  i.days = week(i.days[2], null, day(3, 'VO2', 'VO2 5×4min', 80, 85, VO2));
  r = decideMorning(i);
  check('bedtime tip', r.tips.some((t) => /połóż się ok\. 22:45/.test(t)), show(r));
}
// 15. bloki: SST 2×(3×10min) żółto ciężko → mniej powtórzeń bloku
r = decideMorning(inp(day(2, 'SST', 'SST', 110, 95, { blocks: [{ repeat: 3, steps: [{ sec: 600, w: 260 }, { sec: 300, w: 150 }] }] }), { recovery_score: 40, hrv_ms: 55 }));
check('yellow blocks trim', r.verdict === 'trim' && (r.after?.structure as { blocks: { repeat: number }[] }).blocks[0].repeat === 2, show(r));
// 16. dzień wolny przy czerwonej
r = decideMorning(inp(day(2, 'OFF', 'Wolne', 0, 0), { recovery_score: 20 }));
check('off', r.verdict === 'off' && r.mode === null, show(r));
// 17. kalibracja WHOOP → bez propozycji dokładania
r = decideMorning(inp(day(2, 'Z2', 'Wytrzymałość Z2', 90, 60), { recovery_score: 90, calibrating: true }));
check('calibrating no boost', r.verdict === 'keep', show(r));

console.log(fails ? `\n${fails} FAIL` : '\nwszystko OK');
process.exit(fails ? 1 : 0);
