// RECONCILE dni RACE: live race_calendar vs materializowany plan_json — JEDNO miejsce na zasadę.
// Wyodrębnione z Plan.tsx (#108 commit 1), gdy Kalendarz miał zostać trzecią kopią tej samej
// logiki. Współdzielone przez Plan.tsx i lib/calendar-events.ts — oba operują na PlanDayView.
//
// get_weekly_plan (lib/ai/chat-tools) CELOWO ma własną kopię: czyta surowy dict z plan_json i
// zwraca DTO czatu (bez watt/hr/structure/race), więc nie da się jej przepiąć bez zmiany kształtu.
// Sama ZASADA jest tam identyczna — przy zmianie tego pliku sprawdź też chat-tools.
//
// ZAKRES: wyłącznie warstwa ODCZYTU. plan_json, generator, modify i overload-correction czytają
// dalej surowy materializowany RACE — marker jest tam load-bearing (issue #107).
import type { PlanDayView } from '@/components/veloiq/Plan';
import type { RaceMeta } from '@/lib/ai/plan-generate';
import { estimateRaceDay, type RacePriority } from '@/lib/race-taper';

// Minimalny kształt wiersza race_calendar do overlayu — spełniają go i PlanRaceRow (Plan), i
// RaceRow (Kalendarz). priority: string | null, bo kolumna JEST nullable (migracja 001:
// `priority text check (priority in ('A','B','C'))`, bez NOT NULL), a RaceRow tak ją typuje.
export interface RaceOverlayRow {
  date: string;
  name: string;
  priority: string | null;
  distance_km: number | null;
  elevation_m: number | null;
  discipline: string | null;
}

// Meta dnia startu z wiersza kalendarza (szacunek deterministyczny, jak w generatorze).
// priority ?? 'C': estimateRaceDay indeksuje IF_BY_PRIORITY[priority] bez zabezpieczenia, więc
// null dałby ifUsed=undefined → estTss=NaN. Fallback spójny z get_weekly_plan (chat-tools).
export function raceMetaFromRow(r: RaceOverlayRow): RaceMeta {
  const priority = ((r.priority as RacePriority | null) ?? 'C') as RacePriority;
  const est = estimateRaceDay(r.distance_km, r.elevation_m, r.discipline, priority);
  return {
    name: r.name,
    priority,
    distanceKm: r.distance_km,
    elevationM: r.elevation_m,
    discipline: r.discipline,
    estTimeMin: est?.estTimeMin ?? 0,
    estTss: est?.estTss ?? 0,
  };
}

// data ('YYYY-MM-DD') → meta startu. Klucz normalizowany slice(0,10) — Kalendarz tak keyuje
// wyścigi, Plan dostaje czystą kolumnę DATE (slice = no-op). Jeden kontrakt dla obu.
export function buildRaceByDate(races: RaceOverlayRow[]): Map<string, RaceMeta> {
  return new Map(races.map((r) => [r.date.slice(0, 10), raceMetaFromRow(r)]));
}

// Live race_calendar jest AUTORYTATYWNY dla dni RACE — jedno źródło prawdy:
// - live wyścig na tę datę → RACE z szacunkiem (działa też dla planów sprzed race-aware generatora
//   i odświeża materializowany RACE aktualnymi danymi live),
// - plan_json ma materializowany RACE, ale wyścig USUNIĘTY z kalendarza (brak live) → SIEROTA → OFF.
//   injectRaceDay nadpisał oryginalny trening bezpowrotnie, więc OFF to jedyna sensowna opcja.
// - reszta dni bez zmian.
// Generyk po T: Kalendarz wnosi CalPlanDay (PlanDayView & {outline}) — spread zachowuje outline.
export function overlayRaceDays<T extends PlanDayView>(days: T[], raceByDate: Map<string, RaceMeta>): T[] {
  return days.map((d) => {
    const rm = raceByDate.get(d.date.slice(0, 10));
    if (rm) return { ...d, type: 'RACE', label: rm.name, tss: rm.estTss, dur_min: rm.estTimeMin, race: rm };
    if (d.type === 'RACE') {
      return { ...d, type: 'OFF', label: 'Odpoczynek', tss: 0, dur_min: 0, watt: '–', hr: '–', zones: [0, 0, 0, 0, 0], structure: null, race: null };
    }
    return d;
  });
}
