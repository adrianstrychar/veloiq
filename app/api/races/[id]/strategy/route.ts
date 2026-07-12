import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import { aiErrorMessage } from '@/lib/ai/ai-error';
import {
  buildStrategyPrompt, strategyFingerprint, reassembleStrategy, strategyMeta,
  type RaceStrategy, type StrategyRace, type StrategyProfile,
} from '@/lib/ai/race-strategy';

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

  const fingerprint = strategyFingerprint(race, profile);

  // ── Cache: istniejący plan z tym fingerprintem → zwróć, ZERO calla do Anthropic. ──
  const { data: existing } = await supabase
    .from('race_plans')
    .select('tactical_plan, race_nutrition_plan, tire_recommendations, target_avg_watts, target_if, generation_inputs_hash, generated_at')
    .eq('athlete_id', athlete.id).eq('race_id', raceId).maybeSingle();
  if (existing && existing.generation_inputs_hash === fingerprint) {
    return NextResponse.json({ strategy: reassembleStrategy(existing, race), cached: true });
  }

  // ── Generacja ──
  const { system, user: userMsg } = buildStrategyPrompt(race, profile);
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 3500, system,
      messages: [{ role: 'user', content: userMsg }],
    });
    const text = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
    // Model może opakować JSON w cokolwiek mimo instrukcji — wytnij pierwszy obiekt {...}.
    const jsonStr = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const gen = JSON.parse(jsonStr) as Omit<RaceStrategy, 'meta'>;

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
    // Błąd parsowania JSON lub API → czytelny komunikat (#86); karta pokaże przycisk ponów.
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: 'Nie udało się przygotować strategii — spróbuj ponownie.', unavailable: true }, { status: 502 });
    }
    return NextResponse.json({ error: aiErrorMessage(err), unavailable: true }, { status: 503 });
  }
}
