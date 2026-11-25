import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Stan wysyłki jazdy z licznika Garmin – dla telefonu po końcu jazdy w trybie lustra (sesja użytkownika).
//   GET ?key=<start jazdy, epoch s>
//   → { state: 'waiting' }                         licznik jeszcze nic nie wysłał
//   → { state: 'uploading', got, total }          paczki w drodze
//   → { state: 'done', rideId, stravaId? }        jazda w VeloIQ (stravaId – jeśli jest już na Stravie)
//   GET ?latest=1 – ostatnia jazda z licznika z 12 h (karta „jazda jest w VeloIQ” także wtedy, gdy most do telefonu
//   nie działał): { state: 'none' } | { state: 'uploading', key, got, total } | { state: 'done', key, rideId, stravaId? }
export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  const admin = createAdminSupabaseClient();
  const done = async (rideId: string, extra: Record<string, unknown> = {}) => {
    const { data: ride } = await admin.from('rides').select('source').eq('id', rideId).maybeSingle();
    const m = /:strava:(\d+)$/.exec(String(ride?.source ?? ''));
    return NextResponse.json({ state: 'done', rideId, ...extra, ...(m ? { stravaId: Number(m[1]) } : {}) });
  };

  if (req.nextUrl.searchParams.get('latest') === '1') {
    const since = Math.floor(Date.now() / 1000) - 12 * 3600;
    const { data: ups } = await admin.from('garmin_uploads').select('ride_key, ride_id, ns, ng')
      .eq('user_id', user.id).gte('ride_key', since).order('ride_key', { ascending: false }).limit(1);
    const up = ups?.[0];
    if (!up) return NextResponse.json({ state: 'none' });
    const k = Number(up.ride_key);
    if (up.ride_id) return done(up.ride_id as string, { key: k });
    const { count } = await admin.from('garmin_upload_chunks').select('seq', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('ride_key', k);
    return NextResponse.json({ state: 'uploading', key: k, got: count ?? 0, total: Number(up.ns ?? 0) + Number(up.ng ?? 0) });
  }

  const key = Number(req.nextUrl.searchParams.get('key'));
  if (!Number.isInteger(key) || key <= 0) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const { data: up } = await admin.from('garmin_uploads').select('ride_id, ns, ng')
    .eq('user_id', user.id).eq('ride_key', key).maybeSingle();
  if (up?.ride_id) return done(up.ride_id as string);
  if (up) {
    const { count } = await admin.from('garmin_upload_chunks').select('seq', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('ride_key', key);
    return NextResponse.json({ state: 'uploading', got: count ?? 0, total: Number(up.ns ?? 0) + Number(up.ng ?? 0) });
  }
  // złożona wcześniej (wpis wysyłki mógł zniknąć) – jazda z tą godziną startu
  const { data: ride } = await admin.from('rides').select('id')
    .eq('user_id', user.id).eq('started_at', new Date(key * 1000).toISOString()).like('source', 'veloiq-garmin%').maybeSingle();
  if (ride?.id) return done(ride.id as string);
  return NextResponse.json({ state: 'waiting' });
}
