import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase';
import { deviceName, newToken, sha256 } from '@/lib/garmin/auth';

export const dynamic = 'force-dynamic';

const MAX_ATTEMPTS = 8;          // prób wpisania kodu na 10 minut
const MAX_DEVICES = 5;

// Zalogowany zawodnik wpisuje kod z ekranu licznika → licznik dostaje token przypisany do tego konta.
export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { code?: unknown };
  const code = String(body.code ?? '').replace(/\D/g, '');
  if (code.length !== 6) return NextResponse.json({ ok: false, error: 'bad_code', message: 'Kod ma 6 cyfr.' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const since = new Date(Date.now() - 600_000).toISOString();
  const { count } = await admin.from('garmin_pair_attempts').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('at', since);
  if ((count ?? 0) >= MAX_ATTEMPTS) {
    return NextResponse.json({ ok: false, error: 'too_many', message: 'Za dużo prób. Spróbuj ponownie za kilka minut.' }, { status: 429 });
  }
  await admin.from('garmin_pair_attempts').insert({ user_id: user.id });

  const { data: p } = await admin.from('garmin_pairings')
    .select('device, model, app_version, user_id').eq('code', code).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (!p || p.user_id) {
    return NextResponse.json({ ok: false, error: 'not_found', message: 'Nie znam takiego kodu. Sprawdź cyfry na liczniku – kod jest ważny 10 minut.' }, { status: 404 });
  }

  const { count: have } = await admin.from('garmin_devices').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('revoked_at', null);
  if ((have ?? 0) >= MAX_DEVICES) {
    return NextResponse.json({ ok: false, error: 'too_many_devices', message: 'Masz już 5 połączonych liczników – odłącz któryś.' }, { status: 409 });
  }

  const token = newToken();
  const { error: devErr } = await admin.from('garmin_devices')
    .insert({ user_id: user.id, token_hash: sha256(token), model: p.model, app_version: p.app_version });
  if (devErr) {
    console.error('[garmin/pair/confirm] device:', devErr.message);
    return NextResponse.json({ ok: false, error: 'server_error', message: 'Nie udało się połączyć licznika.' }, { status: 500 });
  }
  // warunek user_id is null: dwa konta nie przejmą tego samego kodu
  const { data: claimed, error: upErr } = await admin.from('garmin_pairings')
    .update({ user_id: user.id, token }).eq('device', p.device).is('user_id', null).select('device');
  if (upErr || !claimed?.length) {
    await admin.from('garmin_devices').delete().eq('token_hash', sha256(token));
    return NextResponse.json({ ok: false, error: 'not_found', message: 'Kod został już użyty.' }, { status: 409 });
  }
  return NextResponse.json({ ok: true, name: deviceName(p.model as string | null) });
}
