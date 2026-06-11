import { NextRequest, NextResponse } from 'next/server';
import { exchangeStravaCode } from '@/lib/strava';
import { createServerSupabaseClient } from '@/lib/supabase';

// OAuth callback — wymiana kodu na tokeny i zapis do athletes (sekcja 14)
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

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

  const { error: upsertError } = await supabase.from('athletes').upsert(
    {
      user_id: user.id,
      strava_id: tokenData.athlete.id,
      strava_access_token: tokenData.access_token,
      strava_refresh_token: tokenData.refresh_token,
      strava_token_expires_at: new Date(tokenData.expires_at * 1000).toISOString(),
      name: `${tokenData.athlete.firstname} ${tokenData.athlete.lastname}`.trim(),
    },
    { onConflict: 'strava_id' }
  );

  if (upsertError) {
    return NextResponse.redirect(`${appUrl}/login?error=save_failed`);
  }

  return NextResponse.redirect(`${appUrl}/setup/1`);
}
