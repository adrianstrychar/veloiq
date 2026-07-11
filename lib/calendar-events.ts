// Builder zdarzeń kalendarza — WYODRĘBNIONY z Calendar.tsx (czysta funkcja, bez React) żeby był
// testowalny bez przeglądarki. Trzy źródła: jazdy (activity), plan (training), wyścigi (race).
// FIX #77 (dedup): dzień z wyścigiem emituje TYLKO event race — plan-dzień (nawet type=RACE/OFF)
// jest wtedy pomijany, a jego TSS przenosimy na event wyścigu (licznik miesiąca bez strat).
import type { RideActivity } from '@/components/veloiq/RideAnalysis';
import type { PlanDayView } from '@/components/veloiq/Plan';
import type { RaceRow } from '@/components/veloiq/Races';
import { C } from '@/lib/theme';
import { typeColor } from '@/lib/plan';

export interface CalActivity extends RideActivity {
  strava_activity_id: number;
  details_synced_at: string | null;
  sport_type?: string | null;
}

// Dzień planu w kalendarzu: PlanDayView + outline (następny tydzień = zarys).
export type CalPlanDay = PlanDayView & { outline?: boolean };

// Zdarzenie kalendarza — dyskryminowane po kind.
export type CalEvent =
  | { kind: 'activity'; date: string; label: string; color: string; tss: number | null; activity: CalActivity; clickable: boolean }
  | { kind: 'training'; date: string; label: string; color: string; tss: number | null; day: CalPlanDay; outline: boolean; clickable: boolean }
  | { kind: 'race'; date: string; label: string; color: string; tss: number | null; race: RaceRow };

// Kolor aktywności wg sportu (mockup dayDot): Gravel=yellow, Virtual/Zwift=purple, reszta=cyan.
export function activityColor(sportType: string | null | undefined): string {
  if (sportType === 'GravelRide') return C.yellow;
  if (sportType === 'VirtualRide') return C.purple;
  return C.cyan;
}

// Zbuduj zdarzenia z trzech źródeł i pogrupuj po dacie (klucz 'YYYY-MM-DD').
export function buildCalendarEvents(
  activities: CalActivity[],
  races: RaceRow[],
  planDays: CalPlanDay[],
  todayStr: string,
  ftp: number | null
): Map<string, CalEvent[]> {
  const events: CalEvent[] = [];

  for (const a of activities) {
    events.push({
      kind: 'activity',
      date: a.activity_date,
      label: a.name ?? a.type ?? 'Jazda',
      color: activityColor(a.sport_type),
      tss: a.tss,
      activity: a,
      clickable: !!a.details_synced_at,
    });
  }

  // FIX #77: daty wyścigów + TSS planu na te daty (do przeniesienia na event race).
  const raceDates = new Set(races.map((r) => r.date.slice(0, 10)));
  const planTssByDate = new Map<string, number | null>();
  for (const d of planDays) {
    if (d.date) planTssByDate.set(d.date.slice(0, 10), d.tss > 0 ? d.tss : null);
  }

  // Treningi z planu (Etap 5): tylko dziś i przyszłość. Dzień z wyścigiem POMIJAMY — reprezentuje
  // go event race (dedup): to naprawia Winterberg 2× i czyści "Odpoczynek" na dniu startu (C).
  for (const d of planDays) {
    if (!d.date || d.date < todayStr) continue;
    if (raceDates.has(d.date.slice(0, 10))) continue; // dzień wyścigu → tylko event race
    const outline = !!d.outline;
    events.push({
      kind: 'training',
      date: d.date,
      label: d.type === 'OFF' ? 'Odpoczynek' : d.label,
      color: typeColor(d.type),
      tss: d.tss > 0 ? d.tss : null,
      day: d,
      outline,
      // Rozpiska (WorkoutDetail) tylko dla szczegółu: nie zarys, nie OFF, FTP w profilu.
      clickable: !outline && d.type !== 'OFF' && ftp != null,
    });
  }

  for (const r of races) {
    events.push({
      kind: 'race',
      date: r.date,
      label: r.name,
      color: C.red,
      tss: planTssByDate.get(r.date.slice(0, 10)) ?? null, // FIX: TSS startu z pominiętego dnia planu
      race: r,
    });
  }

  const map = new Map<string, CalEvent[]>();
  for (const e of events) {
    const key = e.date.slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return map;
}
