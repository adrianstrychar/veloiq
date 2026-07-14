// Helpery onboardingu — współdzielone przez gate (layout), stronę /onboarding i API zapisu.

export type FtpSource = 'strava_profile' | 'manual' | 'engine';
export type TrainingMode = 'power' | 'hr' | 'basic';
export type Sex = 'M' | 'F';

// Domyślny FTP dla usera BEZ żadnych danych (nowy w kolarstwie, brak historii, "ustawię później").
// Cel: sensowny punkt startowy, żeby plan był generowalny a prognoza miała od czego ruszyć (graceful
// pustka), NIE precyzja. ~2.0 W/kg (początkujący amator) skorygowane płcią; bez wagi — flat wg płci.
export function defaultFtpFor(weightKg: number | null, sex: Sex | null): number {
  const wPerKg = sex === 'F' ? 1.8 : 2.0;
  if (weightKg && weightKg > 0) return Math.round(weightKg * wPerKg);
  return sex === 'F' ? 130 : 160; // brak wagi → ostrożny flat
}

// Czy profil jest kompletny na tyle, by przepuścić usera do apki. Jedyne źródło prawdy: flaga.
// (Dane mogą dojrzewać w tle — nie blokujemy na FTP silnikowym.)
export function isProfileComplete(athlete: { onboarding_completed?: boolean | null } | null): boolean {
  return athlete?.onboarding_completed === true;
}

// Czy silnik ma PROMOWAĆ wstępny FTP z onboardingu na policzony (moment wartości). TRUE tylko dla
// usera po onboardingu z FTP jeszcze wstępnym (strava_profile/manual) i bez ftp_updated_at.
// Chroni istniejących (ftp_source='engine' z migracji 018 → false) i przed-onboardingowy sync
// (onboarding_completed=false → false). Jedno źródło reguły dla sync + testów.
export function shouldPromoteToEngine(a: {
  onboarding_completed?: boolean | null;
  ftp_source?: string | null;
  ftp_updated_at?: string | null;
}): boolean {
  return (
    a.onboarding_completed === true &&
    (a.ftp_source === 'strava_profile' || a.ftp_source === 'manual') &&
    a.ftp_updated_at == null
  );
}
