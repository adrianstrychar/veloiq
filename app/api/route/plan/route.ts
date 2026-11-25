import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { planRoutes, type PlanRequest } from '@/lib/route/plan';
import { PROFILES, RoutingError, type LatLon, type RouteOptions, type RouteProfile } from '@/lib/route/brouter';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Planer tras (sesja użytkownika): POST { mode:'ab'|'loop', start:{lat,lon}, end?, vias?, loopKm?, heading?, seed?,
// profile:'road'|'gravel'|'mtb'|'calm', opts?: { quiet, flow, flat, green, moreUnpaved }, name? }
// → { routes: [{ route: RideRoute, stats, tag, heading? }] }
const ll = (v: unknown): LatLon | null => {
  const o = (v ?? {}) as Record<string, unknown>;
  const lat = Number(o.lat), lon = Number(o.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
};

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const start = ll(b.start);
  if (!start) return NextResponse.json({ error: 'bad_request', message: 'Brak punktu startu.' }, { status: 400 });
  const mode = b.mode === 'loop' ? 'loop' : 'ab';
  const end = ll(b.end);
  if (mode === 'ab' && !end) return NextResponse.json({ error: 'bad_request', message: 'Wybierz cel trasy.' }, { status: 400 });
  const vias = (Array.isArray(b.vias) ? b.vias : []).map(ll).filter((x): x is LatLon => !!x).slice(0, 8);
  const profile = (PROFILES as string[]).includes(String(b.profile)) ? (b.profile as RouteProfile) : 'road';
  const o = (b.opts ?? {}) as Record<string, unknown>;
  const opts: RouteOptions = { quiet: o.quiet !== false, flow: !!o.flow, flat: !!o.flat, green: !!o.green, moreUnpaved: o.moreUnpaved !== false };
  const heading = b.heading == null || b.heading === '' ? null : Number(b.heading);
  const plan: PlanRequest = {
    mode, start, end: end ?? undefined, vias, profile, opts,
    loopKm: Number(b.loopKm) || 50, heading: Number.isFinite(heading as number) ? (heading as number) : null,
    seed: Number(b.seed) || 0, name: typeof b.name === 'string' ? b.name.slice(0, 40) : undefined,
  };
  const { data: ath } = await supabase.from('athletes').select('ftp_watts, weight_kg').eq('user_id', user.id).maybeSingle();
  const rider = { ftp: Number(ath?.ftp_watts) || 230, weight: Number(ath?.weight_kg) || 75 };
  try {
    const routes = await planRoutes(plan, rider);
    return NextResponse.json({ routes, rider });
  } catch (e) {
    const msg = e instanceof RoutingError ? e.message : 'Nie udało się wyznaczyć trasy.';
    console.error('[route/plan]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: e instanceof RoutingError ? e.code : 'server', message: msg }, { status: 502 });
  }
}
