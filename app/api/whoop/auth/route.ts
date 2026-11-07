import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { createServerSupabaseClient } from '@/lib/supabase';
import { WHOOP_AUTH_URL, WHOOP_SCOPES, whoopConfigured, whoopRedirectUri } from '@/lib/whoop';

export const dynamic = 'force-dynamic';

// Start OAuth WHOOP: zalogowany zawodnik → ekran zgody WHOOP → /api/whoop/callback.
// state (8 znaków, wymóg WHOOP) w ciasteczku httpOnly – ochrona przed CSRF.
export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${appUrl}/login`);
  if (!whoopConfigured()) return NextResponse.redirect(`${appUrl}/dashboard?whoop=not_configured`);

  const state = randomBytes(6).toString('base64url').slice(0, 8);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.WHOOP_CLIENT_ID!,
    redirect_uri: whoopRedirectUri(),
    scope: WHOOP_SCOPES,
    state,
  });
  const res = NextResponse.redirect(`${WHOOP_AUTH_URL}?${params.toString()}`);
  res.cookies.set('whoop_state', state, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/whoop', maxAge: 600 });
  return res;
}
