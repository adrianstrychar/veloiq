// Konsolidacja jazd jednego dnia — JEDNO ŹRÓDŁO PRAWDY dla "która jazda jest główna / czy dzień
// jest done / co jest drugorzędne". Wyodrębnione z inline'u w Plan.tsx (jak race-overlay /
// calendar-events): logika testowalna przez jiti, JSX tylko renderuje wynik. Plan.tsx woła tę
// funkcję i NIE trzyma własnej kopii obok.
//
// ZASADA (decyzje A/C):
// - main = jazda o NAJWYŻSZYM TSS (decyzja A) — dla KAŻDEGO dnia z jazdami, niezależnie od typu.
// - done = czy main SPEŁNIA PLAN dnia: dzień treningowy LUB RACE z jazdą (decyzja C domyka RACE).
//   OFF/usunięty → done=false (plan nie przewidywał treningu; jazdy są POZA PLANEM), ale main dalej
//   wybierany, żeby skonsolidować widok (jedna karta zamiast N).
// - secondaries = pozostałe jazdy (zwijane pod główną). Ich TSS NIE ginie — forma/statystyki i tak
//   sumują wszystkie jazdy (liczenie niezależne od tej konsolidacji); secondaryTss to tylko
//   informacja dla usera, skąd obciążenie dnia.
export function consolidateDayActivities<T extends { tss?: number | null }>(
  list: T[],
  dayType: string,
  removed: boolean
): { main: T | null; secondaries: T[]; done: boolean; secondaryTss: number } {
  // Sort malejąco po TSS TU (nie ufamy kolejności wejścia) — jedno źródło reguły "główna = max TSS".
  const sorted = [...list].sort((a, b) => (b.tss ?? 0) - (a.tss ?? 0));
  const main = sorted.length > 0 ? sorted[0] : null;
  const secondaries = main ? sorted.slice(1) : [];
  const secondaryTss = Math.round(secondaries.reduce((a, s) => a + (s.tss ?? 0), 0));
  // fulfillsPlan: trening ORAZ RACE konsumują główną jazdę jako "wykonanie". OFF/usunięty — nie.
  const fulfillsPlan = dayType !== 'OFF' && !removed;
  return { main, secondaries, done: !!main && fulfillsPlan, secondaryTss };
}

// Polska odmiana licznika drugorzędnych jazd (1 dodatkowa / 2–4 dodatkowe / 5+ dodatkowych).
export function extraRidesLabel(n: number): string {
  if (n === 1) return '1 dodatkowa jazda';
  const last = n % 10;
  const last2 = n % 100;
  if (last >= 2 && last <= 4 && !(last2 >= 12 && last2 <= 14)) return `${n} dodatkowe jazdy`;
  return `${n} dodatkowych jazd`;
}
