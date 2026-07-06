import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

// Akceptacja estymaty FTP (tap w chip na kaflu FTP). Jedyna ścieżka, którą estymata
// silnika staje się WYŚWIETLANYM ftp_watts — ustawia też ftp_updated_at, co od tej pory
// włącza hybrydę auto-aktualizacji (≥14 dni / próg +5/−8 W) w recalculateFtpEstimate.
export async function POST() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, ftp_estimate')
    .eq('user_id', user.id)
    .single();
  if (!athlete) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });
  if (athlete.ftp_estimate == null) {
    return NextResponse.json({ error: 'no_estimate' }, { status: 400 });
  }

  const ftp = Math.round(Number(athlete.ftp_estimate));
  const nowIso = new Date().toISOString();

  const { error: updateErr } = await supabase
    .from('athletes')
    .update({ ftp_watts: ftp, ftp_updated_at: nowIso })
    .eq('id', athlete.id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Punkt historii: zaakceptowana estymata (wykres "Twój silnik" czyta jak dotąd).
  await supabase.from('ftp_history').insert({
    athlete_id: athlete.id,
    date: nowIso.slice(0, 10),
    ftp_watts: ftp,
    source: 'estimate',
  });

  return NextResponse.json({ ok: true, ftp });
}
