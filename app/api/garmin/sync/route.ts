import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase';
import { verifyDevice } from '@/lib/garmin/auth';
import { buildGarminSync } from '@/lib/garmin/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

// Licznik pobiera: zawodnika (FTP, HRmax, waga), treningi z planu na dziś i 6 kolejnych dni, odprawę na dziś.
export async function GET(req: NextRequest) {
  const admin = createAdminSupabaseClient();
  const dev = await verifyDevice(admin, req.headers.get('authorization'));
  if (!dev) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const out = await buildGarminSync(admin, dev.userId);
    if (!out) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });
    return NextResponse.json(out);
  } catch (e) {
    console.error('[garmin/sync]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
