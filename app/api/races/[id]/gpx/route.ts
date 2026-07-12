import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { parseGpx, gpxName, GpxError } from '@/lib/route/parse-gpx';
import { analyzeRoute } from '@/lib/route/detect-climbs';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — kursy GPX to 260-460 KB, activity ~2 MB; 5 MB z zapasem.

// POST — wgranie GPX: parse w pamięci → analiza → zapis TYLKO route_analysis do race_plans.
// Surowy XML NIGDZIE nie trafia (parse-and-discard, zero Supabase Storage).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const raceId = params.id;
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const { data: athlete } = await supabase.from('athletes').select('id').eq('user_id', user.id).single();
  if (!athlete) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });

  // Ownership: wyścig należy do atlety.
  const { data: raceRow } = await supabase
    .from('race_calendar').select('id').eq('id', raceId).eq('athlete_id', athlete.id).maybeSingle();
  if (!raceRow) return NextResponse.json({ error: 'race_not_found' }, { status: 404 });

  // Plik z multipart/form-data.
  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get('file');
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: 'Nieprawidłowe dane formularza.' }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: 'Brak pliku GPX.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Plik za duży (limit 5 MB).' }, { status: 413 });

  // Parse + analiza. Błędy GPX → czytelny 422 (nie crash).
  let analysis, routeName: string;
  try {
    const xml = await file.text();
    const points = parseGpx(xml);
    analysis = analyzeRoute(points);
    routeName = (file.name && file.name.replace(/\.gpx$/i, '')) || gpxName(xml) || 'Trasa';
  } catch (err: unknown) {
    if (err instanceof GpxError) return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    return NextResponse.json({ error: 'Nie udało się odczytać pliku GPX.' }, { status: 422 });
  }

  // Upsert race_plans — aktualizuje TYLKO kolumny trasy (zachowuje istniejącą strategię, jeśli jest).
  const { error: upErr } = await supabase.from('race_plans').upsert(
    {
      athlete_id: athlete.id,
      race_id: raceId,
      route_analysis: analysis,
      route_name: routeName,
      route_uploaded_at: new Date().toISOString(),
    },
    { onConflict: 'athlete_id,race_id' },
  );
  if (upErr) return NextResponse.json({ error: 'Nie udało się zapisać trasy.' }, { status: 500 });

  return NextResponse.json({ analysis, route_name: routeName });
}
