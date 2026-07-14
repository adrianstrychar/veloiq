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

// ── Callback OAuth: rozstrzygnięcie INSERT vs UPDATE + prefill + redirect ─────────────────────────
export interface CallbackExisting {
  onboarding_completed: boolean | null;
  weight_kg: number | null;
  sex: Sex | null;
  ftp_watts: number | null;
}
export interface StravaPrefill {
  weight: number | null;
  ftp: number | null;
  sex: Sex | null;
}

// Rozstrzyga, co callback ma zapisać i dokąd przekierować — 3 ścieżki (nowy / przerwał / gotowy).
// Kluczowe reguły (Strava-first, zachowanie danych usera):
//  • NOWY (brak wiersza) → INSERT: onboarding_completed=false, prefill ze Stravy, ftp_source=null → /onboarding.
//  • ISTNIEJĄCY completed=false (przerwał onboarding / reconnect) → UPDATE: onboarding_completed ZOSTAJE
//    false; profil = COALESCE(existing, strava) (zachowaj wpisane, uzupełnij TYLKO puste) → /onboarding.
//  • ISTNIEJĄCY completed=true (normalny reconnect, np. Adrian) → UPDATE tylko tokeny; NIE dotykaj
//    profilu ani flagi (profileWrite=null) → /dashboard. Zero wyrzucenia na onboarding, zero pętli.
// Callback NIGDY nie ustawia onboarding_completed=true (robi to dopiero „Zaczynamy").
export function resolveCallbackUpsert(
  existing: CallbackExisting | null,
  strava: StravaPrefill
): {
  isNew: boolean;
  completed: boolean;
  profileWrite: { weight_kg: number | null; ftp_watts: number | null; sex: Sex | null } | null; // null = NIE ruszaj profilu
  redirect: '/onboarding' | '/dashboard';
} {
  if (!existing) {
    return {
      isNew: true, completed: false,
      profileWrite: { weight_kg: strava.weight, ftp_watts: strava.ftp, sex: strava.sex },
      redirect: '/onboarding',
    };
  }
  if (existing.onboarding_completed === true) {
    return { isNew: false, completed: true, profileWrite: null, redirect: '/dashboard' };
  }
  return {
    isNew: false, completed: false,
    profileWrite: {
      weight_kg: existing.weight_kg ?? strava.weight,   // COALESCE: wpisane wygrywa, Strava tylko dopełnia
      ftp_watts: existing.ftp_watts ?? strava.ftp,
      sex: existing.sex ?? strava.sex,
    },
    redirect: '/onboarding',
  };
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
