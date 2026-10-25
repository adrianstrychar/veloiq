// Ręczne FTP – jedna ścieżka dla przycisku „zmień” (API) i czatu (propose_ftp_change → commit).
// Ustawia wyświetlane FTP jako 'manual' (silnik może je potem tylko PODNIEŚĆ – lib/sync.ts),
// zapisuje punkt historii i przelicza waty w planie od dziś.
import type { SupabaseClient } from '@supabase/supabase-js';
import { rescalePlans } from '@/lib/plan-rescale';

export const FTP_MIN = 80;
export const FTP_MAX = 600;
export const validFtp = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= FTP_MIN && n <= FTP_MAX ? n : null;
};

export async function setManualFtp(supabase: SupabaseClient, athleteId: string, ftp: number) {
  const { data: athlete } = await supabase.from('athletes').select('ftp_watts').eq('id', athleteId).single();
  const prev = athlete?.ftp_watts != null ? Number(athlete.ftp_watts) : null;
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from('athletes').update({
    ftp_watts: ftp, ftp_source: 'manual', ftp_updated_at: nowIso,
    ...(prev != null && prev !== ftp ? { ftp_prev_value: prev } : {}),
  }).eq('id', athleteId);
  if (error) throw new Error(error.message);
  await supabase.from('ftp_history').insert({ athlete_id: athleteId, date: nowIso.slice(0, 10), ftp_watts: ftp, source: 'manual' });
  const weeksRescaled = prev ? await rescalePlans(supabase, athleteId, prev, ftp) : 0;
  return { prev, ftp, weeksRescaled };
}
