// Guard taperu dla auto-korekt planu — date-based, czysty (bez I/O).
//
// Bramka tygodniowa scaleWeek (hasRace) chroni tylko tydzień kalendarzowy z dniem RACE.
// Taper A (6 dni) zahacza o POPRZEDNI tydzień, gdy start wypada na początku tygodnia —
// stąd predykat po datach: dzień w oknie [race_date − taperDaysFor(priority), race_date]
// jest NIETYKALNY dla każdej korekty, niezależnie od granic tygodni.
//
// Enforcement dwuwarstwowy (pas i szelki):
//  1) lockTaperDays — wstrzykuje locked:true w dni chronione PRZED wywołaniem mechanizmu
//     modyfikacji (scaleWeek i plan-modify już respektują locked),
//  2) taperViolations — post-check porównujący dni chronione przed/po; niepusty wynik
//     = korekta ODRZUCONA przed zapisem pending (nawet gdyby mechanizm zignorował locka).
import { taperDaysFor, type RacePriority } from '@/lib/race-taper';

export interface RaceRef {
  date: string;                    // ISO YYYY-MM-DD
  priority: string | null;         // 'A' | 'B' | 'C' | null → traktowane jak 'C' (taper 0 dni)
}

// ISO minus n dni (UTC-noon — bez pułapek DST).
function isoMinusDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Predykat "data w oknie taperu któregokolwiek startu". Zwraca też nazwę okna do komunikatów.
export function taperProtector(races: RaceRef[]): (date: string) => boolean {
  const windows = races
    .map((r) => {
      const days = taperDaysFor((r.priority ?? 'C') as RacePriority);
      return days > 0 ? { from: isoMinusDays(r.date, days), to: r.date } : null;
    })
    .filter((w): w is { from: string; to: string } => w !== null);
  return (date: string) => windows.some((w) => date >= w.from && date <= w.to);
}

// Kopia dni z locked:true dla dat chronionych — scaleWeek/modify traktują je jak nietykalne.
export function lockTaperDays<T extends { date: string; locked?: boolean }>(
  days: T[],
  isProtected: (date: string) => boolean
): T[] {
  return days.map((d) => (isProtected(d.date) ? { ...d, locked: true } : d));
}

// Post-check: dni chronione, które MIMO locka różnią się między before i after.
// KONTRAKT: `before` = kopia PO lockTaperDays (baseline z locked:true) — wtedy niezmieniony
// pass-through przez scaleWeek/modify jest bajt-w-bajt równy baseline. Wołaj PRZED
// restoreProtectedDays (restore maskowałby realne mutacje).
export function taperViolations<T extends { date: string }>(
  before: T[],
  after: T[],
  isProtected: (date: string) => boolean
): string[] {
  const byDate = new Map(after.map((d) => [d.date, d]));
  const out: string[] = [];
  for (const b of before) {
    if (!isProtected(b.date)) continue;
    const a = byDate.get(b.date);
    // Dzień chroniony zniknął albo zmienił JAKIEKOLWIEK pole → wiolacja.
    if (!a || JSON.stringify(a) !== JSON.stringify(b)) out.push(b.date);
  }
  return out;
}

// Po przejściu post-checku: przywróć ORYGINALNE obiekty dni chronionych (zdejmuje wstrzyknięty
// locked:true, żeby zatwierdzona korekta nie utrwalała blokady, której user nie ustawił).
export function restoreProtectedDays<T extends { date: string }>(
  original: T[],
  modified: T[],
  isProtected: (date: string) => boolean
): T[] {
  const origByDate = new Map(original.map((d) => [d.date, d]));
  return modified.map((d) => (isProtected(d.date) ? origByDate.get(d.date) ?? d : d));
}
