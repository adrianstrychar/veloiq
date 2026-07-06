// AI chat — kanoniczne 8 narzędzi trenera (design: docs/AI_CHAT_TOOLS_DESIGN.md).
// TOOL_DEFS (schematy dla Claude) + dispatch + handlery. Wszystkie handlery scoped
// przez athleteId z sesji (nigdy z inputu modelu). Reużycie: computeReadiness,
// syncActivityDetails, helpery lib/plan.ts.
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeReadiness, type MetricRow } from '@/lib/readiness';
import { syncActivityDetails } from '@/lib/strava/details';
import { localTodayISO, mondayOfISO } from '@/lib/plan';
import { dateForDow } from '@/lib/ai/plan-generate';

// Kontekst wykonania — rozwiązany raz w route z sesji, podany do każdego handlera.
export interface ToolContext {
  supabase: SupabaseClient;
  athleteId: string;
  userId: string;
  hasPower: boolean; // has_power_meter — steruje pomijaniem watów
}

// Klient jest nietypowany (bez generyka Database), więc długie .select() dają
// GenericStringError — kształty wierszy deklarujemy ręcznie i rzutujemy (jak w reszcie repo).
interface ProfileRow {
  name: string; discipline: string | null; ftp_watts: number | null; hrmax: number | null;
  weight_kg: number | null; has_power_meter: boolean | null;
  weekly_hours_min: number | null; weekly_hours_max: number | null;
  training_days: number[] | null; current_goals: string | null; weak_points: string[] | null;
}
interface ActivitySummaryRow {
  strava_activity_id: number; activity_date: string; name: string; type: string;
  distance_km: number | null; duration_seconds: number | null; elevation_m: number | null;
  avg_watts: number | null; normalized_power: number | null; avg_hr: number | null;
  tss: number | null; intensity_factor: number | null;
}
interface ActivityDetailRow {
  strava_activity_id: number; activity_date: string; name: string; type: string;
  normalized_power: number | null; intensity_factor: number | null; max_watts: number | null;
  max_hr: number | null; best_efforts: Record<string, number | null> | null; laps: unknown;
  details_synced_at: string | null; tss: number | null;
}
interface MetricDbRow { date: string; ctl: number; atl: number; tsb: number }
interface PlanRow { week_start: string; plan_json: { days?: Array<Record<string, unknown>>; insight?: string } }
interface RaceRow { name: string; date: string; priority: string | null }
interface CheckinRow {
  week_start: string; rhr_bpm: number | null; sleep_hours: number | null; hrv: number | null;
  fatigue_score: number | null; legs_feeling: string | null; motivation: string | null; notes: string | null;
}

// ── Schematy narzędzi (wysyłane do Claude) ────────────────────────────────────
export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'get_athlete_profile',
    description:
      'Profil zawodnika: FTP, W/kg, HRmax, waga, tryb mocy/HR, godziny tygodniowe, ' +
      'dni treningowe, cel sezonu i słabe punkty. Używaj do pytań o FTP, wagę, cele, profil.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_activities',
    description:
      'Lista ostatnich jazd (podsumowania) w zakresie dat. Bez zakresu zwraca do 90 dni ' +
      'wstecz. Używaj do przeglądu wolumenu, trendu TSS, listy treningów. Po szczegóły ' +
      'jednej jazdy (laps, best efforts) użyj get_activity_detail.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Data od (YYYY-MM-DD, lokalna). Opcjonalne.' },
        to: { type: 'string', description: 'Data do (YYYY-MM-DD, lokalna). Opcjonalne.' },
        type: { type: 'string', description: 'Filtr typu jazdy (np. Ride, VirtualRide). Opcjonalne.' },
        limit: { type: 'integer', description: 'Ile jazd (domyślnie 10, max 50).' },
      },
    },
  },
  {
    name: 'get_activity_detail',
    description:
      'Szczegóły jednej jazdy: laps, best efforts (5s/1min/5min/20min), NP, IF, max moc/HR. ' +
      'Podaj strava_activity_id ALBO activity_date. Gdy >1 jazda danego dnia — bierze o ' +
      'najwyższym TSS. Dociąga dane na żywo ze Stravy, jeśli nie ma ich w cache.',
    input_schema: {
      type: 'object',
      properties: {
        strava_activity_id: { type: 'string', description: 'ID jazdy ze Stravy.' },
        activity_date: { type: 'string', description: 'Data jazdy (YYYY-MM-DD, lokalna).' },
      },
    },
  },
  {
    name: 'get_fitness_status',
    description:
      'Aktualna forma i gotowość: CTL, ATL, TSB, trend CTL/7dni oraz wskaźnik gotowości ' +
      '(raceReady%, świeżość, forma, werdykt, rada). Używaj do pytań „jaka moja forma/gotowość”, ' +
      '„czy mogę dziś mocno”.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_fitness_history',
    description:
      'Historia formy (seria CTL/ATL/TSB) do analizy trendu, rampy, szczytu. ' +
      'days: 7–180 (domyślnie 42).',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'Ile dni wstecz (7–180, domyślnie 42).' },
      },
    },
  },
  {
    name: 'get_weekly_plan',
    description:
      'Plan treningowy tygodnia: dni (typ, label, TSS, czas, strefy) + które są przeszłe/' +
      'wykonane/zablokowane, oraz insight. Bez week_start — tydzień bieżący.',
    input_schema: {
      type: 'object',
      properties: {
        week_start: { type: 'string', description: 'Poniedziałek tygodnia (YYYY-MM-DD). Opcjonalne.' },
      },
    },
  },
  {
    name: 'get_races',
    description:
      'Nadchodzące starty z kalendarza: nazwa, data, ile dni do startu, priorytet (A/B/C). ' +
      'limit domyślnie 5 (max 20).',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Ile startów (domyślnie 5, max 20).' },
      },
    },
  },
  {
    name: 'get_checkin',
    description:
      'Samopoczucie zawodnika: cotygodniowy check-in (RHR, sen, HRV, zmęczenie, nogi, ' +
      'motywacja) oraz najnowsza biometria dzienna (RHR/HRV/sen/recovery). Używaj, gdy ' +
      'pytanie dotyczy zmęczenia, snu, regeneracji, samopoczucia.',
    input_schema: { type: 'object', properties: {} },
  },
];

// ── Helpery ───────────────────────────────────────────────────────────────────
function round(n: number | null | undefined, dp = 0): number | null {
  if (n == null) return null;
  const f = 10 ** dp;
  return Math.round(Number(n) * f) / f;
}

function daysAway(dateISO: string): number {
  return Math.ceil((new Date(dateISO + 'T00:00:00Z').getTime() - Date.now()) / 86_400_000);
}

// ── Handlery ────────────────────────────────────────────────────────────────
async function getAthleteProfile(ctx: ToolContext) {
  const { data: raw } = await ctx.supabase
    .from('athletes')
    .select(
      'name, discipline, ftp_watts, hrmax, weight_kg, has_power_meter, ' +
      'weekly_hours_min, weekly_hours_max, training_days, current_goals, weak_points'
    )
    .eq('id', ctx.athleteId)
    .single();
  const data = raw as unknown as ProfileRow | null;
  if (!data) return { found: false, message: 'Brak profilu zawodnika.' };

  const wkg =
    data.ftp_watts && data.weight_kg
      ? round((data.ftp_watts as number) / Number(data.weight_kg), 1)
      : null;

  return {
    found: true,
    name: data.name,
    discipline: data.discipline,
    has_power_meter: !!data.has_power_meter,
    ftp_watts: data.ftp_watts ?? null,
    wkg,
    hrmax: data.hrmax ?? null,
    weight_kg: data.weight_kg ?? null,
    weekly_hours: { min: data.weekly_hours_min ?? null, max: data.weekly_hours_max ?? null },
    training_days: data.training_days ?? null,
    goals: data.current_goals ?? null,
    weak_points: data.weak_points ?? null,
  };
}

async function getActivities(
  ctx: ToolContext,
  input: { from?: string; to?: string; type?: string; limit?: number }
) {
  const limit = Math.min(Math.max(1, input.limit ?? 10), 50);
  let q = ctx.supabase
    .from('strava_activities')
    .select(
      'strava_activity_id, activity_date, name, type, distance_km, duration_seconds, ' +
      'elevation_m, avg_watts, normalized_power, avg_hr, tss, intensity_factor'
    )
    .eq('athlete_id', ctx.athleteId);

  if (input.from) q = q.gte('activity_date', input.from);
  if (input.to) q = q.lte('activity_date', input.to);
  if (!input.from && !input.to) {
    const cap = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    q = q.gte('activity_date', cap);
  }
  if (input.type) q = q.eq('type', input.type);

  const { data: raw } = await q.order('activity_date', { ascending: false }).limit(limit);
  const data = (raw ?? []) as unknown as ActivitySummaryRow[];

  const rides = data.map((a) => {
    const base = {
      strava_activity_id: a.strava_activity_id,
      date: a.activity_date,
      name: a.name,
      type: a.type,
      distance_km: round(a.distance_km as number, 1),
      duration_min: a.duration_seconds ? Math.round((a.duration_seconds as number) / 60) : null,
      elevation_m: a.elevation_m ?? null,
      avg_hr: a.avg_hr ?? null,
      tss: round(a.tss as number),
    };
    // Waty pomijane, gdy zawodnik trenuje bez miernika mocy.
    if (!ctx.hasPower) return base;
    return {
      ...base,
      avg_watts: a.avg_watts ?? null,
      normalized_power: a.normalized_power ?? null,
      intensity_factor: a.intensity_factor ?? null,
    };
  });

  return { count: rides.length, rides };
}

async function getActivityDetail(
  ctx: ToolContext,
  input: { strava_activity_id?: string; activity_date?: string }
) {
  // Rozwiąż jazdę: po ID lub po dacie (>1 tego dnia → najwyższy TSS).
  let q = ctx.supabase
    .from('strava_activities')
    .select(
      'strava_activity_id, activity_date, name, type, normalized_power, intensity_factor, ' +
      'max_watts, max_hr, best_efforts, laps, details_synced_at, tss'
    )
    .eq('athlete_id', ctx.athleteId);

  if (input.strava_activity_id) q = q.eq('strava_activity_id', input.strava_activity_id);
  else if (input.activity_date) q = q.eq('activity_date', input.activity_date);
  else return { found: false, message: 'Podaj strava_activity_id albo activity_date.' };

  const { data: rowsRaw } = await q.order('tss', { ascending: false }).limit(1);
  const row = (rowsRaw as unknown as ActivityDetailRow[] | null)?.[0];
  if (!row) {
    return {
      found: false,
      message:
        'Nie znalazłem takiej jazdy w danych. Zsynchronizuj Stravę (przycisk Sync na dashboardzie) i spróbuj ponownie.',
    };
  }

  const stravaId = String(row.strava_activity_id);
  let detailSource: 'cache' | 'strava_live' | 'strava_unavailable' = 'cache';
  let bestEfforts = (row.best_efforts as Record<string, number | null>) ?? {};
  let laps = row.laps as unknown;

  // Brak szczegółów w cache → dociągnij na żywo. NIGDY nie rzucaj — fail = strava_unavailable.
  if (!row.details_synced_at) {
    try {
      const res = await syncActivityDetails(ctx.supabase, stravaId, ctx.userId);
      bestEfforts = res.best_efforts ?? {};
      laps = res.laps;
      detailSource = 'strava_live';
    } catch {
      detailSource = 'strava_unavailable';
    }
  }

  return {
    found: true,
    detail_source: detailSource,
    strava_activity_id: stravaId,
    activity_date: row.activity_date,
    name: row.name,
    type: row.type,
    normalized_power: ctx.hasPower ? row.normalized_power ?? null : null,
    intensity_factor: ctx.hasPower ? row.intensity_factor ?? null : null,
    max_watts: ctx.hasPower ? row.max_watts ?? null : null,
    max_hr: row.max_hr ?? null,
    best_efforts: ctx.hasPower ? bestEfforts : {},
    laps: summarizeLaps(laps, ctx.hasPower),
  };
}

// Lapy ze Stravy to duże obiekty — zostaw tylko pola istotne dla trenera (oszczędność tokenów).
function summarizeLaps(laps: unknown, hasPower: boolean): unknown[] {
  if (!Array.isArray(laps)) return [];
  return laps.map((l: Record<string, unknown>, i) => {
    const base: Record<string, unknown> = {
      lap: (l.lap_index as number) ?? i + 1,
      distance_km: l.distance ? round((l.distance as number) / 1000, 2) : null,
      elapsed_min: l.elapsed_time ? Math.round((l.elapsed_time as number) / 60) : null,
      avg_hr: l.average_heartrate ? Math.round(l.average_heartrate as number) : null,
    };
    if (hasPower && l.average_watts) base.avg_watts = Math.round(l.average_watts as number);
    return base;
  });
}

async function getFitnessStatus(ctx: ToolContext) {
  const { data: raw } = await ctx.supabase
    .from('fitness_metrics')
    .select('date, ctl, atl, tsb')
    .eq('athlete_id', ctx.athleteId)
    .order('date', { ascending: true });

  const rows: MetricRow[] = ((raw ?? []) as unknown as MetricDbRow[]).map((r) => ({
    date: r.date,
    ctl: Number(r.ctl),
    atl: Number(r.atl),
    tsb: Number(r.tsb),
  }));
  if (rows.length === 0) {
    return { found: false, message: 'Brak metryk formy. Zsynchronizuj Stravę, aby policzyć CTL/ATL/TSB.' };
  }

  const now = rows[rows.length - 1];
  const prev = rows[Math.max(0, rows.length - 8)]; // 7 wierszy wstecz
  const readiness = computeReadiness(rows);

  return {
    found: true,
    date: now.date,
    ctl: round(now.ctl),
    atl: round(now.atl),
    tsb: round(now.tsb),
    ctl_trend_7d: round(now.ctl - prev.ctl, 1),
    readiness: readiness
      ? {
          raceReady: readiness.raceReady,
          freshPct: readiness.freshPct,
          fitnessPct: readiness.fitnessPct,
          state: readiness.state,
          advice: readiness.advice,
        }
      : null,
  };
}

async function getFitnessHistory(ctx: ToolContext, input: { days?: number }) {
  const days = Math.min(Math.max(7, input.days ?? 42), 180);
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const { data: raw } = await ctx.supabase
    .from('fitness_metrics')
    .select('date, ctl, atl, tsb')
    .eq('athlete_id', ctx.athleteId)
    .gte('date', from)
    .order('date', { ascending: true });

  let series = ((raw ?? []) as unknown as MetricDbRow[]).map((r) => ({
    date: r.date,
    ctl: round(r.ctl, 1),
    atl: round(r.atl, 1),
    tsb: round(r.tsb, 1),
  }));
  // days>60 → co 2. dzień (limit tokenów), ale zawsze zachowaj ostatni punkt.
  if (days > 60 && series.length > 0) {
    series = series.filter((_, i) => i % 2 === 0 || i === series.length - 1);
  }

  return { days, count: series.length, series };
}

async function getWeeklyPlan(ctx: ToolContext, input: { week_start?: string }) {
  const today = localTodayISO();
  const currentWeek = mondayOfISO(today);
  const weekStart = input.week_start ? mondayOfISO(input.week_start) : currentWeek;

  const { data: rowRaw } = await ctx.supabase
    .from('weekly_plans')
    .select('week_start, plan_json')
    .eq('athlete_id', ctx.athleteId)
    .eq('week_start', weekStart)
    .maybeSingle();

  const row = rowRaw as unknown as PlanRow | null;
  if (!row) {
    return { found: false, week_start: weekStart, message: 'Brak planu dla tego tygodnia.' };
  }

  const pj = row.plan_json ?? {};
  const planDays = pj.days ?? [];

  // Które daty tygodnia mają jazdę (done). activity_date jest lokalna.
  const weekEnd = dateForDow(weekStart, 7);
  const { data: acts } = await ctx.supabase
    .from('strava_activities')
    .select('activity_date')
    .eq('athlete_id', ctx.athleteId)
    .gte('activity_date', weekStart)
    .lte('activity_date', weekEnd);
  const doneDates = new Set(
    ((acts ?? []) as unknown as Array<{ activity_date: string }>).map((a) => a.activity_date)
  );

  let userMin = 0;
  const days = planDays.map((d) => {
    const dow = (d.dow as number) ?? 0;
    const date = (d.date as string) ?? dateForDow(weekStart, dow);
    const durMin = (d.dur_min as number) ?? 0;
    userMin += durMin;
    return {
      dow,
      date,
      type: d.type,
      label: d.label,
      tss: d.tss ?? 0,
      dur_min: durMin,
      zones: d.zones ?? null,
      locked: !!d.locked,
      outline: !!d.outline,
      past: date < today,
      done: doneDates.has(date),
    };
  });

  return {
    found: true,
    week_start: weekStart,
    is_current: weekStart === currentWeek,
    user_hours: round(userMin / 60, 1),
    insight: pj.insight ?? '',
    days,
  };
}

async function getRaces(ctx: ToolContext, input: { limit?: number }) {
  const limit = Math.min(Math.max(1, input.limit ?? 5), 20);
  const today = localTodayISO();
  const { data: raw } = await ctx.supabase
    .from('race_calendar')
    .select('name, date, priority')
    .eq('athlete_id', ctx.athleteId)
    .gte('date', today)
    .order('date', { ascending: true })
    .limit(limit);

  const races = ((raw ?? []) as unknown as RaceRow[]).map((r) => ({
    name: r.name,
    date: r.date,
    days_away: daysAway(r.date),
    priority: r.priority ?? null,
  }));

  return { count: races.length, races };
}

async function getCheckin(ctx: ToolContext) {
  const monday = mondayOfISO(localTodayISO());

  const { data: weekRaw } = await ctx.supabase
    .from('weekly_checkins')
    .select('week_start, rhr_bpm, sleep_hours, hrv, fatigue_score, legs_feeling, motivation, notes')
    .eq('athlete_id', ctx.athleteId)
    .gte('week_start', monday)
    .maybeSingle();
  const week = weekRaw as unknown as CheckinRow | null;

  // Biometria dzienna — tabela może być pusta; graceful null.
  let latestDaily: unknown = null;
  try {
    const { data } = await ctx.supabase
      .from('daily_biometrics')
      .select('date, rhr_bpm, hrv_ms, sleep_hours, recovery_score, energy_level, muscle_soreness, stress_level, notes')
      .eq('athlete_id', ctx.athleteId)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();
    latestDaily = data ?? null;
  } catch {
    latestDaily = null;
  }

  return { week: week ?? null, latest_daily: latestDaily };
}

// ── Dispatch ────────────────────────────────────────────────────────────────
export async function dispatchTool(
  ctx: ToolContext,
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case 'get_athlete_profile':
      return getAthleteProfile(ctx);
    case 'get_activities':
      return getActivities(ctx, input as never);
    case 'get_activity_detail':
      return getActivityDetail(ctx, input as never);
    case 'get_fitness_status':
      return getFitnessStatus(ctx);
    case 'get_fitness_history':
      return getFitnessHistory(ctx, input as never);
    case 'get_weekly_plan':
      return getWeeklyPlan(ctx, input as never);
    case 'get_races':
      return getRaces(ctx, input as never);
    case 'get_checkin':
      return getCheckin(ctx);
    default:
      throw new Error(`Nieznane narzędzie: ${name}`);
  }
}
