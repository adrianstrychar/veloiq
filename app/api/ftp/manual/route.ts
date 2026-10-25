import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { setManualFtp, validFtp, FTP_MIN, FTP_MAX } from '@/lib/ftp-manual';

// Ręczne FTP (np. po przerwie silnik zaniżył próg) – przycisk „zmień” na pulpicie.
export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { ftp?: unknown };
  const ftp = validFtp(body.ftp);
  if (ftp == null) return NextResponse.json({ error: 'invalid_ftp', message: `FTP musi być między ${FTP_MIN} a ${FTP_MAX} W.` }, { status: 400 });

  const { data: athlete } = await supabase.from('athletes').select('id').eq('user_id', user.id).single();
  if (!athlete) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });
  try {
    const res = await setManualFtp(supabase, athlete.id as string, ftp);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'save_failed' }, { status: 500 });
  }
}
