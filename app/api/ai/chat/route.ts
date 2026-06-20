import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import { buildSystemPrompt } from '@/lib/ai/prompt';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: NextRequest) {
  // Autoryzacja
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  // Parsuj wiadomości z body
  let messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  try {
    const body = await request.json();
    messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'brak wiadomości' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'nieprawidłowy JSON' }, { status: 400 });
  }

  // Zbuduj system prompt z profilem zawodnika
  const systemPrompt = await buildSystemPrompt(supabase, user.id);

  // Wywołaj Anthropic API (bez streamingu)
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const reply =
    response.content[0]?.type === 'text' ? response.content[0].text : '';

  return NextResponse.json({ reply });
}
