import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import { buildSystemPrompt } from '@/lib/ai/prompt';
import { aiErrorMessage } from '@/lib/ai/ai-error';
import { TOOL_DEFS, dispatch, type ToolCtx } from '@/lib/ai/chat-tools';
import { WRITE_TOOL_DEFS, isWriteTool, dispatchWrite } from '@/lib/ai/chat-write-tools';

const ALL_TOOLS = [...TOOL_DEFS, ...WRITE_TOOL_DEFS];

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;
const MAX_ROUNDS = 5; // limit bezpieczeństwa: max 5 rund tool-use, potem wymuszamy tekst

function textOf(resp: Anthropic.Message): string {
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

// Karta propozycji dla UI: przyciski [Zatwierdź]/[Odrzuć] działają na change_id BEZ modelu.
interface PendingCard {
  change_id: string;
  kind: 'plan' | 'race';
  diff: string;
}

// Wyciąga pending z wyniku propose_* (jeśli zwrócił change_id) — strukturalnie, nie z tekstu modelu.
function pendingFrom(toolName: string, data: unknown): PendingCard | null {
  if (toolName !== 'propose_plan_change' && toolName !== 'propose_race_change') return null;
  const d = data as { ok?: boolean; change_id?: string; diff?: string };
  if (!d?.ok || !d.change_id || !d.diff) return null;
  return { change_id: d.change_id, kind: toolName === 'propose_plan_change' ? 'plan' : 'race', diff: d.diff };
}

export async function POST(request: NextRequest) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

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

  // Profil zawodnika: id (scope wszystkich narzędzi) + czy jest moc (ekspozycja watów vs HR).
  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, ftp_watts, has_power_meter')
    .eq('user_id', user.id)
    .single();
  const athleteId = athlete?.id as string | undefined;
  const hasPower = !!(athlete?.ftp_watts || athlete?.has_power_meter);

  const systemPrompt = await buildSystemPrompt(supabase, user.id);

  // Wszystkie calle do Anthropic pod try/catch: awaria API (brak kredytów, 429, 5xx, sieć)
  // → czytelny JSON 503 zamiast gołego 500, który chat pokazywał jako "błąd połączenia
  // z serwerem" (res.json() na nie-JSON-owej odpowiedzi rzucał w catch klienta).
  try {
    // Bez athleteId (brak profilu) — narzędzia i tak by nic nie zwróciły; jedziemy bez tools.
    if (!athleteId) {
      const resp = await anthropic.messages.create({ model: MODEL, max_tokens: MAX_TOKENS, system: systemPrompt, messages });
      return NextResponse.json({ reply: textOf(resp) });
    }

    const ctx: ToolCtx = { supabase, athleteId, userId: user.id, hasPower };
    const pendings: PendingCard[] = []; // propozycje z tej odpowiedzi → karty z przyciskami w UI

    // ── Pętla tool-use: iteruj dopóki model prosi o narzędzia (stop_reason === 'tool_use') ──
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        tools: ALL_TOOLS,
        messages,
      });

      if (resp.stop_reason !== 'tool_use') {
        return NextResponse.json({ reply: textOf(resp), pendings });
      }

      // Tura asystenta z blokami tool_use MUSI trafić do historii przed tool_result.
      messages.push({ role: 'assistant', content: resp.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type !== 'tool_use') continue;
        try {
          const input = block.input as Record<string, unknown>;
          const data = isWriteTool(block.name) ? await dispatchWrite(block.name, input, ctx) : await dispatch(block.name, input, ctx);
          const pending = pendingFrom(block.name, data);
          if (pending) pendings.push(pending);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(data) });
        } catch (e) {
          // Błąd handlera → is_error (model dostaje info, może zaproponować sync); request nie pada.
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `error: ${e instanceof Error ? e.message : String(e)}`,
            is_error: true,
          });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }

    // Po wyczerpaniu rund — wymuś odpowiedź tekstową (tool_choice none), żeby zawsze coś zwrócić.
    const finalResp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools: ALL_TOOLS,
      tool_choice: { type: 'none' },
      messages,
    });
    return NextResponse.json({ reply: textOf(finalResp), pendings });
  } catch (err: unknown) {
    // Chat page pokazuje data.error przy !res.ok — user dostaje to zdanie wprost.
    return NextResponse.json({ error: aiErrorMessage(err) }, { status: 503 });
  }
}
