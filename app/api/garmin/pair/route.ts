import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase';
import { PAIR_TTL_SEC, deviceName, newCode, newSecret, sha256 } from '@/lib/garmin/auth';

export const dynamic = 'force-dynamic';

// Parowanie licznika Garmin z kontem VeloIQ – strona licznika (bez logowania).
//   POST → licznik prosi o kod do pokazania na ekranie: { code, device, secret, expiresIn }
//   GET ?device=&secret= → licznik pyta, czy zawodnik wpisał kod: { status: pending | ok | expired, token?, name? }
// Kod wpisuje zalogowany zawodnik w aplikacji: POST /api/garmin/pair/confirm.

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { model?: unknown; app?: unknown };
  const model = typeof body.model === 'string' ? body.model.slice(0, 40) : null;
  const app = typeof body.app === 'string' ? body.app.slice(0, 20) : null;
  const admin = createAdminSupabaseClient();

  // sprzątanie starych parowań (i prób) – tabela nie rośnie
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  await admin.from('garmin_pairings').delete().lt('expires_at', dayAgo);
  await admin.from('garmin_pair_attempts').delete().lt('at', dayAgo);

  const nowIso = new Date().toISOString();
  const secret = newSecret();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    // kod nie może się powtarzać wśród aktywnych parowań
    const { data: clash } = await admin.from('garmin_pairings').select('device').eq('code', code).gt('expires_at', nowIso).limit(1);
    if (clash?.length) continue;
    const { data, error } = await admin.from('garmin_pairings')
      .insert({ code, secret_hash: sha256(secret), model, app_version: app, expires_at: new Date(Date.now() + PAIR_TTL_SEC * 1000).toISOString() })
      .select('device').single();
    if (error || !data) {
      console.error('[garmin/pair] insert:', error?.message);
      return NextResponse.json({ error: 'server_error' }, { status: 500 });
    }
    return NextResponse.json({ code, device: data.device, secret, expiresIn: PAIR_TTL_SEC, name: deviceName(model) });
  }
  return NextResponse.json({ error: 'busy' }, { status: 503 });
}

export async function GET(req: NextRequest) {
  const device = req.nextUrl.searchParams.get('device') ?? '';
  const secret = req.nextUrl.searchParams.get('secret') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(device) || !secret || secret.length > 80) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const admin = createAdminSupabaseClient();
  const { data: p } = await admin.from('garmin_pairings')
    .select('secret_hash, user_id, token, expires_at').eq('device', device).maybeSingle();
  if (!p || p.secret_hash !== sha256(secret)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (Date.parse(p.expires_at as string) < Date.now()) return NextResponse.json({ status: 'expired' });
  if (!p.user_id || !p.token) return NextResponse.json({ status: 'pending' });
  const { data: ath } = await admin.from('athletes').select('name').eq('user_id', p.user_id).maybeSingle();
  const name = String((ath?.name as string | null) ?? '').trim().split(/\s+/)[0] ?? '';
  // token zostaje do odebrania do wygaśnięcia kodu (gdyby odpowiedź nie dotarła do licznika), potem znika razem z wierszem
  return NextResponse.json({ status: 'ok', token: p.token, name });
}
