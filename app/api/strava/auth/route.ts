import { NextResponse } from 'next/server';

// Inicjacja OAuth — przekierowanie do Stravy (sekcja 14)
export async function GET() {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID!,
    redirect_uri: process.env.NEXT_PUBLIC_STRAVA_REDIRECT_URI!,
    response_type: 'code',
    // 'force' — nowe uprawnienie (activity:write) wymaga re-consentu; przy 'auto' Strava mogłaby
    // pominąć ekran zgody dla już-połączonego konta i NIE przyznać write. Force gwarantuje zgodę.
    approval_prompt: 'force',
    // activity:write dodane pod Etap 1 (write-back opisu jazdy). Istniejące konta MUSZĄ ponownie
    // autoryzować — scope'u nie da się dodać wstecz do wydanego tokenu.
    scope: 'read,activity:read_all,profile:read_all,activity:write',
  });

  return NextResponse.redirect(
    `https://www.strava.com/oauth/authorize?${params.toString()}`
  );
}
