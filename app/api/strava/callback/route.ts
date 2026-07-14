import { NextRequest, NextResponse } from 'next/server';
import { exchangeStravaCode, fetchStravaAthleteProfile } from '@/lib/strava';
import { createServerSupabaseClient } from '@/lib/supabase';
import { syncStravaActivities, recalculateFitnessMetrics } from '@/lib/sync';
import { resolveCallbackUpsert, type CallbackExisting } from '@/lib/onboarding';

const ATHLETE_SYNC_COLS = 'id, strava_id, ftp_watts, hrmax, strava_access_token, strava_refresh_token, strava_token_expires_at';

// OAuth callback — wymiana kodu na tokeny i zapis do athletes (sekcja 14)
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  // Strava zwraca przyznany scope w callbacku — zapisujemy, by wiedzieć czy jest activity:write.
  const grantedScope = searchParams.get('scope');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

  if (error || !code) {
    return NextResponse.redirect(`${appUrl}/login?error=strava_denied`);
  }

  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${appUrl}/login?error=not_authenticated`);
  }

  const tokenData = await exchangeStravaCode(code);

  // Prefill z profilu Strava (best-effort — token/braki → null, onboarding dopyta).
  let sp = { weight: null as number | null, ftp: null as number | null, sex: null as 'M' | 'F' | null };
  try { sp = await fetchStravaAthleteProfile(tokenData.access_token); } catch { /* degradacja: brak prefillu */ }

  // Wspólne pola tokenów/tożsamości — pisane w KAŻDEJ ścieżce (nowy i reconnect).
  const baseFields = {
    user_id: user.id,
    strava_id: tokenData.athlete.id,
    strava_access_token: tokenData.access_token,
    strava_refresh_token: tokenData.refresh_token,
    strava_token_expires_at: new Date(tokenData.expires_at * 1000).toISOString(),
    strava_scope: grantedScope, // przyznany scope → bramka write-backu (activity:write?)
    name: `${tokenData.athlete.firstname} ${tokenData.athlete.lastname}`.trim(),
  };

  // Rozróżnij NOWY (INSERT) od ISTNIEJĄCEGO (reconnect) po strava_id — decyzja o zapisie/redirect w helperze.
  const { data: existing } = await supabase
    .from('athletes')
    .select('id, onboarding_completed, weight_kg, sex, ftp_watts')
    .eq('strava_id', tokenData.athlete.id)
    .maybeSingle();

  const plan = resolveCallbackUpsert(existing as CallbackExisting | null, sp);

  // profileWrite=null (completed=true) → NIE dotykamy wagi/ftp/sex ani flagi; tylko tokeny.
  const writeFields = {
    ...baseFields,
    ...(plan.isNew ? { onboarding_completed: false, ftp_source: null } : {}),
    ...(plan.profileWrite ?? {}),
  };

  const { data: athlete, error: writeErr } = plan.isNew
    ? await supabase.from('athletes').insert(writeFields).select(ATHLETE_SYNC_COLS).single()
    : await supabase.from('athletes').update(writeFields).eq('id', (existing as { id: string }).id).select(ATHLETE_SYNC_COLS).single();

  if (writeErr || !athlete) {
    return NextResponse.redirect(`${appUrl}/login?error=save_failed`);
  }

  // Pierwszy sync aktywności i przeliczenie CTL/ATL/TSB (jak dotąd — backfill best_efforts leci w tle).
  const result = await syncStravaActivities(supabase, athlete);
  if (!result.skipped) {
    await recalculateFitnessMetrics(supabase, athlete.id);
  }

  // REDIRECT wg statusu onboardingu: niedokończony → /onboarding, gotowy → dashboard. Zero pętli
  // (gate zostaje jako siatka bezpieczeństwa; przy kompletnym schemacie /onboarding nie odbija).
  return NextResponse.redirect(`${appUrl}${plan.redirect}`);
}
