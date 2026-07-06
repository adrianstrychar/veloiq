// Write tools czatu AI (PR 2/3): propose_plan_change + commit_change (współdzielony).
// Wzorzec confirm-before-write: model NIGDY nie zapisuje od razu. propose liczy zmianę przez
// computePlanModification (dry-run, bez zapisu), pokazuje diff, zapisuje pending z base_hash.
// commit aplikuje po jawnym "tak" — z walidacją expiry (15 min) + base_hash (optimistic lock)
// + konsumpcją pending (odporność na podwójne "tak"). Reużywa applyPlanModification (#54).
import type Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { computePlanModification, applyPlanModification, type PlanModificationResult } from '@/lib/ai/plan-modify';
import { localTodayISO, mondayOfISO } from '@/lib/plan';
import type { PlanDay } from '@/lib/ai/plan-generate';
import type { ToolCtx } from '@/lib/ai/chat-tools';

const PENDING_TTL_MS = 15 * 60 * 1000; // 15 min
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const DOWF = ['', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'];
const fmtDay = (d: PlanDay) => (d.type === 'OFF' ? 'OFF (wolne)' : `${d.type} ${d.dur_min} min, TSS ${d.tss}`);

export const WRITE_TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'propose_plan_change',
    description:
      "Propose a change to a training-week plan from a natural-language instruction (e.g. 'wtorek Z2, środa wolna'). Does NOT save — returns a Polish diff (before→after, weekly TSS, locked days, skipped past days) and a change_id. Only the current or a future week. Respects locked days and never changes past days. ALWAYS call this first, show the diff to the athlete, and wait for an explicit confirmation before calling commit_change.",
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        week_start: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Monday of the target week (local YYYY-MM-DD). Omit for the current week.' },
        instruction: { type: 'string', description: "The requested change in natural language, in the athlete's own phrasing." },
      },
      required: ['instruction'],
    },
  },
  {
    name: 'commit_change',
    description:
      'Apply a previously proposed change AFTER the athlete has EXPLICITLY confirmed (said "tak"/yes) in their most recent message, referring to THIS specific proposal. Never call without a fresh explicit confirmation. Rejected if the proposal expired, was already applied, or the underlying data changed since the proposal.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { change_id: { type: 'string', description: 'The change_id returned by the matching propose_* call.' } },
      required: ['change_id'],
    },
  },
];

export function isWriteTool(name: string): boolean {
  return name === 'propose_plan_change' || name === 'commit_change';
}

export function buildPlanDiff(current: PlanDay[], result: PlanModificationResult, weekStart: string): string {
  const changes: string[] = [];
  for (const d of result.days) {
    const o = current.find((x) => x.dow === d.dow);
    if (!o) continue;
    if (o.type !== d.type || o.dur_min !== d.dur_min || o.tss !== d.tss) {
      changes.push(`  • ${DOWF[d.dow]}: ${fmtDay(o)} → ${fmtDay(d)}`);
    }
  }
  const oldTss = current.reduce((s, x) => s + x.tss, 0);
  const locked = result.days.filter((x) => x.locked).map((x) => DOWF[x.dow]);
  const skipped = result.skippedPastDows.map((dw) => DOWF[dw]);
  const parts = [`Proponowana zmiana planu — tydzień od ${weekStart}:`];
  parts.push(changes.length ? changes.join('\n') : '  (żaden dzień się nie zmienia)');
  parts.push(`TSS tygodnia: ${oldTss} → ${result.tssTarget}.`);
  parts.push(`Zablokowane (nietknięte): ${locked.length ? locked.join(', ') : '—'}.`);
  if (skipped.length) parts.push(`Dni minione: pominięte (${skipped.join(', ')}).`);
  parts.push('Napisz „tak", żeby zapisać, albo powiedz, co poprawić.');
  return parts.join('\n');
}

async function proposePlanChange({ supabase, athleteId }: ToolCtx, input: Record<string, unknown>) {
  const today = localTodayISO();
  const curWeek = mondayOfISO(today);
  const weekStart = typeof input.week_start === 'string' ? input.week_start : curWeek;
  const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : '';
  if (!instruction) return { ok: false, error: 'Brak treści zmiany.' };
  if (weekStart < curWeek) return { ok: false, error: `Można modyfikować tylko bieżący lub przyszły tydzień — nie ${weekStart} (miniony).` };

  const { data: plan } = await supabase.from('weekly_plans').select('id, plan_json').eq('athlete_id', athleteId).eq('week_start', weekStart).maybeSingle();
  if (!plan) return { ok: false, found: false, week_start: weekStart, message: `Brak planu na tydzień od ${weekStart}. Najpierw wygeneruj plan w module Plan.` };

  const currentDays = (plan.plan_json as { days: PlanDay[] }).days;
  const [{ data: ath }, { data: fm }, { data: race }] = await Promise.all([
    supabase.from('athletes').select('ftp_watts').eq('id', athleteId).single(),
    supabase.from('fitness_metrics').select('ctl').eq('athlete_id', athleteId).order('date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('race_calendar').select('name, date').eq('athlete_id', athleteId).gte('date', today).order('date', { ascending: true }).limit(1).maybeSingle(),
  ]);
  const modCtx = {
    lockedDows: currentDays.filter((d) => d.locked).map((d) => d.dow),
    ftp: (ath?.ftp_watts as number | null) ?? 250,
    ctl: fm?.ctl != null ? Number(fm.ctl) : null,
    raceName: (race?.name as string | null) ?? null,
    daysToRace: race?.date ? Math.round((new Date(race.date as string).getTime() - new Date(today).getTime()) / 86400000) : null,
  };

  const comp = await computePlanModification(currentDays, modCtx, instruction, weekStart, today);
  if (!comp.ok) return { ok: false, error: `Nie udało się przygotować zmiany: ${comp.error}` };

  // Stare pending atlety czyszczone przy każdym propose (dedup + unieważnienie porzuconych propozycji).
  await supabase.from('pending_changes').delete().eq('athlete_id', athleteId);
  const baseHash = sha256(JSON.stringify(plan.plan_json));
  const { data: pend, error } = await supabase
    .from('pending_changes')
    .insert({ athlete_id: athleteId, kind: 'plan', week_start: weekStart, base_hash: baseHash, payload_json: comp.result })
    .select('id')
    .single();
  if (error || !pend) return { ok: false, error: `Nie udało się zapisać propozycji: ${error?.message ?? 'nieznany błąd'}` };

  return {
    ok: true,
    change_id: pend.id,
    diff: buildPlanDiff(currentDays, comp.result, weekStart),
    requires_confirmation: true,
    note: 'Pokaż userowi diff i poproś o potwierdzenie ("tak"). Zapis dopiero po jawnym potwierdzeniu — commit_change z tym change_id.',
  };
}

async function commitChange({ supabase, athleteId }: ToolCtx, input: Record<string, unknown>) {
  const changeId = typeof input.change_id === 'string' ? input.change_id : '';
  if (!changeId) return { ok: false, error: 'Brak change_id.' };

  const { data: pend } = await supabase.from('pending_changes').select('*').eq('id', changeId).eq('athlete_id', athleteId).maybeSingle();
  if (!pend) return { ok: false, error: 'Ta zmiana wygasła albo została już zastosowana. Poproś o nową propozycję, jeśli chcesz coś zmienić.' };

  if (Date.now() - new Date(pend.created_at as string).getTime() > PENDING_TTL_MS) {
    await supabase.from('pending_changes').delete().eq('id', pend.id);
    return { ok: false, error: 'Propozycja wygasła (ponad 15 minut). Przygotuję nową, jeśli chcesz.' };
  }

  if (pend.kind === 'plan') {
    const { data: plan } = await supabase.from('weekly_plans').select('id, plan_json').eq('athlete_id', athleteId).eq('week_start', pend.week_start).maybeSingle();
    if (!plan) {
      await supabase.from('pending_changes').delete().eq('id', pend.id);
      return { ok: false, error: 'Plan zniknął. Poproś o nową propozycję.' };
    }
    const curHash = sha256(JSON.stringify(plan.plan_json));
    if (curHash !== pend.base_hash) {
      await supabase.from('pending_changes').delete().eq('id', pend.id);
      return { ok: false, error: 'Plan zmienił się od czasu propozycji (np. edycja w aplikacji). NIE zapisałem — przygotuję nową propozycję na aktualnym stanie, jeśli potwierdzisz.' };
    }
    await applyPlanModification(supabase, plan.id as string, pend.payload_json as PlanModificationResult);
    await supabase.from('pending_changes').delete().eq('id', pend.id); // konsumpcja → drugi "tak" nie znajdzie pending
    return { ok: true, applied: true, kind: 'plan', message: 'Zapisane — plan tygodnia zaktualizowany.' };
  }

  return { ok: false, error: 'Ten typ zmiany nie jest jeszcze obsługiwany (starty w kolejnej wersji).' };
}

export async function dispatchWrite(name: string, input: Record<string, unknown>, ctx: ToolCtx): Promise<unknown> {
  switch (name) {
    case 'propose_plan_change': return proposePlanChange(ctx, input);
    case 'commit_change': return commitChange(ctx, input);
    default: throw new Error(`unknown write tool: ${name}`);
  }
}
