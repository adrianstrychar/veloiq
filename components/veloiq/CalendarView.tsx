'use client';

import { useRouter } from 'next/navigation';
import { Calendar, type CalActivity, type CalPlanDay } from './Calendar';
import { type RaceRow } from './Races';

interface CalendarViewProps {
  races: RaceRow[];
  activities: CalActivity[];
  planDays: CalPlanDay[];
  ftp: number | null;
}

// Cienki client-wrapper: strona /calendar jest serwerowa, a Calendar wymaga callbacku
// onRaceClick. Po rozdzieleniu zakładek (mockup: Kalendarz i Wyścigi osobno) klik w wyścig
// w kalendarzu prowadzi na /races — wcześniej przełączał widok wewnątrz /races (RacesView).
export function CalendarView({ races, activities, planDays, ftp }: CalendarViewProps) {
  const router = useRouter();
  return <Calendar races={races} activities={activities} planDays={planDays} ftp={ftp} onRaceClick={() => router.push('/races')} />;
}
