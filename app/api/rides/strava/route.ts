import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { refreshStravaToken } from '@/lib/strava';
import { buildTcx } from '@/lib/ride/tcx';
import { veloiqActivityId } from '@/lib/ride/import-rides';
import { syncStravaActivities, recalculateFitnessMetrics } from '@/lib/sync';
import type { SavedSample } from '@/lib/ride/save-ride';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const hasWriteScope = (scope: string | null | undefined) => !!scope && scope.split(',').map((s) => s.trim()).includes('activity:write');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Eksport jazdy nagranej w VeloIQ na Stravę (TCX: GPS, moc, tętno, kadencja). Po sukcesie jazda z VeloIQ
// zostaje zastąpiona aktywnością ze Stravy przy najbliższej synchronizacji (bez duplikatu na liście).
export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  const { rideId } = (await req.json().catch(() => ({}))) as { rideId?: string };

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, strava_id, ftp_watts, hrmax, strava_scope, strava_access_token, strava_refresh_token, strava_token_expires_at')
    .eq('user_id', user.id).single();
  if (!athlete?.strava_access_token) return NextResponse.json({ error: 'no_strava', message: 'Konto nie jest połączone ze Stravą.' }, { status: 400 });
  if (!hasWriteScope(athlete.strava_scope as string | null)) {
    return NextResponse.json({ error: 'no_scope', message: 'Strava nie pozwala na zapis. Wyloguj się i zaloguj ponownie przez Stravę, zaznaczając zgodę na przesyłanie aktywności.' }, { status: 403 });
  }

  // jazda: wskazana albo ostatnia z telefonu
  const base = () => supabase.from('rides').select('id, started_at, outdoor, workout_name, kj, samples_path, source').eq('user_id', user.id);
  const { data: rows } = rideId
    ? await base().eq('id', rideId).limit(1)
    : await base().order('started_at', { ascending: false }).limit(1);
  const ride = rows?.[0];
  if (!ride) return NextResponse.json({ error: 'no_ride', message: 'Nie znalazłem zapisanej jazdy.' }, { status: 404 });
  const src = String(ride.source ?? '');
  const done = /:strava:(\d+)$/.exec(src);
  if (done) return NextResponse.json({ ok: true, already: true, activityId: Number(done[1]), url: `https://www.strava.com/activities/${done[1]}` });

  const file = await supabase.storage.from('rides').download(ride.samples_path as string);
  if (file.error || !file.data) return NextResponse.json({ error: 'no_samples', message: 'Brak zapisu sekundowego tej jazdy.' }, { status: 404 });
  const samples = (await file.data.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as SavedSample);
  if (samples.length < 60) return NextResponse.json({ error: 'too_short', message: 'Jazda jest za krótka na Stravę.' }, { status: 400 });

  let token = athlete.strava_access_token as string;
  const exp = athlete.strava_token_expires_at ? new Date(athlete.strava_token_expires_at as string).getTime() : 0;
  if (exp < Date.now() + 60_000) {
    const r = await refreshStravaToken(athlete.strava_refresh_token as string);
    token = r.access_token;
    await supabase.from('athletes').update({
      strava_access_token: r.access_token, strava_refresh_token: r.refresh_token,
      strava_token_expires_at: new Date(r.expires_at * 1000).toISOString(),
    }).eq('id', athlete.id);
  }

  const name = (ride.workout_name as string | null) || 'Jazda';
  const tcx = buildTcx({ startedAt: ride.started_at as string, samples, name, kJ: ride.kj as number | null });
  const form = new FormData();
  form.append('file', new Blob([tcx], { type: 'application/xml' }), `veloiq-${ride.id}.tcx`);
  form.append('data_type', 'tcx');
  form.append('name', name);
  form.append('description', 'Nagrane w VeloIQ · prowadził Dyrektor Enzo');
  form.append('trainer', ride.outdoor ? '0' : '1');
  form.append('external_id', `veloiq-${ride.id}`);
  const up = await fetch('https://www.strava.com/api/v3/uploads', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const upJ = (await up.json().catch(() => ({}))) as { id?: number; error?: string | null; activity_id?: number | null };
  if (!up.ok || !upJ.id) {
    return NextResponse.json({ error: 'upload_failed', message: `Strava odrzuciła plik (${up.status}).` }, { status: 502 });
  }

  // Strava przetwarza plik kilka sekund
  let activityId: number | null = upJ.activity_id ?? null;
  let err: string | null = upJ.error ?? null;
  for (let i = 0; i < 12 && !activityId && !err; i++) {
    await sleep(2000);
    const st = await fetch(`https://www.strava.com/api/v3/uploads/${upJ.id}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = (await st.json().catch(() => ({}))) as { error?: string | null; activity_id?: number | null };
    activityId = j.activity_id ?? null; err = j.error ?? null;
  }
  if (!activityId && err) {
    const dup = /duplicate of .*?(\d{6,})/i.exec(err);    // już jest na Stravie (np. z Garmina) – traktujemy jak sukces
    if (dup) activityId = Number(dup[1]);
    else return NextResponse.json({ error: 'processing_failed', message: `Strava: ${err}` }, { status: 502 });
  }
  if (!activityId) return NextResponse.json({ ok: true, pending: true, message: 'Wysłano – Strava jeszcze przetwarza jazdę.' });

  // oznacz jazdę jako wysłaną; wpis VeloIQ zastąpi aktywność ze Stravy przy synchronizacji
  await supabase.from('rides').update({ source: `${src}:strava:${activityId}` }).eq('id', ride.id);
  const localId = veloiqActivityId(ride.started_at as string);
  const { data: local } = await supabase.from('strava_activities').select('raw_data').eq('strava_activity_id', localId).maybeSingle();
  if (local) {
    await supabase.from('strava_activities')
      .update({ raw_data: { ...(local.raw_data as object), uploaded_as: activityId } })
      .eq('strava_activity_id', localId).eq('athlete_id', athlete.id);
  }
  try {
    const r = await syncStravaActivities(supabase, athlete as never, { skipCooldown: true });
    if (!r.skipped) await recalculateFitnessMetrics(supabase, athlete.id as string);
  } catch (e) { console.error('[rides/strava] sync po wysyłce:', e instanceof Error ? e.message : e); }

  return NextResponse.json({ ok: true, activityId, url: `https://www.strava.com/activities/${activityId}` });
}
