import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase';
import { deviceName } from '@/lib/garmin/auth';

export const dynamic = 'force-dynamic';

// Połączone liczniki Garmin zalogowanego zawodnika: lista (GET) i odłączenie (DELETE ?id=).
export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  const { data, error } = await supabase.from('garmin_devices')
    .select('id, model, app_version, created_at, last_seen_at').is('revoked_at', null).order('created_at', { ascending: false });
  // tabela jeszcze nie istnieje (migracja 026 nieuruchomiona) → karta pokaże instrukcję zamiast błędu
  if (error) return NextResponse.json({ devices: [], ready: false });
  return NextResponse.json({
    ready: true,
    devices: (data ?? []).map((d) => ({ id: d.id, name: deviceName(d.model as string | null), app: d.app_version, createdAt: d.created_at, lastSeenAt: d.last_seen_at })),
  });
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  // odłączenie = unieważnienie tokenu; licznik przy następnym zapytaniu dostanie 401 i poprosi o ponowne parowanie
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from('garmin_devices').update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
