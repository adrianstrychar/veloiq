import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import { buildSystemPrompt } from '@/lib/ai/prompt';
import { aiErrorMessage } from '@/lib/ai/ai-error';
import { TOOL_DEFS, dispatch, type ToolCtx } from '@/lib/ai/chat-tools';
import { WRITE_TOOL_DEFS, isWriteTool, dispatchWrite } from '@/lib/ai/chat-write-tools';
import { classifyIntent, INTENT_CONFIG, INTENT_MODE_LINE, FACT_TOOL_NAMES } from '@/lib/ai/chat-intent';

const ALL_TOOLS = [...TOOL_DEFS, ...WRITE_TOOL_DEFS];

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_ROUNDS = 5; // limit bezpieczeństwa pętli tool-use

function textOf(resp: Anthropic.Message): string {
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

// Log kosztu per call — input/output + cache (do weryfikacji, czy caching i capy działają).
function logUsage(tag: string, resp: Anthropic.Message): void {
  const u = resp.usage;
  console.info(
    `[chat] ${tag} model=${resp.model} stop=${resp.stop_reason} in=${u.input_tokens} out=${u.output_tokens} ` +
      `cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0}`,
  );
}

// cache_control na OSTATNIM toolu → cache'uje cały blok definicji tooli (idą po drucie z każdym callem).
function withToolCache(tools: Anthropic.Tool[]): Anthropic.Tool[] {
  if (tools.length === 0) return tools;
  return tools.map((t, i) =>
    i === tools.length - 1 ? ({ ...t, cache_control: { type: 'ephemeral' } } as Anthropic.Tool) : t,
  );
}

// Karta propozycji dla UI: przyciski [Zatwierdź]/[Odrzuć] działają na change_id BEZ modelu.
interface PendingCard {
  change_id: string;
  kind: 'plan' | 'race';
  diff: string;
}

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

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, ftp_watts, has_power_meter')
    .eq('user_id', user.id)
    .single();
  const athleteId = athlete?.id as string | undefined;
  const hasPower = !!(athlete?.ftp_watts || athlete?.has_power_meter);

  // ── Klasyfikacja intencji (heurystyka → Haiku fallback) — steruje modelem/cappem/toolami/trybem. ──
  const cls = await classifyIntent(
    messages.map((m) => ({ role: String(m.role), content: typeof m.content === 'string' ? m.content : '' })),
    anthropic,
  );
  const { model, maxTokens: finalCap } = INTENT_CONFIG[cls.intent];
  console.info(`[chat] intent=${cls.intent} source=${cls.source} model=${model} finalCap=${finalCap} athlete=${athleteId ? 'yes' : 'no'}`);

  // System jako TABLICA bloków: static z cache_control (cache'owalny prefiks) + dynamic (czas+anchor+tryb)
  // POZA breakpointem. Linia trybu na SAMYM KOŃCU (najsilniejsza pozycja).
  const { static: staticSys, dynamic: dynBase } = await buildSystemPrompt(supabase, user.id);
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: staticSys, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `${dynBase}\n\n---\n\n${INTENT_MODE_LINE[cls.intent]}` },
  ];

  try {
    // Bez profilu (brak athlete) — narzędzia nic by nie zwróciły; pojedynczy call z cappem per intencja.
    if (!athleteId) {
      const resp = await anthropic.messages.create({ model, max_tokens: finalCap, system, messages });
      logUsage('no-athlete-final', resp);
      return NextResponse.json({ reply: textOf(resp) });
    }

    const ctx: ToolCtx = { supabase, athleteId, userId: user.id, hasPower };
    const pendings: PendingCard[] = [];

    // FACT → zawężony zestaw tooli (odczyt liczb/faktów, bez write i ciężkich). cache_control na ostatnim.
    const toolset = cls.intent === 'FACT' ? ALL_TOOLS.filter((t) => FACT_TOOL_NAMES.has(t.name)) : ALL_TOOLS;
    const tools = withToolCache(toolset);

    // ── Pętla tool-use: TWARDY cap per intencja na KAŻDEJ rundzie (bez dodatkowego calla). Model emituje
    //    tool_use (mały — mieści się w cappie) albo finalną odpowiedź (już capowaną → zwracamy wprost). ──
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resp = await anthropic.messages.create({ model, max_tokens: finalCap, system, tools, messages });
      logUsage(`round${round}`, resp);
      if (resp.stop_reason !== 'tool_use') {
        if (resp.stop_reason === 'max_tokens') {
          console.warn(`[chat] odpowiedź ucięta na cappie ${finalCap} (intent=${cls.intent}, out=${resp.usage.output_tokens}) — cap może być za ciasny`);
        }
        return NextResponse.json({ reply: textOf(resp), pendings });
      }

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

    // Po wyczerpaniu rund (model wciąż chce toole) — wymuś tekst (tool_choice none), cap per intencja.
    const finalResp = await anthropic.messages.create({ model, max_tokens: finalCap, system, tools, tool_choice: { type: 'none' }, messages });
    logUsage('final-forced', finalResp);
    if (finalResp.stop_reason === 'max_tokens') {
      console.warn(`[chat] FINAL ucięta na cappie ${finalCap} (intent=${cls.intent}, out=${finalResp.usage.output_tokens})`);
    }
    return NextResponse.json({ reply: textOf(finalResp), pendings });
  } catch (err: unknown) {
    return NextResponse.json({ error: aiErrorMessage(err) }, { status: 503 });
  }
}
