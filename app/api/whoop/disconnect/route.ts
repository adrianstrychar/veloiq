import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { disconnectWhoop } from '@/lib/whoop';

export const dynamic = 'force-dynamic';

// Odłączenie WHOOP: cofnięcie dostępu + usunięcie tokenów. Pobrane dni zostają w historii.
export async function POST() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });
  const { data: athlete } = await supabase.from('athletes').select('id').eq('user_id', user.id).maybeSingle();
  if (!athlete) return NextResponse.json({ ok: false, error: 'athlete_not_found' }, { status: 404 });
  await disconnectWhoop(supabase, athlete.id as string);
  return NextResponse.json({ ok: true });
}
