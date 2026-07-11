import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { fetchPlannedDay } from '@/lib/planned-day';
import { mondayOfISO, localTodayISO } from '@/lib/plan';
import {
  detectOverload, classifyOverload, buildVolumeCorrection, buildIntensityCorrection,
  upsertOverloadPending, type CorrectionBuild,
} from '@/lib/overload-correction';
import type { PlanDay } from '@/lib/ai/plan-generate';

// Zaplanowany dzień dla jazdy (pierścień) + AUTO-KOREKTA po przeciążeniu: trigger 1.3×/30 TSS
// liczony przy otwarciu jazdy (moment, gdy user patrzy — TTL propozycji 12 h). Propozycja idzie
// przez pending_changes (reuse #62): tu tylko dry-run + zapis pending; plan zmienia się dopiero
// po [Zatwierdź] przez POST /api/ai/pending/[change_id]/commit. Guard taperu wewnątrz silnika.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const stravaActivityId = params.id;
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });

  const { data: athlete } = await supabase.from('athletes').select('id').eq('user_id', user.id).single();
  if (!athlete) return NextResponse.json({ ok: false, error: 'athlete_not_found' }, { status: 404 });

  // Ownership + dane jazdy do dopasowania i triggera przeciążenia.
  const { data: activity } = await supabase
    .from('strava_activities')
    .select('activity_date, tss, intensity_factor, type')
    .eq('strava_activity_id', stravaActivityId)
    .eq('athlete_id', athlete.id)
    .maybeSingle();
  if (!activity) return NextResponse.json({ ok: false, error: 'activity_not_found' }, { status: 404 });

  const planned = await fetchPlannedDay(supabase, athlete.id as string, activity.activity_date as string);

  // ── Auto-korekta: tylko gdy dzień miał plan (≠OFF) i jazda przekracza progi ──
  let correction: { change_id: string; diff: string; mode: 'volume' | 'intensity'; surplus: number } | null = null;
  let correctionNotice: string | null = null;

  const det = detectOverload(activity.tss as number | null, planned?.tss ?? null);
  if (planned && det.overload) {
    try {
      const weekStart = mondayOfISO(activity.activity_date as string);
      const todayISO = localTodayISO();

      const [{ data: planRow }, { data: raceRows }, { data: weekActs }] = await Promise.all([
        supabase.from('weekly_plans').select('id, plan_json').eq('athlete_id', athlete.id).eq('week_start', weekStart).maybeSingle(),
        supabase.from('race_calendar').select('date, priority').eq('athlete_id', athlete.id).gte('date', todayISO),
        supabase.from('strava_activities').select('activity_date').eq('athlete_id', athlete.id)
          .gte('activity_date', weekStart).lte('activity_date', activity.activity_date as string),
      ]);

      const days = ((planRow?.plan_json as { days?: PlanDay[] } | null)?.days ?? []);
      if (planRow && days.length) {
        const doneSet = new Set((weekActs ?? []).map((a) => (a.activity_date as string).slice(0, 10)));
        const isDone = (date: string) => doneSet.has(date);
        const races = (raceRows ?? []).map((r) => ({ date: r.date as string, priority: r.priority as string | null }));
        const isEbike = activity.type === 'EBikeRide';
        const mode = classifyOverload(activity.intensity_factor as number | null, planned.type, isEbike);

        const build: CorrectionBuild = mode === 'volume'
          ? buildVolumeCorrection(days, det.surplus, races, isDone, todayISO, weekStart)
          : buildIntensityCorrection(days, activity.activity_date as string, races, isDone, weekStart);

        if (build.ok) {
          const pending = await upsertOverloadPending(supabase, athlete.id as string, weekStart, planRow.plan_json, build.result);
          if (pending) correction = { change_id: pending.changeId, diff: build.diff, mode, surplus: Math.round(det.surplus) };
        } else if (build.notice) {
          correctionNotice = build.notice;
        }
      }
    } catch {
      // Korekta jest nice-to-have — jej błąd NIE psuje odpowiedzi /planned (pierścień działa dalej).
    }
  }

  return NextResponse.json({ ok: true, planned, correction, correctionNotice });
}
