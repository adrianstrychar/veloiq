import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { exchangeWhoopCode, whoopGet, syncWhoop } from '@/lib/whoop';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Powrót z ekranu zgody WHOOP: weryfikacja state, wymiana kodu na tokeny, zapis połączenia,
// pierwsze pobranie 30 dni historii → pulpit.
export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const back = (s: string) => {
    const r = NextResponse.redirect(`${appUrl}/dashboard?whoop=${s}`);
    r.cookies.set('whoop_state', '', { path: '/api/whoop', maxAge: 0 });
    return r;
  };
  const sp = req.nextUrl.searchParams;
  const code = sp.get('code');
  if (sp.get('error') || !code) return back('denied');
  const state = sp.get('state');
  const expected = req.cookies.get('whoop_state')?.value;
  if (!state || !expected || state !== expected) return back('state');

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${appUrl}/login`);
  const { data: athlete } = await supabase.from('athletes').select('id').eq('user_id', user.id).maybeSingle();
  if (!athlete) return back('no_athlete');
  const athleteId = athlete.id as string;

  let tokens: Awaited<ReturnType<typeof exchangeWhoopCode>>;
  try {
    tokens = await exchangeWhoopCode(code);
  } catch (e) {
    console.error('[whoop callback] token', e instanceof Error ? e.message : e);
    return back('failed');
  }

  // profil (id użytkownika WHOOP) i pomiary ciała – best-effort
  const [profile, body] = await Promise.all([
    whoopGet<{ user_id?: number }>(tokens.access_token, '/v2/user/profile/basic').catch(() => null),
    whoopGet<Record<string, unknown>>(tokens.access_token, '/v2/user/measurement/body').catch(() => null),
  ]);

  const { error } = await supabase.from('whoop_connections').upsert({
    athlete_id: athleteId,
    whoop_user_id: profile?.user_id ?? null,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
    scope: tokens.scope ?? null,
    body,
    connected_at: new Date().toISOString(),
    sync_error: null,
  }, { onConflict: 'athlete_id' });
  if (error) {
    console.error('[whoop callback] save', error.message);
    return back(/whoop_connections|does not exist|schema cache/i.test(error.message) ? 'migration' : 'save_failed');
  }

  const res = await syncWhoop(supabase, athleteId, { days: 30 });
  return back(res.ok ? 'connected' : 'sync_failed');
}
