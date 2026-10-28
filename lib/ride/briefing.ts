// Odprawa na rozgrzewce (Enzo po kilku minutach jazdy), w stylu „gotowość / kondycja” z Garmina.
// 1) Gotowość dziś — ta sama liczba co pierścień na pulpicie (PMC: forma + świeżość).
// 2) Model tętna z ostatnich jazd: HR = hrA + hrB·W (regresja po jazdach wytrzymałościowych).
//    Na rozgrzewce silnik porównuje faktyczne tętno przy danej mocy z modelem → „kondycja dziś +3”.

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeReadiness, type MetricRow } from '@/lib/readiness';
import { shiftISO, userTodayISO } from '@/lib/timezone';
import type { RideBriefing } from './workout-script';

export async function buildBriefing(supabase: SupabaseClient, athleteId: string): Promise<RideBriefing | undefined> {
  const today = userTodayISO();
  const [{ data: pmc }, { data: rides }] = await Promise.all([
    supabase.from('fitness_metrics').select('date, ctl, atl, tsb, daily_tss').eq('athlete_id', athleteId).order('date', { ascending: true }),
    supabase.from('strava_activities')
      .select('avg_watts, avg_hr, duration_seconds, intensity_factor, type')
      .eq('athlete_id', athleteId)
      .gte('activity_date', shiftISO(today, -42))
      .not('avg_watts', 'is', null).not('avg_hr', 'is', null)
      .gte('duration_seconds', 1800)
      .neq('type', 'EBikeRide')
      .limit(60),
  ]);

  const out: RideBriefing = {};
  const rows: MetricRow[] = (pmc ?? []).filter((r) => r.date <= today)
    .map((r) => ({ date: r.date as string, ctl: Number(r.ctl), atl: Number(r.atl), tsb: Number(r.tsb) }));
  const rd = computeReadiness(rows);
  if (rd) {
    out.readiness = rd.raceReady;
    out.readyColor = rd.color;
    out.readyState = rd.state;
  }
  const y = (pmc ?? []).find((r) => r.date === shiftISO(today, -1));
  if (y?.daily_tss != null) out.yTss = Math.round(Number(y.daily_tss));

  // regresja HR ~ W po jazdach wytrzymałościowych (IF < 0.85), min. 4 jazdy i rozrzut mocy ≥ 15 W
  const pts = (rides ?? [])
    .filter((r) => (r.intensity_factor == null || Number(r.intensity_factor) < 0.85) && Number(r.avg_watts) >= 80 && Number(r.avg_hr) >= 90)
    .map((r) => ({ w: Number(r.avg_watts), h: Number(r.avg_hr) }));
  if (pts.length >= 4) {
    const mw = pts.reduce((a, p) => a + p.w, 0) / pts.length;
    const mh = pts.reduce((a, p) => a + p.h, 0) / pts.length;
    const sxx = pts.reduce((a, p) => a + (p.w - mw) ** 2, 0);
    const sxy = pts.reduce((a, p) => a + (p.w - mw) * (p.h - mh), 0);
    // nachylenie w rozsądnych granicach (0,1–0,5 bpm/W); przy małym rozrzucie mocy — typowe 0,25
    let b = sxx > 0 && Math.sqrt(sxx / pts.length) >= 15 ? sxy / sxx : 0.25;
    b = Math.min(0.5, Math.max(0.1, b));
    out.hrA = Math.round((mh - b * mw) * 10) / 10;
    out.hrB = Math.round(b * 1000) / 1000;
  }
  return Object.keys(out).length ? out : undefined;
}
