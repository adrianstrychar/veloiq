import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase';
import { buildCourse, CourseError, deleteCourse, loadCourse, saveCourse } from '@/lib/garmin/course';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

// Trasa GPX na licznik Garmin – strona aplikacji (sesja użytkownika). Licznik pobiera ją sam przy
// synchronizacji (/api/garmin/sync podaje identyfikator, /api/garmin/course/part – nagłówek i punkty).
//   GET    – co jest teraz przygotowane dla licznika
//   POST   – wyślij trasę z modułu „Jedź” (RideRoute; z celami mocy na podjazdach, jeśli włączony tryb startowy)
//   DELETE – usuń trasę z licznika (zniknie przy najbliższej synchronizacji)

async function userId(): Promise<string | null> {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

const info = (c: Awaited<ReturnType<typeof loadCourse>>) => (c
  ? { id: c.id, name: c.name, total: c.total, gain: c.gain, points: c.n, cues: c.cues.length, climbs: c.climbs.length, targets: c.climbs.filter((x) => x[4] > 0).length, savedAt: c.savedAt }
  : null);

export async function GET() {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  return NextResponse.json({ course: info(await loadCourse(createAdminSupabaseClient(), uid)) });
}

export async function POST(req: NextRequest) {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { route?: unknown } | null;
  if (!body?.route) return NextResponse.json({ error: 'bad_request', message: 'Brak trasy.' }, { status: 400 });
  try {
    const course = buildCourse(body.route);
    await saveCourse(createAdminSupabaseClient(), uid, course);
    return NextResponse.json({ ok: true, course: info(course) });
  } catch (e) {
    if (e instanceof CourseError) return NextResponse.json({ error: 'bad_route', message: e.message }, { status: 422 });
    console.error('[garmin/course]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'server_error', message: 'Nie udało się zapisać trasy.' }, { status: 500 });
  }
}

export async function DELETE() {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  await deleteCourse(createAdminSupabaseClient(), uid);
  return NextResponse.json({ ok: true });
}
