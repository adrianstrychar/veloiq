import type { createServerSupabaseClient } from '@/lib/supabase';
import type { DayStructure } from '@/lib/structure';
import type { PlannedWorkout } from '@/lib/ai/insight';

// Kształt dnia w plan_json (podzbiór potrzebny do dopasowania + celu ringu/insightu).
export interface PlanDayRow {
  dow: number;
  type: string;
  label: string;
  watt: string;
  hr: string;
  tss: number;
  dur_min: number;
  warmup?: number;   // nadpisanie z suwaka (scaleWeek); brak → default z sessionStructure
  cooldown?: number;
  structure?: DayStructure | null;
}

// Zaplanowany trening na dzień jazdy — JEDEN matcher po dacie (activity_date → poniedziałek
// tygodnia + dow → plan_json.days). Współdzielony przez AI Insight i pierścień realizacji,
// żeby oba mówiły o tym samym dniu planu. null = brak planu na tydzień, dzień OFF, lub
// jazda niezaplanowana.
export async function fetchPlannedDay(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  athleteId: string,
  activityDate: string
): Promise<PlannedWorkout | null> {
  const d = new Date(activityDate + 'T00:00:00Z');
  const dow = ((d.getUTCDay() + 6) % 7) + 1; // 1=Pn … 7=Nd
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (dow - 1));
  const weekStart = monday.toISOString().slice(0, 10);

  const { data: plan } = await supabase
    .from('weekly_plans')
    .select('plan_json')
    .eq('athlete_id', athleteId)
    .eq('week_start', weekStart)
    .maybeSingle();

  const days = (plan?.plan_json as { days?: PlanDayRow[] } | null)?.days;
  const day = days?.find((x) => x.dow === dow);
  if (!day || day.type === 'OFF') return null; // brak planu / dzień wolny → ocena samodzielna
  return {
    type: day.type,
    label: day.label,
    watt: day.watt,
    hr: day.hr,
    tss: day.tss,
    dur_min: day.dur_min,
    warmup: day.warmup,      // przekazywane dalej → ring rekonstruuje czas głównej tą samą ścieżką
    cooldown: day.cooldown,
    structure: day.structure ?? null, // pełna substruktura → prompt/ring znają interwały
  };
}
