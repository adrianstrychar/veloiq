// Przebieg I/O raportu porannego na bazie w pamięci (atrapa klienta Supabase): zapis odciążenia,
// idempotencja, „Przywróć plan”, ponowne przeliczenie po zmianie danych WHOOP, propozycja + zatwierdzenie,
// ręczna zmiana planu po korekcie. npx tsx --tsconfig tsconfig.json scripts/check-morning-run.ts
import { runMorningReport, actOnMorningReport, planHash } from '@/lib/morning/run';
import { userTodayISO, shiftISO } from '@/lib/timezone';
import { mondayOfISO } from '@/lib/plan';

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
function q(table: string) {
  const rows = () => (db[table] ??= []);
  let filters: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'update' | 'upsert' = 'select';
  let payload: Row | null = null;
  let ord: { k: string; asc: boolean } | null = null;
  let lim: number | null = null;
  const run = () => {
    if (op === 'update') { rows().filter((r) => filters.every((f) => f(r))).forEach((r) => Object.assign(r, structuredClone(payload))); return { data: null, error: null }; }
    let out = rows().filter((r) => filters.every((f) => f(r)));
    if (ord) out = [...out].sort((a, b) => (String(a[ord!.k]) < String(b[ord!.k]) ? -1 : 1) * (ord!.asc ? 1 : -1));
    if (lim != null) out = out.slice(0, lim);
    return { data: structuredClone(out), error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b; },
    gte: (k: string, v: string) => { filters.push((r) => String(r[k]) >= v); return b; },
    lte: (k: string, v: string) => { filters.push((r) => String(r[k]) <= v); return b; },
    or: () => b,
    order: (k: string, o?: { ascending?: boolean }) => { ord = { k, asc: o?.ascending !== false }; return b; },
    limit: (n: number) => { lim = n; return b; },
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    upsert: (p: Row) => {
      const i = rows().findIndex((r) => r.athlete_id === p.athlete_id && r.date === p.date);
      const row = { created_at: '2026-11-20T06:05:00Z', ...structuredClone(p) };
      if (i >= 0) rows()[i] = { ...rows()[i], ...row }; else rows().push(row);
      return Promise.resolve({ error: null });
    },
    maybeSingle: () => Promise.resolve({ data: run().data?.[0] ?? null, error: null }),
    single: () => Promise.resolve({ data: run().data?.[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}
const supabase = { from: (t: string) => q(t) } as never;

const A = 'ath-1';
const TODAY = userTodayISO();
const MON = mondayOfISO(TODAY);
let fails = 0;
const check = (n: string, c: boolean, i = '') => { console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${i ? ' :: ' + i : ''}`); if (!c) fails++; };

const VO2 = { reps: 5, work_min: 4, work_w: 340, rest_min: 4 };
const types = ['Z2', 'THR', 'OFF', 'Z2', 'VO2', 'Z2', 'Z1']; // pn..nd
function plan() {
  return { days: types.map((t, i) => {
    const date = shiftISO(MON, i);
    const isToday = date === TODAY;
    const type = isToday ? 'VO2' : (date > TODAY && i === types.length - 2 ? 'Z2' : t);
    return { dow: i + 1, date, type, label: type === 'VO2' ? 'VO2 5×4min' : type === 'OFF' ? 'Wolne' : `Jazda ${type}`, tss: type === 'OFF' ? 0 : 60, dur_min: type === 'OFF' ? 0 : 80, watt: '–', hr: '–', zones: [0, 0, 0, 0, 0], outline: false, structure: type === 'VO2' ? VO2 : null };
  }), insight: 'x' };
}
function whoopRows(today: Row) {
  return Array.from({ length: 31 }, (_, k) => {
    const date = shiftISO(TODAY, -30 + k);
    const base = { athlete_id: A, date, recovery_score: 60, hrv_ms: 70, rhr: 50, spo2: 96, skin_temp: 33.5, calibrating: false, sleep_performance: 92, sleep_min: 465, sleep_need_min: 480, deep_min: 90, rem_min: 100, light_min: 275, awake_min: 30, resp_rate: 14.5, day_strain: 12, workouts: null, sleep_end: `${TODAY}T06:00:00Z` };
    return date === TODAY ? { ...base, ...today } : base;
  });
}
function reset(today: Row) {
  for (const k of Object.keys(db)) delete db[k];
  db.athletes = [{ id: A, ftp_watts: 290 }];
  db.fitness_metrics = [{ athlete_id: A, date: shiftISO(TODAY, -1), tsb: -5 }];
  db.weekly_plans = [{ athlete_id: A, week_start: MON, plan_json: plan() }];
  db.strava_activities = [];
  db.race_calendar = [];
  db.whoop_connections = [{ athlete_id: A, last_sync_at: null, sync_error: null }];
  db.whoop_daily = whoopRows(today);
  db.morning_reports = [];
}
const planNow = () => db.weekly_plans[0].plan_json as { days: Array<{ date: string; type: string; label: string; morning?: unknown }> };
const todayDay = () => planNow().days.find((d) => d.date === TODAY)!;
const rep = () => db.morning_reports[0] as Row;
const original = planHash(plan());

(async () => {
  console.log(`dziś ${TODAY}, tydzień od ${MON}`);
  // 1. czerwono → odciążenie zapisane samo
  reset({ recovery_score: 28, hrv_ms: 52 });
  let r = await runMorningReport(supabase, A);
  check('red → applied', r?.change_status === 'applied' && todayDay().type === 'Z1', `${r?.title} | ${r?.reason}`);
  const moved = (r?.signals as { moved?: { to: string } } | null)?.moved;
  if (moved) check('VO2 przeniesione', planNow().days.find((d) => d.date === moved.to)?.type === 'VO2', `→ ${moved.to}`);
  const firstHash = planHash(planNow());
  // 2. ponowne wywołanie, te same dane → bez zmian
  r = await runMorningReport(supabase, A);
  check('idempotent', planHash(planNow()) === firstHash && db.morning_reports.length === 1);
  // 3. Przywróć plan
  let a = await actOnMorningReport(supabase, A, 'revert');
  check('revert', a.ok && planHash(planNow()) === original && rep().change_status === 'reverted', a.message ?? a.error);
  // 4. nowe dane WHOOP po cofnięciu → decyzja zawodnika zostaje
  db.whoop_daily.find((x) => x.date === TODAY)!.recovery_score = 20;
  r = await runMorningReport(supabase, A);
  check('po cofnięciu bez ponownej zmiany', planHash(planNow()) === original && r?.change_status === 'reverted');

  // 5. żółto ciężko → przycięte; WHOOP przelicza na 85 → propozycja, plan wraca do oryginału; zatwierdź
  reset({ recovery_score: 45, hrv_ms: 55, sleep_min: 330, sleep_performance: 68 });
  r = await runMorningReport(supabase, A);
  check('yellow → trim applied', r?.verdict === 'trim' && r?.change_status === 'applied', `${r?.title}`);
  Object.assign(db.whoop_daily.find((x) => x.date === TODAY)!, { recovery_score: 85, hrv_ms: 78, sleep_min: 470, sleep_performance: 95 });
  r = await runMorningReport(supabase, A);
  check('przeliczenie → proposal, oryginał przywrócony', r?.verdict === 'boost' && r?.change_status === 'proposed' && planHash(planNow()) === original, `${r?.title}`);
  a = await actOnMorningReport(supabase, A, 'accept');
  check('accept', a.ok && (todayDay() as { label: string }).label !== 'VO2 5×4min' && rep().change_status === 'accepted', `${a.message ?? a.error} | dziś: ${todayDay().label}`);
  a = await actOnMorningReport(supabase, A, 'revert');
  check('cofnięcie zatwierdzonej', a.ok && planHash(planNow()) === original, a.message ?? a.error);

  // 6. odciążenie, potem ręczna zmiana planu, potem nowe dane → nie ruszamy
  reset({ recovery_score: 28 });
  await runMorningReport(supabase, A);
  planNow().days[0].label = 'ręczna zmiana';
  db.whoop_daily.find((x) => x.date === TODAY)!.recovery_score = 80;
  r = await runMorningReport(supabase, A);
  check('ręczna zmiana → stale, plan nietknięty', r?.change_status === 'stale' && planNow().days[0].label === 'ręczna zmiana' && todayDay().type === 'Z1');
  a = await actOnMorningReport(supabase, A, 'revert');
  check('revert po ręcznej zmianie odmówiony', !a.ok, a.error);

  // 7. brak dzisiejszej regeneracji → brak raportu
  reset({ recovery_score: null });
  r = await runMorningReport(supabase, A);
  check('bez regeneracji brak raportu', r === null && db.morning_reports.length === 0);

  // 8. dziś już przejechane → raport bez zmian planu
  reset({ recovery_score: 20 });
  db.strava_activities = [{ athlete_id: A, activity_date: TODAY }];
  r = await runMorningReport(supabase, A);
  check('przejechane → bez zmiany', r?.verdict === 'done' && planHash(planNow()) === original);

  console.log(fails ? `\n${fails} FAIL` : '\nwszystko OK');
  process.exit(fails ? 1 : 0);
})();
