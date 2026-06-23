import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { syncStravaActivities, recalculateFitnessMetrics } from '@/lib/sync';

// Cron sync (Vercel, dziennie 05:00 UTC). Autoryzacja: Bearer CRON_SECRET (Vercel wstrzykuje
// ten nagłówek automatycznie, jeśli env CRON_SECRET jest ustawiony w projekcie).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Service-role: brak sesji, czytamy/zapisujemy dane wszystkich athletów.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: athletes, error } = await supabase
    .from('athletes')
    .select('id, ftp_watts, hrmax, strava_access_token, strava_refresh_token, strava_token_expires_at')
    .not('strava_refresh_token', 'is', null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: { athlete_id: string; synced?: number; skipped?: string; error?: string }[] = [];

  for (const athlete of athletes ?? []) {
    try {
      // Cron omija cooldown — ma własny harmonogram, to nie spam użytkownika.
      const res = await syncStravaActivities(supabase, athlete as never, { skipCooldown: true });
      if (res.skipped) {
        results.push({ athlete_id: athlete.id as string, skipped: res.reason });
      } else {
        await recalculateFitnessMetrics(supabase, athlete.id as string);
        results.push({ athlete_id: athlete.id as string, synced: res.synced });
      }
    } catch (e) {
      results.push({ athlete_id: athlete.id as string, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ok: true, count: results.length, results });
}
