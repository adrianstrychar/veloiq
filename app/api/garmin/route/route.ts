import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase';
import { verifyDevice } from '@/lib/garmin/auth';
import { buildCourse, courseMeta, CourseError, decodeParts, loadCourse, saveCourse } from '@/lib/garmin/course';
import { planRoutes } from '@/lib/route/plan';
import { PROFILES, RoutingError, type RouteProfile } from '@/lib/route/brouter';
import { rejoinIndex, spliceCourse } from '@/lib/route/reroute';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Licznik prosi o nową trasę w trakcie jazdy (token urządzenia):
//   POST { to:'start'|'rejoin', lat, lon, sLat?, sLon?, prog? }
//   start  – z bieżącej pozycji do miejsca startu jazdy (sLat/sLon), profilem ostatniej trasy
//   rejoin – dojazd do trasy ~300 m – 6 km przed ostatnim postępem (prog, m) + reszta trasy
// → nagłówek trasy jak /api/garmin/course/part?i=meta (licznik pobiera części zwykłą drogą) + "say" dla Enzo.
export async function POST(req: NextRequest) {
  const admin = createAdminSupabaseClient();
  const dev = await verifyDevice(admin, req.headers.get('authorization'));
  if (!dev) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const lat = Number(b.lat), lon = Number(b.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: 'no_position', message: 'Brak pozycji GPS.' }, { status: 400 });
  }
  const stored = await loadCourse(admin, dev.userId);
  const profile = (PROFILES as string[]).includes(String(b.prof ?? stored?.prof)) ? (String(b.prof ?? stored?.prof) as RouteProfile) : 'road';
  const { data: ath } = await admin.from('athletes').select('ftp_watts, weight_kg').eq('user_id', dev.userId).maybeSingle();
  const rider = { ftp: Number(ath?.ftp_watts) || 230, weight: Number(ath?.weight_kg) || 75 };

  try {
    if (b.to === 'rejoin') {
      if (!stored) return NextResponse.json({ error: 'no_course', message: 'Brak trasy na liczniku.' }, { status: 404 });
      const pts = decodeParts(stored.parts);
      const idx = rejoinIndex(pts, { lat, lon }, Math.max(0, Number(b.prog) || 0));
      const target = pts[idx];
      const [approach] = await planRoutes({ mode: 'ab', start: { lat, lon }, end: { lat: target.lat, lon: target.lon }, profile, name: stored.name }, rider);
      const course = buildCourse(spliceCourse(approach.route, stored, idx));
      await saveCourse(admin, dev.userId, course);
      const back = Math.round(approach.stats.total / 100) / 10;
      return NextResponse.json({ ...courseMeta(course), say: `Nowa trasa: ${back} kilometra do powrotu na trasę.` });
    }
    const sLat = Number(b.sLat), sLon = Number(b.sLon);
    if (!Number.isFinite(sLat) || !Number.isFinite(sLon) || (sLat === 0 && sLon === 0)) {
      return NextResponse.json({ error: 'no_start', message: 'Nie znam miejsca startu.' }, { status: 400 });
    }
    const [r] = await planRoutes({ mode: 'ab', start: { lat, lon }, end: { lat: sLat, lon: sLon }, profile, name: 'Powrót do startu' }, rider);
    const course = buildCourse(r.route);
    await saveCourse(admin, dev.userId, course);
    const km = Math.round(r.stats.total / 100) / 10;
    return NextResponse.json({ ...courseMeta(course), say: `Prowadzę do startu: ${km} kilometra, około ${Math.round(r.stats.estSec / 60)} minut.` });
  } catch (e) {
    const msg = e instanceof RoutingError || e instanceof CourseError ? e.message : 'Nie udało się wyznaczyć trasy.';
    console.error('[garmin/route]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'route_failed', message: msg }, { status: 502 });
  }
}
