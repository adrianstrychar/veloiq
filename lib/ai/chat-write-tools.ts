// Write tools czatu AI: plan (propose_plan_change) + starty (propose_race_change) + wspólne
// commit_change / cancel_change. Wzorzec confirm-before-write: model NIGDY nie zapisuje od razu.
// propose liczy zmianę (bez zapisu), pokazuje diff, zapisuje pending z base_hash. commit aplikuje
// po jawnym "tak" — z expiry (15 min) + base_hash (optimistic lock) + konsumpcją pending. cancel
// usuwa pending przy odmowie. Reużywa applyPlanModification (#54) i lib/races.ts (zapis startów).
import type Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { computePlanModification, applyPlanModification, type PlanModificationResult } from '@/lib/ai/plan-modify';
import { mondayOfISO } from '@/lib/plan';
// Past-day guard w chacie liczony w strefie UŻYTKOWNIKA (spójnie z KONTEKST CZASOWY). Uwaga: Plan-page
// modify (app/api/plan/modify) używa serwerowego localTodayISO — osobny, latentny temat przy północy.
import { userTodayISO } from '@/lib/timezone';
import type { PlanDay } from '@/lib/ai/plan-generate';
import type { ToolCtx } from '@/lib/ai/chat-tools';
import { addRace, editRace, deleteRace, getRace, type RaceRow } from '@/lib/races';

const PRIORITIES = ['A', 'B', 'C'] as const;
const RACE_SERIES = ['GWS', 'GFWS', 'MTB', 'other'] as const;

const PENDING_TTL_MS = 15 * 60 * 1000; // 15 min — propozycje z rozmowy (chat)
// Auto-korekty po przeciążeniu (payload_json.source==='overload') żyją dłużej: propozycja
// powstaje przy otwarciu jazdy, nie w rozmowie — user może wrócić do niej po godzinach.
// base_hash i tak unieważnia ją przy każdej zmianie planu.
const OVERLOAD_TTL_MS = 12 * 60 * 60 * 1000; // 12 h
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
  {
    name: 'propose_race_change',
    description:
      "Propose adding, editing, or deleting a race in the athlete's calendar. Does NOT save — returns a Polish diff (all fields, before→after) and a change_id. Add/edit only for dates today or later; delete allowed for any date (calendar cleanup). Fill `series` when it follows from the athlete's wording. After the athlete explicitly confirms, call commit_change.",
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        operation: { type: 'string', enum: ['add', 'edit', 'delete'] },
        race_id: { type: 'string', description: 'Required for edit/delete — the race id from get_races.' },
        name: { type: 'string', description: 'Race name (required for add).' },
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Race date (local YYYY-MM-DD). Required for add.' },
        priority: { type: 'string', enum: ['A', 'B', 'C'], description: 'A = main goal. Required for add.' },
        series: { type: 'string', enum: ['GWS', 'GFWS', 'MTB', 'other'], description: 'Race series if it follows from wording.' },
        distance_km: { type: 'integer', description: 'Optional distance in km.' },
        elevation_m: { type: 'integer', description: 'Optional elevation gain in m.' },
      },
      required: ['operation'],
    },
  },
  {
    name: 'cancel_change',
    description:
      'Discard a previously proposed change (plan or race) when the athlete declines or backs out ("nie", "zostaw", "jednak nie"). Removes the pending proposal so it can no longer be committed. Then confirm the cancellation in one sentence.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { change_id: { type: 'string', description: 'The change_id of the proposal being discarded.' } },
      required: ['change_id'],
    },
  },
];

export function isWriteTool(name: string): boolean {
  return name === 'propose_plan_change' || name === 'propose_race_change' || name === 'commit_change' || name === 'cancel_change';
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
  const today = userTodayISO();
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

// ── Starty (race_calendar) ──────────────────────────────────────────────────────
type RaceFields = { name: string; date: string; priority: 'A' | 'B' | 'C'; series: string | null; distance_km: number | null; elevation_m: number | null };
type RacePayload =
  | { operation: 'add'; race: RaceFields }
  | { operation: 'edit'; race_id: string; patch: Partial<RaceFields>; before: RaceRow }
  | { operation: 'delete'; race_id: string; before: RaceRow };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const intOrNull = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

function daysAwayLabel(dateISO: string, today: string): string {
  const d = Math.ceil((new Date(`${dateISO}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86400000);
  if (d === 0) return 'dziś';
  return d > 0 ? `za ${d} dni` : `${-d} dni temu`;
}
function raceLines(r: Partial<RaceFields>, today: string): string[] {
  return [
    `  Nazwa: ${r.name || '—'}`,
    `  Data: ${r.date ? `${r.date} (${daysAwayLabel(r.date, today)})` : '—'}`,
    `  Priorytet: ${r.priority || '—'}`,
    `  Seria: ${r.series || '—'}`,
    `  Dystans: ${r.distance_km != null ? `${r.distance_km} km` : '—'}`,
    `  Przewyższenie: ${r.elevation_m != null ? `${r.elevation_m} m` : '—'}`,
  ];
}
function buildRaceDiff(op: 'add' | 'edit' | 'delete', before: RaceRow | null, after: Partial<RaceFields> | null, today: string): string {
  if (op === 'add') return ['Proponowane dodanie startu:', ...raceLines(after ?? {}, today), 'Napisz „tak", żeby dodać do kalendarza.'].join('\n');
  if (op === 'delete') return ['Proponowane usunięcie startu:', ...raceLines(before ?? {}, today), 'Napisz „tak", żeby usunąć z kalendarza.'].join('\n');
  const b = before!;
  const a = after!;
  const fmt = (r: Partial<RaceFields>, k: keyof RaceFields) => {
    if (k === 'date') return r.date ? `${r.date} (${daysAwayLabel(r.date, today)})` : '—';
    if (k === 'distance_km') return r.distance_km != null ? `${r.distance_km} km` : '—';
    if (k === 'elevation_m') return r.elevation_m != null ? `${r.elevation_m} m` : '—';
    return (r[k] as string) || '—';
  };
  const rows: Array<[string, keyof RaceFields]> = [['Nazwa', 'name'], ['Data', 'date'], ['Priorytet', 'priority'], ['Seria', 'series'], ['Dystans', 'distance_km'], ['Przewyższenie', 'elevation_m']];
  const lines = rows.map(([label, k]) => {
    const bv = fmt(b, k);
    const av = fmt(a, k);
    return bv === av ? `  ${label}: ${av}` : `  ${label}: ${bv} → ${av}`;
  });
  return ['Proponowana edycja startu:', ...lines, 'Napisz „tak", żeby zapisać zmiany.'].join('\n');
}

async function insertPending(supabase: ToolCtx['supabase'], athleteId: string, row: Record<string, unknown>) {
  await supabase.from('pending_changes').delete().eq('athlete_id', athleteId); // stare pending → out
  return supabase.from('pending_changes').insert({ athlete_id: athleteId, ...row }).select('id').single();
}

async function proposeRaceChange({ supabase, athleteId }: ToolCtx, input: Record<string, unknown>) {
  const today = userTodayISO();
  const op = str(input.operation);

  if (op === 'add') {
    const name = str(input.name), date = str(input.date), priority = str(input.priority);
    if (!name || !date || !priority) return { ok: false, error: 'Do dodania startu potrzebuję nazwy, daty i priorytetu (A/B/C).' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Niepoprawna data.' };
    if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) return { ok: false, error: 'Priorytet musi być A, B albo C.' };
    if (date < today) return { ok: false, error: `Nie dodam startu z przeszłą datą (${date}). Starty dodaję na dziś lub później.` };
    const series = RACE_SERIES.includes(str(input.series) as (typeof RACE_SERIES)[number]) ? str(input.series) : null;
    const race: RaceFields = { name, date, priority: priority as 'A' | 'B' | 'C', series, distance_km: intOrNull(input.distance_km), elevation_m: intOrNull(input.elevation_m) };
    const { data: pend, error } = await insertPending(supabase, athleteId, { kind: 'race', base_hash: sha256(`add:${JSON.stringify(race)}`), payload_json: { operation: 'add', race } });
    if (error || !pend) return { ok: false, error: `Nie udało się zapisać propozycji: ${error?.message ?? ''}` };
    return { ok: true, change_id: pend.id, diff: buildRaceDiff('add', null, race, today), requires_confirmation: true };
  }

  const raceId = str(input.race_id);
  if (!raceId) return { ok: false, error: `Do ${op === 'edit' ? 'edycji' : 'usunięcia'} startu potrzebuję jego identyfikatora — sprawdź get_races.` };
  const before = await getRace(supabase, athleteId, raceId);
  if (!before) return { ok: false, error: 'Nie znalazłem takiego startu w kalendarzu.' };
  const baseHash = sha256(JSON.stringify(before));

  if (op === 'delete') {
    const { data: pend, error } = await insertPending(supabase, athleteId, { kind: 'race', race_id: raceId, base_hash: baseHash, payload_json: { operation: 'delete', race_id: raceId, before } });
    if (error || !pend) return { ok: false, error: `Nie udało się zapisać propozycji: ${error?.message ?? ''}` };
    return { ok: true, change_id: pend.id, diff: buildRaceDiff('delete', before, null, today), requires_confirmation: true };
  }

  if (op === 'edit') {
    const patch: Partial<RaceFields> = {};
    if (input.name != null) patch.name = str(input.name);
    if (input.date != null) { const d = str(input.date); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, error: 'Niepoprawna data.' }; patch.date = d; }
    if (input.priority != null) { if (!PRIORITIES.includes(str(input.priority) as (typeof PRIORITIES)[number])) return { ok: false, error: 'Priorytet musi być A, B albo C.' }; patch.priority = str(input.priority) as 'A' | 'B' | 'C'; }
    if (input.series != null) patch.series = RACE_SERIES.includes(str(input.series) as (typeof RACE_SERIES)[number]) ? str(input.series) : null;
    if (input.distance_km != null) patch.distance_km = intOrNull(input.distance_km);
    if (input.elevation_m != null) patch.elevation_m = intOrNull(input.elevation_m);
    if (Object.keys(patch).length === 0) return { ok: false, error: 'Nie podałeś, co zmienić w starcie.' };
    const after: RaceFields = { ...before, ...patch } as RaceFields;
    if (after.date < today) return { ok: false, error: `Edycja dotyczy przeszłego startu (${after.date}). Przeszły start mogę tylko usunąć.` };
    const { data: pend, error } = await insertPending(supabase, athleteId, { kind: 'race', race_id: raceId, base_hash: baseHash, payload_json: { operation: 'edit', race_id: raceId, patch, before } });
    if (error || !pend) return { ok: false, error: `Nie udało się zapisać propozycji: ${error?.message ?? ''}` };
    return { ok: true, change_id: pend.id, diff: buildRaceDiff('edit', before, after, today), requires_confirmation: true };
  }

  return { ok: false, error: 'Nieznana operacja (add/edit/delete).' };
}

export async function cancelChange({ supabase, athleteId }: ToolCtx, input: Record<string, unknown>) {
  const changeId = str(input.change_id);
  if (!changeId) return { ok: false, error: 'Brak change_id.' };
  const { data: pend } = await supabase.from('pending_changes').select('id').eq('id', changeId).eq('athlete_id', athleteId).maybeSingle();
  if (!pend) return { ok: true, cancelled: false, message: 'Nie ma już takiej oczekującej propozycji (mogła wygasnąć).' };
  await supabase.from('pending_changes').delete().eq('id', pend.id);
  return { ok: true, cancelled: true, message: 'Propozycja odrzucona.' };
}

export async function commitChange({ supabase, athleteId }: ToolCtx, input: Record<string, unknown>) {
  const changeId = typeof input.change_id === 'string' ? input.change_id : '';
  if (!changeId) return { ok: false, error: 'Brak change_id.' };

  const { data: pend } = await supabase.from('pending_changes').select('*').eq('id', changeId).eq('athlete_id', athleteId).maybeSingle();
  if (!pend) return { ok: false, error: 'Ta zmiana wygasła albo została już zastosowana. Poproś o nową propozycję, jeśli chcesz coś zmienić.' };

  const isOverload = (pend.payload_json as { source?: string } | null)?.source === 'overload';
  const ttlMs = isOverload ? OVERLOAD_TTL_MS : PENDING_TTL_MS;
  if (Date.now() - new Date(pend.created_at as string).getTime() > ttlMs) {
    await supabase.from('pending_changes').delete().eq('id', pend.id);
    return { ok: false, error: isOverload ? 'Propozycja korekty wygasła. Otwórz jazdę ponownie, jeśli chcesz nową.' : 'Propozycja wygasła (ponad 15 minut). Przygotuję nową, jeśli chcesz.' };
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

  if (pend.kind === 'race') {
    const payload = pend.payload_json as RacePayload;
    const consume = () => supabase.from('pending_changes').delete().eq('id', pend.id);

    if (payload.operation === 'add') {
      const { id } = await addRace(supabase, athleteId, payload.race);
      await consume();
      return { ok: true, applied: true, kind: 'race', race_id: id, message: `Dodano start „${payload.race.name}" (${payload.race.date}) do kalendarza.` };
    }

    // edit/delete — optimistic lock na aktualnym wierszu startu.
    const cur = await getRace(supabase, athleteId, payload.race_id);
    if (!cur) {
      await consume();
      return { ok: false, error: 'Start zniknął z kalendarza (mógł zostać usunięty). Nie ma czego zmieniać.' };
    }
    if (sha256(JSON.stringify(cur)) !== pend.base_hash) {
      await consume();
      return { ok: false, error: 'Start zmienił się od czasu propozycji. Przygotuję nową propozycję, jeśli potwierdzisz.' };
    }
    if (payload.operation === 'edit') {
      await editRace(supabase, athleteId, payload.race_id, payload.patch);
      await consume();
      return { ok: true, applied: true, kind: 'race', message: `Zaktualizowano start „${cur.name}" w kalendarzu.` };
    }
    await deleteRace(supabase, athleteId, payload.race_id);
    await consume();
    return { ok: true, applied: true, kind: 'race', message: `Usunięto start „${cur.name}" (${cur.date}) z kalendarza.` };
  }

  return { ok: false, error: 'Nieznany typ zmiany.' };
}

export async function dispatchWrite(name: string, input: Record<string, unknown>, ctx: ToolCtx): Promise<unknown> {
  switch (name) {
    case 'propose_plan_change': return proposePlanChange(ctx, input);
    case 'propose_race_change': return proposeRaceChange(ctx, input);
    case 'commit_change': return commitChange(ctx, input);
    case 'cancel_change': return cancelChange(ctx, input);
    default: throw new Error(`unknown write tool: ${name}`);
  }
}
