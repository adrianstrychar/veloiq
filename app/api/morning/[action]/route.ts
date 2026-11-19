import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { actOnMorningReport } from '@/lib/morning/run';

// Przyciski karty raportu porannego: revert (Przywróć plan), accept / dismiss (propozycja), seen.
const ACTIONS = ['revert', 'accept', 'dismiss', 'seen'] as const;

export async function POST(req: Request, { params }: { params: { action: string } }) {
  const action = params.action as (typeof ACTIONS)[number];
  if (!ACTIONS.includes(action)) return NextResponse.json({ ok: false, error: 'unknown_action' }, { status: 404 });
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });
  const { data: athlete } = await supabase.from('athletes').select('id').eq('user_id', user.id).single();
  if (!athlete) return NextResponse.json({ ok: false, error: 'athlete_not_found' }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { date?: string };
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : undefined;
  return NextResponse.json(await actOnMorningReport(supabase, athlete.id as string, action, date));
}
