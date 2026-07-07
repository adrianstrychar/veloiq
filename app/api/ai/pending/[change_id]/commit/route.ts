import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { commitChange } from '@/lib/ai/chat-write-tools';

// Deterministyczny zapis propozycji z przycisku [Zatwierdź] — Z POMINIĘCIEM modelu.
// Reuse commitChange (ta sama logika co w czacie): TTL 15 min + base_hash + konsumpcja pending.
// commitChange filtruje pending po athlete_id → weryfikuje, że propozycja należy do zalogowanego atlety.
export async function POST(_req: Request, { params }: { params: { change_id: string } }) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });

  const { data: athlete } = await supabase.from('athletes').select('id').eq('user_id', user.id).single();
  if (!athlete) return NextResponse.json({ ok: false, error: 'athlete_not_found' }, { status: 404 });

  const result = await commitChange(
    { supabase, athleteId: athlete.id as string, userId: user.id, hasPower: false },
    { change_id: params.change_id }
  );
  return NextResponse.json(result);
}
