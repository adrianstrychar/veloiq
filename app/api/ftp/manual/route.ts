import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { rescalePlans } from '@/lib/plan-rescale';

// Ręczne FTP (np. po przerwie silnik zaniżył próg). Ustawia wyświetlane FTP, oznacza je jako
// 'manual' — silnik może je potem tylko PODNIEŚĆ (lib/sync.ts) — i przelicza waty w planie.
export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { ftp?: unknown };
  const ftp = Math.round(Number(body.ftp));
  if (!Number.isFinite(ftp) || ftp < 80 || ftp > 600) {
    return NextResponse.json({ error: 'invalid_ftp', message: 'FTP musi być między 80 a 600 W.' }, { status: 400 });
  }

  const { data: athlete } = await supabase.from('athletes').select('id, ftp_watts').eq('user_id', user.id).single();
  if (!athlete) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });
  const prev = athlete.ftp_watts != null ? Number(athlete.ftp_watts) : null;

  const nowIso = new Date().toISOString();
  const { error } = await supabase.from('athletes').update({
    ftp_watts: ftp, ftp_source: 'manual', ftp_updated_at: nowIso,
    ...(prev != null && prev !== ftp ? { ftp_prev_value: prev } : {}),
  }).eq('id', athlete.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('ftp_history').insert({ athlete_id: athlete.id, date: nowIso.slice(0, 10), ftp_watts: ftp, source: 'manual' });
  const weeks = prev ? await rescalePlans(supabase, athlete.id as string, prev, ftp) : 0;
  return NextResponse.json({ ok: true, ftp, prev, weeksRescaled: weeks });
}
