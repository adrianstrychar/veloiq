import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

// Dismiss notki "Zaktualizowaliśmy FTP: X → Y" (pokazywana raz przy promocji silnikowej). Flaga w DB,
// więc dismiss przeżywa reload / działa multi-device.
export async function POST() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const { data: athlete } = await supabase
    .from('athletes').select('id').eq('user_id', user.id).maybeSingle();
  if (!athlete) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });

  const { error } = await supabase
    .from('athletes').update({ ftp_engine_note_seen: true }).eq('id', athlete.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
