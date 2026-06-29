import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

// Auto-zapis ręcznie wybranych godzin suwakiem dla bieżącego tygodnia (debounce po stronie UI).
// UPDATE jednego pola — generate/modify robią co innego (AI), to czysta persystencja wyboru.
export async function POST(req: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const weekStart = body?.week_start;
  const hours = body?.hours;
  if (
    typeof weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) ||
    typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > 24
  ) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const { data: athlete } = await supabase
    .from('athletes').select('id').eq('user_id', user.id).single();
  if (!athlete) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });

  // UPDATE (nie upsert): plan_json jest NOT NULL, więc wiersz musi już istnieć.
  // .select() zwraca zmienione wiersze — jeśli pusto, plan zniknął/zregenerował się
  // w międzyczasie (race). NIE raportuj sukcesu, gdy nic nie zostało zapisane.
  const { data: updated, error } = await supabase
    .from('weekly_plans')
    .update({ user_hours: hours })
    .eq('athlete_id', athlete.id)
    .eq('week_start', weekStart)
    .select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'plan_not_found' }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
