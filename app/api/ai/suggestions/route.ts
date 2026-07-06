import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { buildSuggestions } from '@/lib/ai/chat-suggestions';

// Dynamiczne chips do czatu — deterministyczne (bez LLM). Wołane przy montowaniu czatu.
// Nice-to-have: przy braku profilu/danych zwraca pustą listę (chips po prostu się nie pokazują).
export async function GET() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ suggestions: [] });

  const { data: athlete } = await supabase.from('athletes').select('id').eq('user_id', user.id).single();
  if (!athlete) return NextResponse.json({ suggestions: [] });

  try {
    const suggestions = await buildSuggestions(supabase, athlete.id as string);
    // topic jest wewnętrzny (deduplikacja) — nie wysyłamy do klienta.
    return NextResponse.json({ suggestions: suggestions.map(({ label, prompt }) => ({ label, prompt })) });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
