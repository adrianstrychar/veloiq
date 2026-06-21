import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import {
  buildDailyInsightPrompt,
  type DailyInsightActivity,
} from '@/lib/ai/dailyInsight';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function GET() {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id')
    .eq('user_id', user.id)
    .single();
  if (!athlete) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });

  // Pełna historia PMC (do szczytu + rampy) i ostatnia jazda.
  const [{ data: rows }, { data: lastActivity }] = await Promise.all([
    supabase
      .from('fitness_metrics')
      .select('date, ctl, atl, tsb')
      .eq('athlete_id', athlete.id)
      .order('date', { ascending: true }),
    supabase
      .from('strava_activities')
      .select('name, activity_date, type, distance_km, tss')
      .eq('athlete_id', athlete.id)
      .order('activity_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'no_metrics' }, { status: 404 });
  }

  const now = rows[rows.length - 1];
  const peakCtl = rows.reduce((mx, r) => Math.max(mx, Number(r.ctl)), 0);
  const prev = rows[Math.max(0, rows.length - 8)];
  const ctlRamp = +(Number(now.ctl) - Number(prev.ctl)).toFixed(1);

  const { system, user: userMsg } = buildDailyInsightPrompt(
    {
      date: now.date as string,
      ctl: Number(now.ctl),
      atl: Number(now.atl),
      tsb: Number(now.tsb),
      peakCtl,
      ctlRamp,
    },
    (lastActivity as DailyInsightActivity | null) ?? null
  );

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 120,
      system,
      messages: [{ role: 'user', content: userMsg }],
    });
    const insight = response.content[0]?.type === 'text' ? response.content[0].text : '';
    return NextResponse.json({ insight });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
