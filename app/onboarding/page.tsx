import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase';
import { fetchStravaAthleteProfile } from '@/lib/strava';
import { isProfileComplete, type Sex } from '@/lib/onboarding';
import { OnboardingForm } from '@/components/veloiq/OnboardingForm';

// Ekran onboardingu — POZA grupą (app), więc bez bramki (żadnej pętli redirectu) i bez BottomNav.
// Auth chroni middleware. Prefill z profilu Strava pobierany NA ŻYWO (bez persystencji do "Zaczynamy").
export default async function OnboardingPage() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, name, weight_kg, sex, ftp_watts, onboarding_completed, strava_access_token')
    .eq('user_id', user.id)
    .maybeSingle();

  // Brak wiersza = nie podłączył Stravy → nie ma czego onbordować, wraca na dashboard (CTA "Połącz").
  if (!athlete) redirect('/dashboard');
  // Już przeszedł onboarding → nie pokazuj drugi raz.
  if (isProfileComplete(athlete)) redirect('/dashboard');

  // Prefill: profil Strava na żywo (best-effort — token wygasły / brak danych → puste pola, user dopyta).
  let stravaWeight: number | null = null;
  let stravaFtp: number | null = null;
  let stravaSex: Sex | null = null;
  if (athlete.strava_access_token) {
    try {
      const p = await fetchStravaAthleteProfile(athlete.strava_access_token as string);
      stravaWeight = p.weight;
      stravaFtp = p.ftp;
      stravaSex = p.sex;
    } catch {
      // degradacja: brak prefillu, formularz startuje pusty
    }
  }

  const prefill = {
    name: (athlete.name as string | null) ?? null,
    weight: (athlete.weight_kg != null ? Number(athlete.weight_kg) : null) ?? stravaWeight,
    sex: ((athlete.sex as Sex | null) ?? stravaSex),
    ftp: (athlete.ftp_watts as number | null) ?? stravaFtp,
    ftpFromStrava: stravaFtp != null && athlete.ftp_watts == null, // FTP pochodzi z profilu Strava (nie ręczny)
  };

  return <OnboardingForm prefill={prefill} />;
}
