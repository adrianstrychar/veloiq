// Dynamiczne sugerowane pytania (chips) do czatu — DETERMINISTYCZNE (szablony + dane),
// bez wywołań LLM (zero latencji/kosztu). 3 sloty: start / akcja / showcase, z deduplikacją tematów.
import type { SupabaseClient } from '@supabase/supabase-js';
import { localTodayISO, mondayOfISO } from '@/lib/plan';

export interface Suggestion {
  label: string;  // krótki tekst chipa
  prompt: string; // pełne pytanie wysyłane do czatu
  topic: string;  // do deduplikacji między slotami (nie renderowane)
}

const LONG_RIDE_MIN = 150; // 2.5h
// Data lokalna przesunięta o n dni jako YYYY-MM-DD (spójnie z activity_date/plan.date = local).
function shiftISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
// Przymiotnik dnia (dow z daty ISO), do "na niedzielny długi trening".
const DOW_ADJ = ['niedzielny', 'poniedziałkowy', 'wtorkowy', 'środowy', 'czwartkowy', 'piątkowy', 'sobotni'];
function whenLabel(dateISO: string, today: string, tomorrow: string): string {
  if (dateISO === today) return 'dzisiejszy';
  if (dateISO === tomorrow) return 'jutrzejszy';
  return DOW_ADJ[new Date(dateISO + 'T12:00:00Z').getUTCDay()];
}

interface PlanDay {
  date: string;
  type: string;
  label?: string;
  dur_min?: number;
}

export async function buildSuggestions(supabase: SupabaseClient, athleteId: string): Promise<Suggestion[]> {
  const today = localTodayISO();
  const tomorrow = shiftISO(1);
  const in3 = shiftISO(3);
  const yesterday = shiftISO(-1);
  const ws = mondayOfISO(today);

  // Równoległe zapytania (scoped athleteId) — reużycie tych samych tabel co chat-tools.
  const [{ data: race }, { data: plan }, { data: yRide }, { data: fm }] = await Promise.all([
    supabase.from('race_calendar').select('name, date').eq('athlete_id', athleteId).gte('date', today).order('date', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('weekly_plans').select('plan_json').eq('athlete_id', athleteId).eq('week_start', ws).maybeSingle(),
    supabase.from('strava_activities').select('activity_date').eq('athlete_id', athleteId).eq('activity_date', yesterday).limit(1).maybeSingle(),
    supabase.from('fitness_metrics').select('tsb').eq('athlete_id', athleteId).order('date', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const raceName = typeof race?.name === 'string' && race.name.trim() ? race.name.trim() : null;
  const raceDaysAway = race?.date ? Math.ceil((new Date(race.date + 'T12:00:00Z').getTime() - new Date(today + 'T12:00:00Z').getTime()) / 86400000) : null;

  const days: PlanDay[] = ((plan?.plan_json as { days?: PlanDay[] } | null)?.days ?? []).filter((d) => d && typeof d.date === 'string');
  const tomorrowTraining = days.find((d) => d.date === tomorrow && d.type !== 'OFF') ?? null;
  const tomorrowLabel = tomorrowTraining && typeof tomorrowTraining.label === 'string' && tomorrowTraining.label.trim() ? tomorrowTraining.label.trim() : (tomorrowTraining?.type ?? null);
  const longRide = days
    .filter((d) => d.type !== 'OFF' && (d.dur_min ?? 0) >= LONG_RIDE_MIN && d.date >= today && d.date <= in3)
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const hasYesterdayRide = !!yRide;
  const tsb = fm?.tsb != null ? Number(fm.tsb) : null;

  // ── Slot 1: START ──
  let slot1: Suggestion;
  if (raceName && raceDaysAway != null && raceDaysAway <= 21) {
    slot1 = { label: `Forma przed ${raceName}`, prompt: `Jak wygląda moja forma przed ${raceName}?`, topic: 'race' };
  } else if (raceName) {
    slot1 = { label: `Budowa formy na ${raceName}`, prompt: `Jak zbudować formę na ${raceName}?`, topic: 'race' };
  } else {
    slot1 = { label: 'Moja aktualna forma', prompt: 'Jak wygląda moja aktualna forma?', topic: 'form' };
  }

  // ── Slot 2: AKCJA ──
  let slot2: Suggestion;
  if (hasYesterdayRide) {
    slot2 = { label: 'Analiza wczorajszej jazdy', prompt: 'Przeanalizuj moją wczorajszą jazdę', topic: 'ride' };
  } else if (tomorrowTraining && tomorrowLabel) {
    slot2 = { label: `Jutrzejszy trening: ${tomorrowLabel}`, prompt: `Wytłumacz mi jutrzejszy trening (${tomorrowLabel}) i podaj strefy`, topic: 'workout' };
  } else {
    slot2 = { label: 'Plan na ten tydzień', prompt: 'Jaki mam plan na ten tydzień?', topic: 'plan' };
  }

  // ── Slot 3: SHOWCASE (priorytetowo, z deduplikacją tematu vs slot 1/2) ──
  const used = new Set([slot1.topic, slot2.topic]);
  const candidates: Array<Suggestion | null> = [
    tsb != null && tsb < -20 ? { label: 'Jestem zmęczony — odpuścić?', prompt: 'Jestem zmęczony — czy powinienem dziś odpuścić?', topic: 'fatigue' } : null,
    raceName && raceDaysAway != null && raceDaysAway <= 10 ? { label: `Rozłożenie sił na ${raceName}`, prompt: `Jak rozłożyć siły na ${raceName}?`, topic: 'race' } : null,
    longRide ? { label: `Węgle na ${whenLabel(longRide.date, today, tomorrow)} długi trening`, prompt: `Ile węgli na godzinę na ${whenLabel(longRide.date, today, tomorrow)} długi trening?`, topic: 'nutrition' } : null,
    { label: 'Co poprawić w treningu?', prompt: 'Co mogę poprawić w moim treningu?', topic: 'improve' }, // zawsze dostępny fallback
  ];
  const slot3 = candidates.find((c): c is Suggestion => c != null && !used.has(c.topic))!;

  return [slot1, slot2, slot3];
}
