import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { syncActivityStreams } from '@/lib/strava/streams';

// On-demand streams do wykresu/mapy/stref. streams_json w bazie → zwraca z bazy (zero calla
// Stravy); null → fetch + downsample + persist. Błąd fetchu NIE blokuje karty: { ok:false }
// → sekcje streams-zależne (PR2) pokażą placeholder, reszta karty działa (best_efforts/lapy/insight).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const stravaActivityId = params.id;
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });

  // Ownership: jazda należy do zalogowanego atlety
  const { data: athleteRow } = await supabase.from('athletes').select('id').eq('user_id', user.id).single();
  const { data: activity } = await supabase
    .from('strava_activities')
    .select('id')
    .eq('strava_activity_id', stravaActivityId)
    .eq('athlete_id', athleteRow?.id ?? '')
    .maybeSingle();
  if (!activity) return NextResponse.json({ ok: false, error: 'activity_not_found' }, { status: 404 });

  try {
    const { streams, bytes, cached } = await syncActivityStreams(supabase, stravaActivityId, user.id);
    return NextResponse.json({ ok: true, streams, bytes, cached });
  } catch (err: unknown) {
    // Best effort — brak streamów (403 e-bike/no-power, rate limit, sieć) nie wysadza karty.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, reason: 'streams_unavailable', message });
  }
}
