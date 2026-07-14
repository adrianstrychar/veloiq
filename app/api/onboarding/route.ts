import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { defaultFtpFor, type Sex, type FtpSource, type TrainingMode } from '@/lib/onboarding';

// Zapis onboardingu. Potwierdza (nie wypełnia): waga/płeć/miernik + FTP wstępny. NIE ustawia
// ftp_updated_at — dzięki temu późniejsza promocja silnikowa (recalculateFtpEstimate) przejmie FTP
// jednorazowo, a dopiero potem włącza się hybryda auto-aktualizacji. onboarding_completed=true → gate
// przepuszcza na dashboard.
export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const hasPowerMeter = body.hasPowerMeter;
  if (typeof hasPowerMeter !== 'boolean') {
    return NextResponse.json({ error: 'Zaznacz, czy masz miernik mocy.' }, { status: 400 });
  }

  const { data: athlete } = await supabase
    .from('athletes').select('id').eq('user_id', user.id).maybeSingle();
  if (!athlete) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });

  const weightRaw = Number(body.weight);
  const weight = Number.isFinite(weightRaw) && weightRaw > 0 ? Math.round(weightRaw * 10) / 10 : null;
  const sex: Sex | null = body.sex === 'M' || body.sex === 'F' ? body.sex : null;
  const training_mode: TrainingMode = hasPowerMeter ? 'power' : 'hr';

  // FTP wstępny: podany → użyj; brak → sensowny default z wagi/płci (graceful pustka — plan/prognoza
  // działają od razu). Silnik podmieni na policzony, gdy backfill best_efforts dojrzeje.
  const ftpRaw = Number(body.ftp);
  const ftpProvided = Number.isFinite(ftpRaw) && ftpRaw > 0 ? Math.round(ftpRaw) : null;
  const ftp = ftpProvided ?? defaultFtpFor(weight, sex);
  const ftp_source: FtpSource = ftpProvided != null && body.ftpSource === 'strava_profile' ? 'strava_profile' : 'manual';

  const { error } = await supabase
    .from('athletes')
    .update({
      weight_kg: weight,
      sex,
      has_power_meter: hasPowerMeter,
      training_mode,
      ftp_watts: ftp,
      ftp_source,             // wstępny (strava_profile/manual) — kwalifikuje do promocji silnikowej
      onboarding_completed: true,
      // ftp_updated_at CELOWO NIE ustawiane — patrz nagłówek.
    })
    .eq('id', athlete.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, ftp, ftp_source });
}
