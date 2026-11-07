// Suwak godzin w planie – zapis NA STAŁE: przeskalowane dni trafiają do plan_json.days, więc „Jedź”,
// pulpit („Dziś”), kalendarz, trener w czacie, pierścień realizacji i wykrywanie przeciążenia widzą
// ten sam plan co ekran Planu. Oryginał (bazę do kolejnych ruchów suwaka) trzyma plan_json.base_days.

import type { SupabaseClient } from '@supabase/supabase-js';
import { scaleWeek, mondayOfISO, type ScalableDay } from '@/lib/plan';
import { userTodayISO, shiftISO } from '@/lib/timezone';

type PJ = { days?: ScalableDay[]; base_days?: ScalableDay[]; [k: string]: unknown };

export async function applyWeekHours(
  supabase: SupabaseClient, athleteId: string, weekStart: string, hours: number | null,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { data: row, error: e1 } = await supabase
    .from('weekly_plans').select('id, plan_json').eq('athlete_id', athleteId).eq('week_start', weekStart).maybeSingle();
  if (e1) return { ok: false, error: e1.message, status: 500 };
  if (!row) return { ok: false, error: 'plan_not_found', status: 409 };

  const pj = (row.plan_json ?? {}) as PJ;
  const base = pj.base_days ?? pj.days;
  const today = userTodayISO();
  // skalujemy tylko bieżący tydzień (tak działa suwak); inne tygodnie – sam zapis wyboru
  if (!base?.length || weekStart !== mondayOfISO(today)) {
    const { error } = await supabase.from('weekly_plans').update({ user_hours: hours }).eq('id', row.id);
    return error ? { ok: false, error: error.message, status: 500 } : { ok: true };
  }

  const { data: acts } = await supabase
    .from('strava_activities').select('activity_date')
    .eq('athlete_id', athleteId).gte('activity_date', weekStart).lte('activity_date', shiftISO(weekStart, 6));
  const done = new Set((acts ?? []).map((a) => a.activity_date as string));
  const days = hours == null ? base : scaleWeek(base, hours * 60, (d) => done.has(d), today);

  const plan_json: PJ = { ...pj, days };
  if (hours == null) delete plan_json.base_days; else plan_json.base_days = base;
  const { error } = await supabase.from('weekly_plans').update({ user_hours: hours, plan_json }).eq('id', row.id);
  if (!error) await supabase.from('athletes').update({ daily_brief_date: null }).eq('id', athleteId);   // brief dnia → świeży
  return error ? { ok: false, error: error.message, status: 500 } : { ok: true };
}
