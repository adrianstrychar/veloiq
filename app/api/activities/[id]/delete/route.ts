import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { recalculateFitnessMetrics, recalculateFtpEstimate, recalculateVo2Estimate } from '@/lib/sync';

// Usunięcie treningu z VeloIQ.
// - Jazda nagrana w VeloIQ (id < 0): znika aktywność, wiersz `rides` i zapis 1 Hz ze Storage.
// - Aktywność ze Stravy (id > 0): znika z VeloIQ i trafia do `deleted_activities`, żeby synchronizacja
//   jej nie przywróciła (na Stravie zostaje – tam usuwa się ją w Stravie). Jeśli była do niej podpięta
//   jazda z telefonu (dubel scalony automatycznie), ona też jest usuwana.
// Po usunięciu: przeliczenie formy (CTL/ATL/TSB), FTP i VO2.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id === 0) return NextResponse.json({ ok: false, error: 'Nieprawidłowy trening.' }, { status: 400 });

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });
  const { data: athlete } = await supabase.from('athletes').select('id').eq('user_id', user.id).single();
  if (!athlete) return NextResponse.json({ ok: false, error: 'athlete_not_found' }, { status: 404 });
  const athleteId = athlete.id as string;

  const { data: act } = await supabase
    .from('strava_activities')
    .select('strava_activity_id, ride_id:raw_data->>veloiq_ride_id')
    .eq('athlete_id', athleteId).eq('strava_activity_id', id).maybeSingle();
  if (!act) return NextResponse.json({ ok: false, error: 'Nie znalazłem tego treningu.' }, { status: 404 });

  if (id > 0) {
    // najpierw „nagrobek” – bez niego aktywność wróciłaby przy najbliższej synchronizacji
    const { error: tombErr } = await supabase.from('deleted_activities').upsert({ athlete_id: athleteId, strava_activity_id: id });
    if (tombErr) {
      const missing = /deleted_activities|does not exist|schema cache/i.test(tombErr.message);
      return NextResponse.json({
        ok: false,
        error: missing
          ? 'Usuwanie aktywności ze Stravy wymaga migracji 023_deleted_activities.sql w Supabase Studio.'
          : `Nie udało się usunąć: ${tombErr.message}`,
      }, { status: missing ? 409 : 500 });
    }
  }

  // jazda z telefonu (własna albo podpięta pod aktywność ze Stravy)
  const rideId = (act.ride_id as string | null) ?? null;
  if (rideId) {
    const { data: ride } = await supabase.from('rides').select('id, samples_path').eq('id', rideId).eq('user_id', user.id).maybeSingle();
    if (ride) {
      if (ride.samples_path) await supabase.storage.from('rides').remove([ride.samples_path as string]);
      await supabase.from('rides').delete().eq('id', ride.id);
    }
  }

  const { error } = await supabase.from('strava_activities').delete().eq('athlete_id', athleteId).eq('strava_activity_id', id);
  if (error) return NextResponse.json({ ok: false, error: `Nie udało się usunąć: ${error.message}` }, { status: 500 });

  await recalculateFitnessMetrics(supabase, athleteId).catch(() => {});
  await recalculateFtpEstimate(supabase, athleteId).catch(() => {});
  await recalculateVo2Estimate(supabase, athleteId).catch(() => {});

  return NextResponse.json({
    ok: true,
    message: id > 0 ? 'Trening usunięty z VeloIQ (na Stravie zostaje).' : 'Trening usunięty.',
  });
}
