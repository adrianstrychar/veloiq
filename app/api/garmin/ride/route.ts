import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase';
import { verifyDevice } from '@/lib/garmin/auth';
import { MAX_CHUNKS, MAX_CHUNK_B64, assembleRide, cleanSummary } from '@/lib/garmin/ride';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Wysyłka jazdy z licznika, w krokach (łącze przez telefon jest wolne, a jedna prośba ma mały limit rozmiaru):
//   { op: "begin",  key, summary, extra, ns, ng }   – podsumowanie + ile paczek przyjdzie
//   { op: "chunk",  key, kind: "s" | "g", seq, data } – paczka próbek / śladu GPS (base64)
//   { op: "finish", key }                            – złożenie jazdy w `rides` i na liście aktywności
// `key` = początek jazdy (epoch s). Każdy krok można bezpiecznie powtórzyć.
export async function POST(req: NextRequest) {
  const admin = createAdminSupabaseClient();
  const dev = await verifyDevice(admin, req.headers.get('authorization'));
  if (!dev) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const key = Number(body?.key);
  if (!body || !Number.isInteger(key) || key <= 0) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  if (body.op === 'begin') {
    const ns = Number(body.ns), ng = Number(body.ng);
    if (!Number.isInteger(ns) || !Number.isInteger(ng) || ns < 0 || ng < 0 || ns > MAX_CHUNKS || ng > MAX_CHUNKS) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }
    if (!cleanSummary(body.summary, key)) return NextResponse.json({ error: 'bad_summary' }, { status: 400 });
    const { data: have } = await admin.from('garmin_uploads').select('ride_id').eq('user_id', dev.userId).eq('ride_key', key).maybeSingle();
    if (have?.ride_id) return NextResponse.json({ ok: true, done: true });   // ta jazda jest już w VeloIQ
    const { error } = await admin.from('garmin_uploads')
      .upsert({ user_id: dev.userId, ride_key: key, summary: body.summary, extra: body.extra ?? null, ns, ng }, { onConflict: 'user_id,ride_key' });
    if (error) {
      console.error('[garmin/ride] begin:', error.message);
      return NextResponse.json({ error: 'server_error' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.op === 'chunk') {
    const kind = body.kind === 'g' ? 'g' : body.kind === 's' ? 's' : null;
    const seq = Number(body.seq);
    const data = typeof body.data === 'string' ? body.data : null;
    if (!kind || !Number.isInteger(seq) || seq < 0 || seq >= MAX_CHUNKS || data == null || data.length > MAX_CHUNK_B64 || !/^[A-Za-z0-9+/=]*$/.test(data)) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }
    const { error } = await admin.from('garmin_upload_chunks')
      .upsert({ user_id: dev.userId, ride_key: key, kind, seq, data }, { onConflict: 'user_id,ride_key,kind,seq' });
    if (error) {
      // brak „begin” (klucz obcy) albo błąd bazy – licznik zacznie wysyłkę od nowa przy następnej próbie
      console.error('[garmin/ride] chunk:', error.message);
      return NextResponse.json({ error: 'server_error' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.op === 'finish') {
    const res = await assembleRide(admin, dev.userId, key);
    if (!res.ok) {
      console.error('[garmin/ride] finish:', res.error);
      return NextResponse.json({ error: res.error ?? 'server_error' }, { status: res.error === 'unknown_ride' || res.error === 'missing_chunks' ? 409 : 500 });
    }
    return NextResponse.json({ ok: true, rideId: res.rideId, added: res.added ?? 0 });
  }

  return NextResponse.json({ error: 'bad_request' }, { status: 400 });
}
