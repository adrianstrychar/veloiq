import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { cancelChange } from '@/lib/ai/chat-write-tools';

// Odrzucenie propozycji z przycisku [Odrzuć] — usuwa pending (Z POMINIĘCIEM modelu).
// Reuse cancelChange; filtruje po athlete_id → tylko własne propozycje.
export async function POST(_req: Request, { params }: { params: { change_id: string } }) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });

  const { data: athlete } = await supabase.from('athletes').select('id').eq('user_id', user.id).single();
  if (!athlete) return NextResponse.json({ ok: false, error: 'athlete_not_found' }, { status: 404 });

  const result = await cancelChange(
    { supabase, athleteId: athlete.id as string, userId: user.id, hasPower: false },
    { change_id: params.change_id }
  );
  return NextResponse.json(result);
}
