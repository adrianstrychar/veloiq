import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { fetchPlannedDay } from '@/lib/planned-day';

// Zaplanowany dzień dla jazdy (do pierścienia realizacji) — dopasowanie po dacie, ten sam
// matcher co AI Insight (fetchPlannedDay). planned=null → brak planu / OFF / niezaplanowana.
// Ring liczony klient-side z tego + streams; endpoint tylko dostarcza cel z planu.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const stravaActivityId = params.id;
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });

  const { data: athlete } = await supabase.from('athletes').select('id').eq('user_id', user.id).single();
  if (!athlete) return NextResponse.json({ ok: false, error: 'athlete_not_found' }, { status: 404 });

  // Ownership + data jazdy (do dopasowania dnia planu)
  const { data: activity } = await supabase
    .from('strava_activities')
    .select('activity_date')
    .eq('strava_activity_id', stravaActivityId)
    .eq('athlete_id', athlete.id)
    .maybeSingle();
  if (!activity) return NextResponse.json({ ok: false, error: 'activity_not_found' }, { status: 404 });

  const planned = await fetchPlannedDay(supabase, athlete.id as string, activity.activity_date as string);
  return NextResponse.json({ ok: true, planned });
}
