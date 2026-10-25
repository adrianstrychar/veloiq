import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { importMissingRides } from '@/lib/ride/import-rides';

// Po zapisie jazdy z telefonu: wprowadź ją (i ewentualne zaległe) do listy aktywności VeloIQ.
export async function POST() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });
  const { data: athlete } = await supabase.from('athletes').select('id').eq('user_id', user.id).single();
  if (!athlete) return NextResponse.json({ ok: false, error: 'athlete_not_found' }, { status: 404 });
  const added = await importMissingRides(supabase, user.id, athlete.id as string);
  return NextResponse.json({ ok: true, added });
}
