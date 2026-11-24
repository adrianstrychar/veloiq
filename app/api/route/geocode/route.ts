import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { photonUrl, placesFromPhoton } from '@/lib/route/geocode';

export const dynamic = 'force-dynamic';

// Szukanie miejsc do planera tras: GET ?q=…&lat=…&lon=… → { places: [{ name, label, lat, lon }] }
export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ places: [] });
  const lat = Number(req.nextUrl.searchParams.get('lat')), lon = Number(req.nextUrl.searchParams.get('lon'));
  const near = Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) ? { lat, lon } : null;
  try {
    const r = await fetch(photonUrl(q, near), { headers: { 'User-Agent': 'VeloIQ/1.0 (+https://veloiq-three.vercel.app)' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`photon ${r.status}`);
    return NextResponse.json({ places: placesFromPhoton(await r.json()) });
  } catch (e) {
    console.error('[route/geocode]', e instanceof Error ? e.message : e);
    return NextResponse.json({ places: [], message: 'Wyszukiwarka miejsc nie odpowiada.' }, { status: 502 });
  }
}
