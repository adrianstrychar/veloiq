import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { applyWeekHours } from '@/lib/plan-hours';

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
  // Zapis wyboru + przeskalowanych dni (plan_json.days) – reszta aplikacji widzi ten sam plan co suwak.
  const res = await applyWeekHours(supabase, athlete.id as string, weekStart, hours);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true });
}
