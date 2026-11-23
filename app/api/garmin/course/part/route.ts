import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase';
import { verifyDevice } from '@/lib/garmin/auth';
import { courseMeta, loadCourse } from '@/lib/garmin/course';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

// Licznik pobiera trasę w małych odpowiedziach: ?i=meta → nagłówek (nazwa, skręty, podjazdy),
// ?i=0…n-1 → kolejne części punktów (base64). `id` pilnuje, żeby części nie pomieszały się po zmianie trasy.
export async function GET(req: NextRequest) {
  const admin = createAdminSupabaseClient();
  const dev = await verifyDevice(admin, req.headers.get('authorization'));
  if (!dev) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const course = await loadCourse(admin, dev.userId);
  if (!course) return NextResponse.json({ error: 'no_course' }, { status: 404 });

  const i = req.nextUrl.searchParams.get('i') ?? 'meta';
  if (i === 'meta') return NextResponse.json(courseMeta(course));

  const want = req.nextUrl.searchParams.get('id');
  if (want && want !== course.id) return NextResponse.json({ error: 'changed', id: course.id }, { status: 409 });
  const n = Number(i);
  if (!Number.isInteger(n) || n < 0 || n >= course.parts.length) return NextResponse.json({ error: 'bad_part' }, { status: 400 });
  return NextResponse.json({ id: course.id, i: n, d: course.parts[n] });
}
