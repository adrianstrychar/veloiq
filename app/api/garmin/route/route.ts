import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase';
import { verifyDevice } from '@/lib/garmin/auth';
import { buildCourse, courseMeta, CourseError, decodeParts, loadCourse, POI_CODES, saveCourse, type StoredCourse } from '@/lib/garmin/course';
import { planRoutes } from '@/lib/route/plan';
import { PROFILES, RoutingError, type RouteProfile } from '@/lib/route/brouter';
import { rejoinIndex, spliceCourse } from '@/lib/route/reroute';
import { photonUrl, placesFromPhoton } from '@/lib/route/geocode';
import { nearestPoi } from '@/lib/route/pois';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Licznik prosi o nową trasę w trakcie jazdy (token urządzenia):
//   POST { to:'start'|'rejoin', lat, lon, sLat?, sLon?, prog? }
//   start  – z bieżącej pozycji do miejsca startu jazdy (sLat/sLon), profilem ostatniej trasy
//   rejoin – dojazd do trasy ~300 m – 6 km przed ostatnim postępem (prog, m) + reszta trasy
//   place  – do miejsca z polecenia głosowego (q: „Szklarska Poręba”, „dworzec w Jeleniej Górze”) – geokoder blisko nas
//   poi    – do najbliższego punktu (kind: cafe | water | bike | toilets | shop | fuel) w promieniu 8 km
//   start / place / poi to objazdy: główna trasa zostaje w zapisie (base), „rejoin” wraca na nią
// → nagłówek trasy jak /api/garmin/course/part?i=meta (licznik pobiera części zwykłą drogą) + "say" dla Enzo,
//   albo { keep: true, say } – szukany punkt jest już na trasie przed nami, trasa się nie zmienia.
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
    // trwa objazd → „na trasę” znaczy na główną trasę, od miejsca, w którym z niej zjechaliśmy
    const prog = Math.max(0, Number(b.prog) || 0);
    const detour = () => (stored ? { base: stored.base ?? stored, baseProg: stored.base ? stored.baseProg ?? 0 : prog } : {});
    if (b.to === 'rejoin') {
      if (!stored) return NextResponse.json({ error: 'no_course', message: 'Brak trasy na liczniku.' }, { status: 404 });
      const main = stored.base ?? stored;
      const pts = decodeParts(main.parts);
      const idx = rejoinIndex(pts, { lat, lon }, stored.base ? stored.baseProg ?? 0 : prog);
      const target = pts[idx];
      const [approach] = await planRoutes({ mode: 'ab', start: { lat, lon }, end: { lat: target.lat, lon: target.lon }, profile, name: main.name }, rider);
      const course = buildCourse(spliceCourse(approach.route, main, idx));
      await saveCourse(admin, dev.userId, course);
      const back = Math.round(approach.stats.total / 100) / 10;
      return NextResponse.json({ ...courseMeta(course), say: `Nowa trasa: ${back} kilometra do powrotu na trasę.` });
    }
    if (b.to === 'place' || b.to === 'poi') {
      let dest: { lat: number; lon: number; name: string } | null = null;
      if (b.to === 'place') {
        const q = String(b.q ?? '').trim().slice(0, 80);
        if (q.length < 2) return NextResponse.json({ error: 'no_place', message: 'Nie usłyszałem nazwy miejsca.' }, { status: 400 });
        const r = await fetch(photonUrl(q, { lat, lon }, 3), { headers: { 'User-Agent': 'VeloIQ/1.0 (+https://veloiq-three.vercel.app)' }, signal: AbortSignal.timeout(8000) });
        const p = r.ok ? placesFromPhoton(await r.json())[0] : undefined;
        if (p) dest = { lat: p.lat, lon: p.lon, name: p.name };
        if (!dest) return NextResponse.json({ error: 'not_found', message: `Nie znalazłem: ${q}.` }, { status: 404 });
      } else {
        const kind = String(b.kind ?? 'cafe');
        // taki punkt jest już na trasie przed nami (do 6 km) → nie zmieniamy trasy, tylko mówimy, gdzie
        const code = (POI_CODES as readonly string[]).indexOf(kind);
        const ahead = (stored?.pois ?? []).find((x) => x[1] === code && Number(x[0]) >= prog - 50 && Number(x[0]) <= prog + 6000);
        if (ahead) {
          const km = Math.max(0.1, Math.round((Number(ahead[0]) - prog) / 100) / 10);
          return NextResponse.json({ keep: true, say: `${String(ahead[2]) || 'Jest'} – na trasie za ${km} kilometra. Jedziemy dalej tą trasą.` });
        }
        const p = await nearestPoi({ lat, lon }, kind);
        if (!p) return NextResponse.json({ error: 'not_found', message: 'W pobliżu nic takiego nie znalazłem.' }, { status: 404 });
        dest = p;
      }
      const [r2] = await planRoutes({ mode: 'ab', start: { lat, lon }, end: { lat: dest.lat, lon: dest.lon }, profile, name: dest.name.slice(0, 40) }, rider);
      const course: StoredCourse = { ...buildCourse(r2.route), ...detour() };
      await saveCourse(admin, dev.userId, course);
      const km2 = Math.round(r2.stats.total / 100) / 10;
      const back = course.base ? ' Potem powiedz: wróć na trasę.' : '';
      return NextResponse.json({ ...courseMeta(course), say: `Prowadzę do: ${dest.name}. ${km2} kilometra, około ${Math.round(r2.stats.estSec / 60)} minut.${back}` });
    }
    const sLat = Number(b.sLat), sLon = Number(b.sLon);
    if (!Number.isFinite(sLat) || !Number.isFinite(sLon) || (sLat === 0 && sLon === 0)) {
      return NextResponse.json({ error: 'no_start', message: 'Nie znam miejsca startu.' }, { status: 400 });
    }
    const [r] = await planRoutes({ mode: 'ab', start: { lat, lon }, end: { lat: sLat, lon: sLon }, profile, name: 'Powrót do startu' }, rider);
    const course: StoredCourse = { ...buildCourse(r.route), ...detour() };
    await saveCourse(admin, dev.userId, course);
    const km = Math.round(r.stats.total / 100) / 10;
    return NextResponse.json({ ...courseMeta(course), say: `Prowadzę do startu: ${km} kilometra, około ${Math.round(r.stats.estSec / 60)} minut.` });
  } catch (e) {
    const msg = e instanceof RoutingError || e instanceof CourseError ? e.message : 'Nie udało się wyznaczyć trasy.';
    console.error('[garmin/route]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'route_failed', message: msg }, { status: 502 });
  }
}
