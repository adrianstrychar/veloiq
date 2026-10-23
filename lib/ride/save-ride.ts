// Zapis nagranego treningu do Supabase: wiersz w `rides` + pełny zapis 1 Hz w Storage (bucket `rides`).
// Migracja: supabase/migrations/021_rides.sql (uruchom ręcznie w Supabase Studio).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkoutSummary } from './ride-engine';
import type { WorkoutScript } from './workout-script';

export interface SavedSample { s: number; p?: number; hr?: number; cad?: number; lat?: number; lon?: number }

export interface SaveRideInput {
  summary: WorkoutSummary;
  samples: SavedSample[];
  script: WorkoutScript;
  startedAt: Date;
  outdoor: boolean;
  ftp: number;
  source: 'veloiq-ios' | 'veloiq-web-sim';
}

export async function saveRide(sb: SupabaseClient, input: SaveRideInput): Promise<{ id: string }> {
  const { data: auth } = await sb.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('Brak zalogowanego użytkownika');

  const id = crypto.randomUUID();
  const path = `${userId}/${id}.jsonl`;
  const body = input.samples.map((x) => JSON.stringify(x)).join('\n');

  const up = await sb.storage.from('rides').upload(path, new Blob([body], { type: 'application/x-ndjson' }), { upsert: false });
  if (up.error) throw up.error;

  const sum = input.summary;
  const IF = input.ftp ? sum.normalizedPower / input.ftp : null;
  const tss = input.ftp && IF ? Math.round((sum.durationSec * sum.normalizedPower * IF) / (input.ftp * 3600) * 100) : null;
  const hasGps = input.samples.some((x) => x.lat != null);

  const ins = await sb.from('rides').insert({
    id,
    user_id: userId,
    started_at: input.startedAt.toISOString(),
    duration_sec: sum.durationSec,
    avg_power: sum.avgPower,
    normalized_power: sum.normalizedPower,
    intensity_factor: IF,
    tss,
    kj: sum.kJ,
    avg_hr: sum.avgHr ?? null,
    max_hr: sum.maxHr ?? null,
    compliance_pct: sum.series.length ? sum.compliancePct : null,
    ftp_at_ride: input.ftp,
    outdoor: input.outdoor,
    has_gps: hasGps,
    workout_name: input.script.name,
    workout_script: input.script,
    series: sum.series,
    efforts: sum.efforts,
    samples_path: path,
    source: input.source,
  });
  if (ins.error) {
    await sb.storage.from('rides').remove([path]); // nie zostawiaj osieroconego pliku
    throw ins.error;
  }
  return { id };
}

/** Krzywa mocy (best efforts) z zapisu 1 Hz – do silnika FTP VeloIQ. Sekundy bez danych = 0 W. */
export function powerCurve(samples: SavedSample[], windows = [5, 60, 300, 1200, 3600]): Record<number, number> {
  const P = samples.map((x) => x.p ?? 0);
  const out: Record<number, number> = {};
  for (const w of windows) {
    if (P.length < w) continue;
    let sum = 0, best = 0;
    for (let i = 0; i < P.length; i++) {
      sum += P[i];
      if (i >= w) sum -= P[i - w];
      if (i >= w - 1) best = Math.max(best, sum / w);
    }
    out[w] = Math.round(best);
  }
  return out;
}
