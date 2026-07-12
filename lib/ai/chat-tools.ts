// Function calling dla czatu AI — definicje narzędzi + dispatcher + handlery.
// Model dociąga dane NA ŻĄDANIE (zamiast statycznego snapshotu w system promptcie).
// Wszystkie handlery scoped przez athleteId z sesji. Zwracają zwięzły JSON (bez raw_data).
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeReadiness, type MetricRow } from '@/lib/readiness';
import { syncActivityDetails } from '@/lib/strava/details';
import { localTodayISO, mondayOfISO } from '@/lib/plan';
import { findDiscrepancies, type MyRace } from '@/lib/race-verify';

// Brak kolumny wieku w athletes → zawodnik M19-34 (30 lat) → reguła dystansu = Gran Fondo (max zakresu).
// Zmiana progu 55+ (Medio) = tu jedna stała.
const ATHLETE_AGE = 30;

export interface ToolCtx {
  supabase: SupabaseClient;
  athleteId: string;
  userId: string;
  hasPower: boolean; // ftp_watts || has_power_meter — steruje ekspozycją watów vs HR
}

const DAY_PL: Record<number, string> = { 1: 'pon', 2: 'wt', 3: 'śr', 4: 'czw', 5: 'pt', 6: 'sob', 7: 'nd' };
const r1 = (n: number) => Math.round(n * 10) / 10;

// Data lokalna N dni wstecz jako YYYY-MM-DD (spójnie z activity_date = start_date_local).
function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Definicje narzędzi (opisy PO ANGIELSKU — lepsza trafność wyboru toola przez model) ──
export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'get_athlete_profile',
    description:
      "Get the athlete's static profile and settings: FTP (watts), power-to-weight (W/kg), HRmax, weight, discipline, weekly training hours, training days, season goals, known weak points. Use for questions about current FTP, weight, zone basis, goals, or training setup.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_activities',
    description:
      "List the athlete's completed rides from synced Strava data, most recent first. Use for 'yesterday's ride', 'last week's rides', 'my ride on <date>', or a recent training overview. Dates are the athlete's LOCAL calendar dates (YYYY-MM-DD). If no date range is given, returns the most recent rides from the last 90 days up to `limit`. Returns per-ride summary only — call get_activity_detail for laps/intervals/power curve of a single ride.",
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Inclusive start date (local YYYY-MM-DD). Omit for no lower bound.' },
        to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Inclusive end date (local YYYY-MM-DD). Omit for no upper bound.' },
        type: { type: 'string', enum: ['Ride', 'VirtualRide', 'MountainBikeRide', 'EBikeRide'], description: 'Optional filter by ride type.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10, description: 'Max rides to return.' },
      },
    },
  },
  {
    name: 'get_activity_detail',
    description:
      'Deep detail for ONE ride: laps, best power efforts (5s/1min/5min/20min power curve), normalized power, intensity factor, HR, elevation, duration. Use when the athlete asks how intervals/efforts went, power curve, or detailed analysis of a specific ride. Provide EITHER strava_activity_id (preferred, from get_activities) OR activity_date — at least one is required. Missing detail is fetched from Strava on demand.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        strava_activity_id: { type: 'integer', description: 'Strava activity id from get_activities (preferred). Provide this OR activity_date.' },
        activity_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Local date of the ride (YYYY-MM-DD). Used if strava_activity_id is not given; if multiple rides that day, the highest-TSS ride is used.' },
      },
    },
  },
  {
    name: 'get_fitness_status',
    description:
      "The athlete's CURRENT form: CTL (fitness), ATL (fatigue), TSB (freshness/form), 7-day CTL trend, plus computed readiness (race-readiness %, freshness %, verdict, advice). Use for 'how's my form', 'am I fresh', 'should I go hard today', TSB/CTL questions.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_fitness_history',
    description:
      'Daily CTL/ATL/TSB history for the last N days. Use to describe how fitness/fatigue/form TRENDED over time, ramp rate, or to compare weeks.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { days: { type: 'integer', minimum: 7, maximum: 180, default: 42, description: 'How many days back.' } },
    },
  },
  {
    name: 'get_weekly_plan',
    description:
      "The athlete's training plan for a week: each day's workout type, label, target TSS, duration, zones, plus the week's AI insight, chosen weekly hours, and a `completion` object. Use for 'plan this week', 'what's on Thursday', 'how much training is left', 'am I keeping up with the plan'. `completion` (sessions_done_to_date / sessions_due_to_date / sessions_completion_pct) measures whether PLANNED SESSIONS HAPPENED (a ride on a planned day counts as done), NOT whether the athlete hit the planned load — riding harder/longer than planned still counts as done. Say \"you did X of Y sessions\", NEVER \"you completed X% of your load\". week_start is the Monday (local YYYY-MM-DD); omit for the current week.",
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { week_start: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Monday of the target week (local YYYY-MM-DD). Omit for current week.' } },
    },
  },
  {
    name: 'get_races',
    description:
      "The athlete's races from the calendar (race_id, name, date, days-away, priority, series), soonest first. Use for 'next race', 'days until <race>', race-prep timing, and to get the race_id needed to edit or delete a race. By default only upcoming races; set include_past to also list past races (e.g. to delete an old one).",
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
        include_past: { type: 'boolean', description: 'Include past races too (default false). Use when the athlete wants to delete/clean up an old race.' },
      },
    },
  },
  {
    name: 'get_checkin',
    description:
      "Latest wellness/recovery: this week's check-in (resting HR, sleep, HRV, fatigue score, legs feeling, motivation, notes) and the most recent daily biometrics (RHR, HRV, sleep, recovery score). Use for 'how's my recovery', 'did I sleep enough', RHR/HRV/fatigue questions.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'check_race_calendar',
    description:
      "Verify the athlete's races against the curated OFFICIAL UCI calendars (gravel + granfondo/road) — checks dates and distances. READ-ONLY: it reports discrepancies, it NEVER writes. Use when the athlete asks to check/verify/confirm their race calendar against official sources (e.g. 'sprawdź daty moich startów'). To fix a reported discrepancy, propose the correction with propose_race_change (per race, each needs the athlete's explicit confirmation).",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

// ── Handlery ──────────────────────────────────────────────────────────────────

async function getAthleteProfile({ supabase, athleteId }: ToolCtx) {
  const { data: a } = await supabase
    .from('athletes')
    .select('name, discipline, ftp_watts, hrmax, weight_kg, has_power_meter, weekly_hours_min, weekly_hours_max, training_days, long_ride_days, current_goals, weak_points')
    .eq('id', athleteId)
    .single();
  if (!a) return { found: false, message: 'Brak profilu zawodnika.' };
  const wkg = a.ftp_watts && a.weight_kg ? r1(Number(a.ftp_watts) / Number(a.weight_kg)) : null;
  return {
    name: a.name,
    discipline: a.discipline,
    ftp_watts: a.ftp_watts ?? null,
    wkg,
    hrmax: a.hrmax ?? null,
    weight_kg: a.weight_kg ?? null,
    has_power_meter: !!(a.ftp_watts || a.has_power_meter),
    weekly_hours: [a.weekly_hours_min ?? null, a.weekly_hours_max ?? null],
    training_days: (a.training_days as number[] | null)?.map((d) => DAY_PL[d]) ?? null,
    long_ride_days: (a.long_ride_days as number[] | null)?.map((d) => DAY_PL[d]) ?? null,
    goals: a.current_goals ?? null,
    weak_points: a.weak_points ?? null,
  };
}

async function getActivities({ supabase, athleteId, hasPower }: ToolCtx, input: Record<string, unknown>) {
  const from = typeof input.from === 'string' ? input.from : undefined;
  const to = typeof input.to === 'string' ? input.to : undefined;
  const type = typeof input.type === 'string' ? input.type : undefined;
  const limit = Math.min(Number(input.limit) || 10, 50);

  let q = supabase
    .from('strava_activities')
    .select('strava_activity_id, activity_date, name, type, distance_km, duration_seconds, elevation_m, avg_watts, normalized_power, avg_hr, tss, intensity_factor')
    .eq('athlete_id', athleteId)
    .order('activity_date', { ascending: false })
    .limit(limit);
  if (from) q = q.gte('activity_date', from);
  if (to) q = q.lte('activity_date', to);
  if (!from && !to) q = q.gte('activity_date', daysAgoISO(90)); // domyślny cap 90 dni
  if (type) q = q.eq('type', type);

  const { data } = await q;
  const activities = (data ?? []).map((a) => ({
    strava_activity_id: a.strava_activity_id,
    date: a.activity_date,
    name: a.name,
    type: a.type,
    distance_km: a.distance_km,
    duration_min: a.duration_seconds != null ? Math.round(a.duration_seconds / 60) : null,
    elevation_m: a.elevation_m ?? null,
    ...(hasPower ? { avg_watts: a.avg_watts ?? null, normalized_power: a.normalized_power ?? null } : { avg_hr: a.avg_hr ?? null }),
    avg_hr: a.avg_hr ?? null,
    tss: a.tss != null ? Math.round(a.tss) : null,
    intensity_factor: a.intensity_factor ?? null,
  }));
  return { count: activities.length, activities };
}

function trimLaps(laps: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(laps)) return null;
  return laps.map((l, i) => ({
    i: i + 1,
    min: l?.elapsed_time != null ? Math.round(l.elapsed_time / 60) : null,
    km: l?.distance != null ? r1(l.distance / 1000) : null,
    avg_watts: l?.average_watts != null ? Math.round(l.average_watts) : null,
    avg_hr: l?.average_heartrate != null ? Math.round(l.average_heartrate) : null,
  }));
}

async function getActivityDetail({ supabase, athleteId, userId }: ToolCtx, input: Record<string, unknown>) {
  const sid = input.strava_activity_id != null ? Number(input.strava_activity_id) : undefined;
  const date = typeof input.activity_date === 'string' ? input.activity_date : undefined;
  const SEL = 'strava_activity_id, activity_date, name, type, distance_km, duration_seconds, elevation_m, avg_watts, max_watts, normalized_power, avg_hr, max_hr, tss, intensity_factor, laps, best_efforts, pr_efforts, calories, details_synced_at';

  let row: Record<string, unknown> | null = null;
  if (sid != null && !Number.isNaN(sid)) {
    const { data } = await supabase.from('strava_activities').select(SEL).eq('athlete_id', athleteId).eq('strava_activity_id', sid).maybeSingle();
    row = data;
  } else if (date) {
    const { data } = await supabase.from('strava_activities').select(SEL).eq('athlete_id', athleteId).eq('activity_date', date).order('tss', { ascending: false }).limit(1).maybeSingle();
    row = data;
  }
  if (!row) {
    const crit = sid ? `id ${sid}` : `datę ${date}`;
    return { found: false, message: `Nie ma zsynchronizowanej jazdy dla ${crit}. Zsynchronizuj Stravę, żebym mógł ją przeanalizować.` };
  }

  let laps = row.laps;
  let best_efforts = row.best_efforts;
  let pr_efforts = row.pr_efforts;
  let calories = row.calories;
  let detail_source: string = 'cache';
  let note: string | undefined;
  if (!row.details_synced_at) {
    try {
      const res = await syncActivityDetails(supabase, String(row.strava_activity_id), userId);
      laps = res.laps;
      best_efforts = res.best_efforts;
      pr_efforts = res.pr_efforts;
      calories = res.calories;
      detail_source = 'strava_live';
    } catch {
      detail_source = 'strava_unavailable';
      note = 'Szczegóły ze Stravy chwilowo niedostępne — podaję metryki podstawowe.';
    }
  }

  return {
    found: true,
    strava_activity_id: row.strava_activity_id,
    date: row.activity_date,
    name: row.name,
    type: row.type,
    distance_km: row.distance_km,
    duration_min: row.duration_seconds != null ? Math.round((row.duration_seconds as number) / 60) : null,
    elevation_m: row.elevation_m ?? null,
    avg_watts: row.avg_watts ?? null,
    normalized_power: row.normalized_power ?? null,
    max_watts: row.max_watts ?? null,
    avg_hr: row.avg_hr ?? null,
    max_hr: row.max_hr ?? null,
    tss: row.tss != null ? Math.round(row.tss as number) : null,
    intensity_factor: row.intensity_factor ?? null,
    calories: calories ?? null,
    best_efforts: best_efforts ?? null,
    pr_efforts: pr_efforts ?? null, // rekordy segmentów (pr_rank≠null) — [] = przetworzone bez PR, null = niepobrane
    laps: trimLaps(laps),
    detail_source,
    ...(note ? { note } : {}),
  };
}

async function getFitnessStatus({ supabase, athleteId }: ToolCtx) {
  const { data: rows } = await supabase.from('fitness_metrics').select('date, ctl, atl, tsb').eq('athlete_id', athleteId).order('date', { ascending: true });
  if (!rows || rows.length === 0) return { found: false, message: 'Brak danych formy — zsynchronizuj Stravę, żeby policzyć CTL/ATL/TSB.' };
  const now = rows[rows.length - 1];
  const weekAgo = rows[Math.max(0, rows.length - 8)];
  const readiness = computeReadiness(rows as MetricRow[]);
  return {
    date: now.date,
    ctl: Math.round(now.ctl),
    atl: Math.round(now.atl),
    tsb: Math.round(now.tsb),
    ctl_trend_7d: r1(now.ctl - weekAgo.ctl),
    readiness: readiness
      ? { raceReady: readiness.raceReady, freshPct: readiness.freshPct, fitnessPct: readiness.fitnessPct, state: readiness.state, advice: readiness.advice }
      : null,
  };
}

async function getFitnessHistory({ supabase, athleteId }: ToolCtx, input: Record<string, unknown>) {
  const days = Math.min(Math.max(Number(input.days) || 42, 7), 180);
  const { data: rows } = await supabase.from('fitness_metrics').select('date, ctl, atl, tsb').eq('athlete_id', athleteId).gte('date', daysAgoISO(days)).order('date', { ascending: true });
  let series = (rows ?? []).map((d) => ({ date: d.date, ctl: Math.round(d.ctl), atl: Math.round(d.atl), tsb: Math.round(d.tsb) }));
  const every = days > 60 ? 2 : 1; // próbkowanie co 2. dzień dla długich okien
  if (every === 2) series = series.filter((_, i) => i % 2 === 0);
  return { days, sampled_every: every, count: series.length, series };
}

async function getWeeklyPlan({ supabase, athleteId }: ToolCtx, input: Record<string, unknown>) {
  const today = localTodayISO();
  const ws = typeof input.week_start === 'string' ? input.week_start : mondayOfISO(today);
  const { data: r } = await supabase.from('weekly_plans').select('week_start, plan_json, user_hours').eq('athlete_id', athleteId).eq('week_start', ws).maybeSingle();
  if (!r) return { found: false, week_start: ws, message: `Brak planu na tydzień od ${ws}. Możesz go wygenerować w widoku Plan.` };

  const planDays = (r.plan_json as { days?: Array<Record<string, unknown>>; insight?: string })?.days ?? [];
  const dates = planDays.map((d) => d.date as string);
  const { data: acts } = await supabase.from('strava_activities').select('activity_date').eq('athlete_id', athleteId).in('activity_date', dates);
  const doneDates = new Set((acts ?? []).map((a) => a.activity_date));

  const days = planDays.map((d) => ({
    dow: d.dow,
    date: d.date,
    type: d.type,
    label: d.label,
    tss: d.tss,
    dur_min: d.dur_min,
    zones: d.zones,
    locked: !!d.locked,
    outline: !!d.outline,
    past: (d.date as string) < today,
    done: doneDates.has(d.date as string),
  }));

  // Realizacja sesji do teraz — TANI wariant z flag past/done + zaplanowanego tss (bez streams).
  // Dni treningowe minione (typ≠OFF) = "należne"; z jazdą tego dnia = "odbyte". Ważone
  // zaplanowanym TSS. MIERZY, czy sesje się ODBYŁY, NIE czy trafiłeś w obciążenie.
  const dueDays = days.filter((d) => d.past && d.type !== 'OFF');
  const doneDoneDays = dueDays.filter((d) => d.done);
  const tssDue = dueDays.reduce((a, d) => a + ((d.tss as number) || 0), 0);
  const tssDone = doneDoneDays.reduce((a, d) => a + ((d.tss as number) || 0), 0);
  const completion = {
    sessions_due_to_date: dueDays.length,
    sessions_done_to_date: doneDoneDays.length,
    tss_planned_to_date: tssDue,
    tss_of_done_sessions: tssDone,
    // Odsetek zaplanowanych sesji odbytych do teraz (wg zaplanowanego TSS). NIE mów
    // "zrealizowałeś X% planu/obciążenia" (sugeruje jakość) — tylko "odbyłeś X z Y sesji".
    sessions_completion_pct: tssDue > 0 ? Math.round((tssDone / tssDue) * 100) : null,
  };

  return {
    week_start: r.week_start,
    is_current: r.week_start === mondayOfISO(today),
    user_hours: r.user_hours ?? null,
    insight: (r.plan_json as { insight?: string })?.insight ?? null,
    completion,
    days,
  };
}

async function getRaces({ supabase, athleteId }: ToolCtx, input: Record<string, unknown>) {
  const limit = Math.min(Number(input.limit) || 5, 20);
  const includePast = input.include_past === true;
  const today = localTodayISO();
  let q = supabase.from('race_calendar').select('id, name, date, priority, series').eq('athlete_id', athleteId).order('date', { ascending: true }).limit(limit);
  if (!includePast) q = q.gte('date', today);
  const { data } = await q;
  const races = (data ?? []).map((r) => ({
    race_id: r.id, // potrzebne do edycji/usunięcia startu (propose_race_change)
    name: r.name,
    date: r.date,
    days_away: Math.ceil((new Date(r.date + 'T12:00:00Z').getTime() - new Date(today + 'T12:00:00Z').getTime()) / 86400000),
    priority: r.priority,
    series: r.series ?? null,
  }));
  return { count: races.length, races };
}

async function getCheckin({ supabase, athleteId }: ToolCtx) {
  const monday = mondayOfISO(localTodayISO());
  const [{ data: week }, { data: daily }] = await Promise.all([
    supabase.from('weekly_checkins').select('week_start, rhr_bpm, sleep_hours, hrv, fatigue_score, legs_feeling, motivation, notes').eq('athlete_id', athleteId).gte('week_start', monday).maybeSingle(),
    supabase.from('daily_biometrics').select('date, rhr_bpm, hrv_ms, sleep_hours, recovery_score').eq('athlete_id', athleteId).order('date', { ascending: false }).limit(1).maybeSingle(),
  ]);
  return { week: week ?? null, latest_daily: daily ?? null };
}

// READ-ONLY weryfikacja startów względem oficjalnych kalendarzy UCI. NIE zapisuje nic —
// poprawki idą przez propose_race_change (PROPOSE NOT PERSIST). Zwraca rozjazdy po polsku.
async function checkRaceCalendar({ supabase, athleteId }: ToolCtx) {
  const { data } = await supabase
    .from('race_calendar')
    .select('id, name, date, distance_km, location')
    .eq('athlete_id', athleteId)
    .order('date', { ascending: true });
  const mine: MyRace[] = (data ?? []).map((r) => ({
    race_id: r.id as string,
    name: r.name as string,
    date: r.date as string,
    distance_km: (r.distance_km as number | null) ?? null,
    location: (r.location as string | null) ?? null,
  }));
  if (mine.length === 0) return { checked: 0, matched: 0, discrepancies: [], errors: [], message: 'Nie masz żadnych startów w kalendarzu do sprawdzenia.' };

  const { checked, matched, discrepancies, errors } = await findDiscrepancies(mine, ATHLETE_AGE);
  return {
    checked,
    matched,
    discrepancies: discrepancies.map((d) => ({
      race_id: d.race_id,
      race_name: d.race_name,
      field: d.field === 'date' ? 'data' : 'dystans',
      moja_wartosc: d.mine,
      oficjalna_wartosc: d.official,
      zrodlo_url: d.source_url,
    })),
    errors,
    note: 'To weryfikacja read-only — niczego nie zapisałem. Aby poprawić rozjazd, zaproponuj zmianę przez propose_race_change (osobno per start, każda z potwierdzeniem usera).',
  };
}

// ── Dispatcher ──────────────────────────────────────────────────────────────────
export async function dispatch(name: string, input: Record<string, unknown>, ctx: ToolCtx): Promise<unknown> {
  switch (name) {
    case 'get_athlete_profile': return getAthleteProfile(ctx);
    case 'get_activities': return getActivities(ctx, input);
    case 'get_activity_detail': return getActivityDetail(ctx, input);
    case 'get_fitness_status': return getFitnessStatus(ctx);
    case 'get_fitness_history': return getFitnessHistory(ctx, input);
    case 'get_weekly_plan': return getWeeklyPlan(ctx, input);
    case 'get_races': return getRaces(ctx, input);
    case 'get_checkin': return getCheckin(ctx);
    case 'check_race_calendar': return checkRaceCalendar(ctx);
    default: throw new Error(`unknown tool: ${name}`);
  }
}
