import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { syncWhoop } from '@/lib/whoop';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Ręczna synchronizacja WHOOP (przycisk na karcie). ?days=N (domyślnie 7, maks. 120).
export async function POST(req: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });
  const { data: athlete } = await supabase.from('athletes').select('id').eq('user_id', user.id).maybeSingle();
  if (!athlete) return NextResponse.json({ ok: false, error: 'athlete_not_found' }, { status: 404 });
  const days = Number(new URL(req.url).searchParams.get('days')) || 7;
  const res = await syncWhoop(supabase, athlete.id as string, { days });
  return NextResponse.json(res, { status: res.ok ? 200 : res.error === 'not_connected' ? 404 : res.error === 'reauth' ? 401 : 502 });
}
