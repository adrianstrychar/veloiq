import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { fetchPois } from '@/lib/route/pois';
import { readPoints } from '@/lib/garmin/course';
import type { RideRoute } from '@/lib/ride/gpx';

export const dynamic = 'force-dynamic';
export const maxDuration = 40;

// „Przed tobą” dla trasy: POST { route: RideRoute } → { pois: [{ d, kind, name, off }] }
export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { route?: RideRoute };
  try {
    const pts = readPoints(b.route?.pts);
    const route = { ...(b.route as RideRoute), pts: pts.map((p) => [p.lat, p.lon, p.ele, p.d] as [number, number, number | null, number]), total: Math.round(pts[pts.length - 1].d) };
    return NextResponse.json({ pois: await fetchPois(route) });
  } catch (e) {
    console.error('[route/pois]', e instanceof Error ? e.message : e);
    return NextResponse.json({ pois: [], message: 'Nie udało się pobrać punktów po drodze.' }, { status: 502 });
  }
}
