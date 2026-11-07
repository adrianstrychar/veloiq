import { NextResponse, type NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { createAdminSupabaseClient } from '@/lib/supabase';
import { syncWhoop, validConn, type WhoopConnection } from '@/lib/whoop';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

// Webhook WHOOP (v2): nowa regeneracja / sen / trening → od razu dociągamy dane zawodnika.
// Podpis: base64(HMAC-SHA256(client_secret, timestamp + surowe body)) w X-WHOOP-Signature.
// WHOOP oczekuje 2xx szybko (zalecana ~1 s) – sync ma limit 3 s; jeśli nie zdąży, połączenie jest
// oznaczone jako nieświeże i dociągnie się przy najbliższym wejściu na pulpit / starcie jazdy.
export async function POST(req: NextRequest) {
  const secret = process.env.WHOOP_CLIENT_SECRET;
  const raw = await req.text();
  const sig = req.headers.get('x-whoop-signature');
  const ts = req.headers.get('x-whoop-signature-timestamp');
  if (!secret || !sig || !ts) return NextResponse.json({ ok: false }, { status: 401 });
  const expected = createHmac('sha256', secret).update(ts + raw).digest('base64');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ ok: false }, { status: 401 });
  // stare (powtórzone) zdarzenie sprzed > 1 h – ignorujemy, ale z 2xx, żeby WHOOP nie ponawiał
  if (Math.abs(Date.now() - Number(ts)) > 3600_000) return NextResponse.json({ ok: true, stale: true });

  let ev: { user_id?: number; type?: string };
  try { ev = JSON.parse(raw); } catch { return NextResponse.json({ ok: true, ignored: 'body' }); }
  if (!ev.user_id || !/^(recovery|sleep|workout)\./.test(ev.type ?? '')) return NextResponse.json({ ok: true, ignored: ev.type ?? null });

  const admin = createAdminSupabaseClient();
  const { data: conn } = await admin
    .from('whoop_connections')
    .select('athlete_id, access_token, refresh_token, expires_at, last_sync_at, sync_error')
    .eq('whoop_user_id', ev.user_id)
    .limit(1)
    .maybeSingle();
  if (!conn) return NextResponse.json({ ok: true, ignored: 'unknown_user' });

  // nieświeże → pulpit / start jazdy dociągnie, nawet jeśli sync poniżej nie zdąży
  await admin.from('whoop_connections').update({ last_sync_at: null }).eq('athlete_id', conn.athlete_id);
  // odświeżenie tokenu POZA limitem czasu – musi się zapisać (stary refresh token potem nie działa)
  let c: WhoopConnection;
  try { c = await validConn(admin, conn as WhoopConnection); } catch { return NextResponse.json({ ok: true, synced: false }); }
  const res = await Promise.race([
    syncWhoop(admin, conn.athlete_id as string, { days: 2, conn: c }).catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), 3000)),
  ]);
  return NextResponse.json({ ok: true, synced: !!res?.ok });
}
