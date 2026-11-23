import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase';
import { verifyDevice } from '@/lib/garmin/auth';
import { buildGarminSync } from '@/lib/garmin/sync';
import { signRideToken } from '@/lib/ride/ride-token';
import { loadCourse } from '@/lib/garmin/course';

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
    // rideToken: krótki token rozmowy z trenerem (/api/ride/ask) – licznik przekazuje go telefonowi przez most,
    // żeby pytania głosowe działały także przy treningu uruchomionym na liczniku. Ważny 36 h (do następnej synchronizacji).
    // courseId: identyfikator trasy GPX przygotowanej dla licznika (null = brak) – licznik pobiera ją osobno, częściami.
    const course = await loadCourse(admin, dev.userId).catch(() => null);
    return NextResponse.json({ ...out, rideToken: signRideToken(dev.userId, 36 * 3600), courseId: course?.id ?? null });
  } catch (e) {
    console.error('[garmin/sync]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
