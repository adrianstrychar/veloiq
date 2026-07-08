import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { refreshStravaToken, fetchStravaActivityDetail, updateStravaActivity } from '@/lib/strava';
import { buildDescription } from '@/lib/writeback';

// Write-back opisu jazdy do Stravy (Etap 1: przycisk + podgląd + potwierdzenie).
// action='preview' → buduje finalny opis z LABELA dopasowanej sesji + aktualnego opisu ze Stravy,
//   ZWRACA podgląd, NIC nie zapisuje. action='commit' → re-fetch opisu, PUT (dopiero tu zapis).
// Dopasowanie label = data jazdy → dzień planu (jak reszta apki: data + max-TSS, bez typu) — user
// potwierdza podgląd, więc heurystyka wystarcza. Auto (bez potwierdzenia) świadomie NIE istnieje.

interface PlanDayRow { dow: number; type: string; label: string }

function hasWriteScope(scope: string | null | undefined): boolean {
  return !!scope && scope.split(',').map((s) => s.trim()).includes('activity:write');
}

// Label dopasowanej sesji dla daty jazdy. null = OFF / brak planu / ta jazda NIE jest sesją dnia
// (nie ma najwyższego TSS — to jazda poza planem, nie dostaje nazwy zaplanowanego treningu).
async function matchSessionLabel(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  athleteId: string,
  activity: { strava_activity_id: number; activity_date: string; tss: number | null }
): Promise<string | null> {
  const date = activity.activity_date;
  // Ta jazda musi być sesją dnia = najwyższy TSS tej daty (spójnie z matchingiem w Plan.tsx).
  const { data: sameDay } = await supabase
    .from('strava_activities')
    .select('strava_activity_id, tss')
    .eq('athlete_id', athleteId)
    .eq('activity_date', date);
  const maxTss = Math.max(...(sameDay ?? []).map((r) => Number(r.tss) || 0));
  if ((Number(activity.tss) || 0) < maxTss) return null; // to nie jest sesja dnia

  const d = new Date(date + 'T00:00:00Z');
  const dow = ((d.getUTCDay() + 6) % 7) + 1;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (dow - 1));
  const weekStart = monday.toISOString().slice(0, 10);

  const { data: plan } = await supabase
    .from('weekly_plans')
    .select('plan_json')
    .eq('athlete_id', athleteId)
    .eq('week_start', weekStart)
    .maybeSingle();
  const day = (plan?.plan_json as { days?: PlanDayRow[] } | null)?.days?.find((x) => x.dow === dow);
  if (!day || day.type === 'OFF') return null; // brak sesji do opisania
  const label = (day.label ?? '').trim();
  return label.length ? label : null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const stravaActivityId = params.id;
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action === 'commit' ? 'commit' : 'preview';

  const { data: activity } = await supabase
    .from('strava_activities')
    .select('athlete_id, strava_activity_id, activity_date, tss')
    .eq('strava_activity_id', stravaActivityId)
    .maybeSingle();
  if (!activity) return NextResponse.json({ ok: false, error: 'activity_not_found' }, { status: 404 });

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, user_id, strava_scope, strava_access_token, strava_refresh_token, strava_token_expires_at')
    .eq('id', activity.athlete_id)
    .single();
  if (!athlete || athlete.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const label = await matchSessionLabel(supabase, athlete.id as string, activity as never);
  if (!label) return NextResponse.json({ ok: false, reason: 'no_session', message: 'Ta jazda nie jest dopasowana do zaplanowanej sesji — nie ma nazwy treningu do opisania.' });

  const canWrite = hasWriteScope(athlete.strava_scope as string | null);

  // ── PREVIEW: nie potrzebuje write; pokazuje podgląd i informuje czy jest scope do zapisu ──
  // Odśwież token jeśli wygasł (read i tak go użyje).
  let accessToken = athlete.strava_access_token as string;
  const expiresAt = athlete.strava_token_expires_at ? new Date(athlete.strava_token_expires_at as string).getTime() : 0;
  if (expiresAt < Date.now()) {
    try {
      const refreshed = await refreshStravaToken(athlete.strava_refresh_token as string);
      accessToken = refreshed.access_token;
      await supabase.from('athletes').update({
        strava_access_token: refreshed.access_token,
        strava_refresh_token: refreshed.refresh_token,
        strava_token_expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
      }).eq('id', athlete.id);
    } catch {
      return NextResponse.json({ ok: false, reason: 'strava_unavailable', message: 'Nie mogę teraz połączyć się ze Stravą.' });
    }
  }

  let detail: { description: string | null };
  try {
    detail = await fetchStravaActivityDetail(accessToken, stravaActivityId);
  } catch {
    return NextResponse.json({ ok: false, reason: 'strava_unavailable', message: 'Nie mogę pobrać opisu jazdy ze Stravy.' });
  }
  const built = buildDescription(detail.description, label);

  if (action === 'preview') {
    return NextResponse.json({
      ok: true,
      canWrite,
      label,
      line: built.line,
      preview: built.text,               // CAŁY finalny opis do pokazania userowi
      alreadyDescribed: built.alreadyPresent,
    });
  }

  // ── COMMIT: dopiero tu zapis. Wymaga write scope + świeżego potwierdzenia (UI wysyła commit). ──
  if (!canWrite) {
    return NextResponse.json({ ok: false, reason: 'no_write_scope', message: 'Zapis opisów wymaga rozszerzenia uprawnień Strava.' });
  }
  if (built.alreadyPresent) {
    return NextResponse.json({ ok: true, saved: false, alreadyDescribed: true, message: 'Ta jazda jest już opisana przez VeloIQ.' });
  }
  const res = await updateStravaActivity(accessToken, stravaActivityId, { description: built.text });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ ok: false, reason: 'no_write_scope', message: 'Strava odrzuciła zapis (brak uprawnień). Rozszerz uprawnienia i spróbuj ponownie.' });
    }
    return NextResponse.json({ ok: false, reason: 'strava_error', message: `Strava zwróciła błąd (${res.status}).` });
  }
  return NextResponse.json({ ok: true, saved: true, alreadyDescribed: false, message: 'Opisano w Strava.' });
}
