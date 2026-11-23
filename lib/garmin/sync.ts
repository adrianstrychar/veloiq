// VeloIQ na Garmin Edge – dane pobierane przez licznik przy synchronizacji:
// zawodnik (FTP, HRmax, waga), treningi z planu na dziś i kolejne dni oraz odprawa na dziś.
// Treningi to te same skrypty, które wykonuje telefon (planDayToScript) – w zwartym formacie tablic,
// bo licznik ma mało pamięci i wolne łącze (Bluetooth przez telefon).
import type { SupabaseClient } from '@supabase/supabase-js';
import { mondayOfISO } from '@/lib/plan';
import { shiftISO, userTodayISO } from '@/lib/timezone';
import type { PlanDayRow } from '@/lib/planned-day';
import { planDayToScript } from '@/lib/ride/plan-to-script';
import { buildBriefing } from '@/lib/ride/briefing';
import type { StepType, WorkoutScript } from '@/lib/ride/workout-script';

export const STEP_CODES: Record<StepType, number> = { warmup: 0, interval: 1, recovery: 2, steady: 3, cooldown: 4 };
export const STEP_TYPES: StepType[] = ['warmup', 'interval', 'recovery', 'steady', 'cooldown'];

const MAX_STEPS = 100;   // jeden trening = jedna wartość w pamięci licznika (limit rozmiaru)
const DAYS_AHEAD = 6;

/** Czcionki licznika nie mają wszystkich znaków typograficznych – zamiana na pewne odpowiedniki. */
export function plainText(s: string): string {
  return s
    .replace(/[×✕]/g, 'x').replace(/[–—−]/g, '-').replace(/[„”“«»]/g, '"').replace(/[’‘]/g, "'")
    .replace(/…/g, '...').replace(/·|•/g, ',').replace(/→/g, '>').replace(/\s+/g, ' ').trim();
}

export type GarminStep = [string, number, number, number, number, number, number, number, number, number];

export interface GarminWorkout {
  id: string; date: string; name: string; type: string; dur: number; tss: number; ftp: number;
  steps: GarminStep[]; truncated?: boolean;
}

export function scriptToGarmin(script: WorkoutScript, date: string, tss: number): GarminWorkout {
  const steps = script.steps.slice(0, MAX_STEPS).map((st): GarminStep => [
    plainText(st.name).slice(0, 28), STEP_CODES[st.type] ?? 3, Math.round(st.durationSec), Math.round(st.powerLow), Math.round(st.powerHigh),
    Math.round(st.cadenceLow ?? 0), Math.round(st.cadenceHigh ?? 0), st.start === 'auto' ? 1 : st.start === 'time' ? 2 : 0,
    Math.round(st.hrLow ?? 0), Math.round(st.hrHigh ?? 0),
  ]);
  return {
    id: script.id, date, name: plainText(script.name).slice(0, 40), type: script.type ?? '',
    dur: steps.reduce((a, s) => a + s[2], 0), tss: Math.round(tss || 0), ftp: script.ftp, steps,
    ...(script.steps.length > MAX_STEPS ? { truncated: true } : {}),
  };
}

export interface GarminSync {
  ok: true;
  t: number;
  today: string;
  athlete: { name: string; ftp: number; hrmax: number; kg: number };
  workouts: GarminWorkout[];
  brief: { readiness?: number; state?: string; yTss?: number; recovery?: number; hrA?: number; hrB?: number } | null;
}

export async function buildGarminSync(admin: SupabaseClient, userId: string): Promise<GarminSync | null> {
  const { data: athlete } = await admin.from('athletes')
    .select('id, name, ftp_watts, hrmax, weight_kg').eq('user_id', userId).maybeSingle();
  if (!athlete) return null;
  const ftp = (athlete.ftp_watts as number | null) ?? 250;
  const hrmax = (athlete.hrmax as number | null) ?? 0;
  const today = userTodayISO();
  const last = shiftISO(today, DAYS_AHEAD);
  const weeks = Array.from(new Set([mondayOfISO(today), mondayOfISO(last)]));

  const [{ data: plans }, brief] = await Promise.all([
    admin.from('weekly_plans').select('week_start, plan_json').eq('athlete_id', athlete.id).in('week_start', weeks),
    buildBriefing(admin, athlete.id as string).catch(() => undefined),
  ]);

  const workouts: GarminWorkout[] = [];
  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const date = shiftISO(today, i);
    const week = (plans ?? []).find((p) => p.week_start === mondayOfISO(date));
    const dow = ((new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1; // 1=Pn … 7=Nd
    const day = (week?.plan_json as { days?: PlanDayRow[] } | null)?.days?.find((d) => d.dow === dow) ?? null;
    const script = planDayToScript(day, ftp, `plan-${date}`, hrmax || null);
    if (script && script.steps.length) workouts.push(scriptToGarmin(script, date, day?.tss ?? 0));
  }

  const firstName = String((athlete.name as string | null) ?? '').trim().split(/\s+/)[0] ?? '';
  return {
    ok: true,
    t: Math.floor(Date.now() / 1000),
    today,
    athlete: { name: plainText(firstName).slice(0, 20), ftp, hrmax, kg: Math.round(Number(athlete.weight_kg) || 0) },
    workouts,
    brief: brief ? {
      readiness: brief.readiness, state: brief.readyState ? plainText(brief.readyState) : undefined, yTss: brief.yTss,
      recovery: brief.recovery, hrA: brief.hrA, hrB: brief.hrB,
    } : null,
  };
}
