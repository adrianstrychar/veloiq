import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import { aiErrorMessage, STRATEGY_TOO_COMPLEX_MSG } from '@/lib/ai/ai-error';
import { parseModelJson, withMaxTokensRetry, MaxTokensError, MalformedJsonError } from '@/lib/ai/parse-json-response';
import {
  buildStrategyPrompt, strategyFingerprint, reassembleStrategy, strategyMeta,
  type RaceStrategy, type StrategyRace, type StrategyProfile,
} from '@/lib/ai/race-strategy';
import { type RouteAnalysis } from '@/lib/route/detect-climbs';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const raceId = params.id;
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const { data: athlete } = await supabase
    .from('athletes').select('id, ftp_watts, weight_kg, current_goals, weak_points')
    .eq('user_id', user.id).single();
  if (!athlete) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });

  // Ownership: wyścig należy do atlety.
  const { data: raceRow } = await supabase
    .from('race_calendar').select('id, name, date, distance_km, elevation_m, discipline, location')
    .eq('id', raceId).eq('athlete_id', athlete.id).maybeSingle();
  if (!raceRow) return NextResponse.json({ error: 'race_not_found' }, { status: 404 });

  const race: StrategyRace = {
    name: raceRow.name as string,
    date: raceRow.date as string,
    distance_km: raceRow.distance_km as number | null,
    elevation_m: raceRow.elevation_m as number | null,
    discipline: raceRow.discipline as string | null,
    location: raceRow.location as string | null,
  };
  const profile: StrategyProfile = {
    ftp_watts: athlete.ftp_watts as number | null,
    weight_kg: athlete.weight_kg != null ? Number(athlete.weight_kg) : null,
    current_goals: athlete.current_goals as string | null,
    weak_points: (athlete.weak_points as string[] | null) ?? null,
  };

  // Istniejący wiersz — potrzebny do route_analysis (trasa wchodzi do fingerprintu) ORAZ do cache hit.
  const { data: existing } = await supabase
    .from('race_plans')
    .select('tactical_plan, race_nutrition_plan, tire_recommendations, target_avg_watts, target_if, route_analysis, generation_inputs_hash, generated_at')
    .eq('athlete_id', athlete.id).eq('race_id', raceId).maybeSingle();

  const route = (existing?.route_analysis as RouteAnalysis | null) ?? null;
  const fingerprint = strategyFingerprint(race, profile, route);

  // ── Cache: ten sam fingerprint → zwróć, ZERO calla do Anthropic. ──
  if (existing?.tactical_plan && existing.generation_inputs_hash === fingerprint) {
    return NextResponse.json({ strategy: reassembleStrategy(existing, race), cached: true });
  }

  // ── Generacja (z trasą jeśli jest route_analysis → pacing per realny podjazd) ──
  const { system, user: userMsg } = buildStrategyPrompt(race, profile, route);
  // Tryb GPX (pacing per podjazd) daje dłuższy JSON i uciął się przy 3500/4500. Zamiast kolejnej
  // ręcznej łatki limitu: AUTO-RETRY RAZ z +50% (4500→6750). Strategia jest cache'owana po
  // fingerprincie i generowana na żądanie (rzadko) → podwójny call tylko przy ucięciu = koszt grosze.
  const BASE_MAX = 4500;
  // Hardcap: sonnet-4-6 ma absolutny max output 64K, ale ten call jest NON-STREAMING (praktyczny sufit
  // SDK ~16K — jak w plan-generate). 8192 = konserwatywny rail komfortowo w strefie non-streaming i
  // powyżej +50% (6750). Gdyby BASE kiedyś ≥ cap → withMaxTokensRetry nie ponawia (brak headroomu).
  const SONNET_OUTPUT_CAP = 8192;
  try {
    const gen = await withMaxTokensRetry<Omit<RaceStrategy, 'meta'>>(
      { baseMaxTokens: BASE_MAX, capMaxTokens: SONNET_OUTPUT_CAP },
      async (maxTokens, attempt) => {
        console.info(`[strategy] próba ${attempt + 1}/2 max_tokens=${maxTokens} race=${raceId}`);
        const resp = await anthropic.messages.create({
          model: 'claude-sonnet-4-6', max_tokens: maxTokens, system,
          messages: [{ role: 'user', content: userMsg }],
        });
        // stop_reason SPRAWDZANE PRZED parsowaniem — ucięcie → MaxTokensError (nie goły SyntaxError).
        return parseModelJson<Omit<RaceStrategy, 'meta'>>(resp, { maxTokens });
      },
      (err, next) => console.warn(`[strategy] ucięcie na max_tokens (output=${err.outputTokens}) — retry z ${next}`),
    );

    // Rozłóż do kolumn race_plans (finish_time jako tekst w tactical_plan — interval pomijamy).
    const row = {
      athlete_id: athlete.id,
      race_id: raceId,
      tactical_plan: { pacing: gen.pacing ?? [], strengths: gen.strengths ?? [], finish_time: gen.targets?.finish_time ?? '' },
      race_nutrition_plan: { fueling: gen.fueling ?? [], packing: gen.packing ?? { nutrition: [], hydration: [], summary: '' } },
      tire_recommendations: gen.tires ?? { front: '', rear: '', note: '' },
      target_avg_watts: gen.targets?.avg_watts ?? null,
      target_if: gen.targets?.if ?? null,
      ai_model: 'claude-sonnet-4-6',
      generation_inputs_hash: fingerprint,
      generated_at: new Date().toISOString(),
    };
    await supabase.from('race_plans').upsert(row, { onConflict: 'athlete_id,race_id' });

    return NextResponse.json({
      strategy: { meta: strategyMeta(race), ...gen } as RaceStrategy,
      cached: false,
    });
  } catch (err: unknown) {
    // Ucięcie MIMO retry (obie próby na limicie) → czytelny komunikat, nie goły 502.
    if (err instanceof MaxTokensError) {
      console.warn(`[strategy] ucięcie mimo retry 6750 (output=${err.outputTokens}) race=${raceId} — zwracam błąd`);
      return NextResponse.json({ error: STRATEGY_TOO_COMPLEX_MSG, unavailable: true }, { status: 502 });
    }
    // JSON zepsuty mimo normalnego zakończenia (osobny przypadek od ucięcia).
    if (err instanceof MalformedJsonError) {
      return NextResponse.json({ error: 'Nie udało się przygotować strategii — spróbuj ponownie.', unavailable: true }, { status: 502 });
    }
    // Awaria API (kredyty/limit/sieć) → czytelny komunikat (#86); karta pokaże przycisk ponów.
    return NextResponse.json({ error: aiErrorMessage(err), unavailable: true }, { status: 503 });
  }
}
