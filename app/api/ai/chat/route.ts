import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import { buildSystemPrompt } from '@/lib/ai/prompt';
import { TOOL_DEFS, dispatchTool, type ToolContext } from '@/lib/ai/chat-tools';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MAX_ROUNDS = 5; // ile rund tool-use zanim wymusimy finalną odpowiedź tekstową

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
  let messages: Anthropic.MessageParam[];
  try {
    const body = await request.json();
    messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'brak wiadomości' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'nieprawidłowy JSON' }, { status: 400 });
  }

  // Zawodnik: id + tryb mocy — rozwiązane RAZ z sesji, scope dla wszystkich narzędzi.
  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, ftp_watts, has_power_meter')
    .eq('user_id', user.id)
    .single();

  if (!athlete) {
    return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });
  }

  const toolCtx: ToolContext = {
    supabase,
    athleteId: athlete.id as string,
    userId: user.id,
    hasPower: !!(athlete.ftp_watts || athlete.has_power_meter),
  };

  // System prompt z profilem + anchorem
  const systemPrompt = await buildSystemPrompt(supabase, user.id);

  // Konwersacja narasta o tury assistant (tool_use) i user (tool_result).
  const convo: Anthropic.MessageParam[] = [...messages];
  let response: Anthropic.Message | null = null;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOL_DEFS,
      messages: convo,
    });

    if (response.stop_reason !== 'tool_use') break;

    // Wykonaj wszystkie żądane narzędzia; tool_result 1:1 per tool_use_id.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      try {
        const result = await dispatchTool(
          toolCtx,
          block.name,
          (block.input ?? {}) as Record<string, unknown>
        );
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      } catch (e) {
        // Błąd handlera nie wywala requestu — model dostaje is_error i reaguje.
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: e instanceof Error ? e.message : String(e),
          is_error: true,
        });
      }
    }

    convo.push({ role: 'assistant', content: response.content });
    convo.push({ role: 'user', content: toolResults });
  }

  // Wyczerpano rundy, a model wciąż chce narzędzi → wymuś odpowiedź tekstową.
  if (response && response.stop_reason === 'tool_use') {
    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOL_DEFS,
      tool_choice: { type: 'none' },
      messages: convo,
    });
  }

  const reply =
    response?.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '';

  return NextResponse.json({ reply });
}
