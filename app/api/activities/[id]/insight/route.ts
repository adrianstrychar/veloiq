import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import { buildInsightPrompt, type InsightActivity, type PlannedWorkout } from '@/lib/ai/insight';
import type { DayStructure } from '@/lib/structure';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface PlanDayRow {
  dow: number;
  type: string;
  label: string;
  watt: string;
  hr: string;
  tss: number;
  dur_min: number;
  structure?: DayStructure | null;
}

// Zaplanowany trening na dzień jazdy. null = brak planu na tydzień, dzień OFF, lub jazda niezaplanowana.
async function fetchPlannedDay(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  athleteId: string,
  activityDate: string
): Promise<PlannedWorkout | null> {
  const d = new Date(activityDate + 'T00:00:00Z');
  const dow = ((d.getUTCDay() + 6) % 7) + 1; // 1=Pn … 7=Nd
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (dow - 1));
  const weekStart = monday.toISOString().slice(0, 10);

  const { data: plan } = await supabase
    .from('weekly_plans')
    .select('plan_json')
    .eq('athlete_id', athleteId)
    .eq('week_start', weekStart)
    .maybeSingle();

  const days = (plan?.plan_json as { days?: PlanDayRow[] } | null)?.days;
  const day = days?.find((x) => x.dow === dow);
  if (!day || day.type === 'OFF') return null; // brak planu / dzień wolny → ocena samodzielna
  return {
    type: day.type,
    label: day.label,
    watt: day.watt,
    hr: day.hr,
    tss: day.tss,
    dur_min: day.dur_min,
    structure: day.structure ?? null, // pełna substruktura → prompt zna przerwy z planu
  };
}

const ACTIVITY_SELECT =
  'athlete_id, name, activity_date, type, distance_km, elevation_m, duration_seconds, tss, avg_watts, avg_hr, max_hr, normalized_power, best_efforts, laps';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const stravaActivityId = params.id;

  const supabase = createServerSupabaseClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  // Pobierz jazdę
  const { data: activity } = await supabase
    .from('strava_activities')
    .select(ACTIVITY_SELECT)
    .eq('strava_activity_id', stravaActivityId)
    .maybeSingle();

  if (!activity) return NextResponse.json({ error: 'activity_not_found' }, { status: 404 });

  // Profil atlety (ownership + FTP + tryb)
  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, user_id, ftp_watts, training_mode')
    .eq('id', activity.athlete_id)
    .single();

  if (!athlete) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });
  if (athlete.user_id !== authUser.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Dopasuj zaplanowany dzień: activity_date (lokalny po #27) → poniedziałek tygodnia + dow.
  const planned = await fetchPlannedDay(
    supabase,
    athlete.id as string,
    activity.activity_date as string
  );

  const { system, user } = buildInsightPrompt(
    activity as unknown as InsightActivity,
    (athlete.ftp_watts as number | null) ?? null,
    (athlete.training_mode as string | null) ?? null,
    planned
  );

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 450,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const insight = response.content[0]?.type === 'text' ? response.content[0].text : '';
    return NextResponse.json({ insight });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
