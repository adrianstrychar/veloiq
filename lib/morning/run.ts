// Raport poranny – I/O: zbiera dane (WHOOP, PMC, plan tygodnia, jazdy, starty), woła silnik,
// zapisuje odciążenie do planu i raport do morning_reports. Wołane z: webhooka WHOOP (po nowej
// regeneracji/śnie), crona i pulpitu (zapas, gdy webhook nie dotarł). Idempotentne – ten sam
// poranek liczy się raz, ponownie tylko gdy WHOOP przeliczy dane (inny inputs_key).
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { userTodayISO, shiftISO } from '@/lib/timezone';
import { mondayOfISO } from '@/lib/plan';
import { loadWhoop, type WhoopState } from '@/lib/whoop-summary';
import { decideMorning, type MorningVerdict } from '@/lib/morning/engine';
import { notifyMorning } from '@/lib/morning/notify';
import type { PlanDay } from '@/lib/ai/plan-generate';

export interface MorningReportRow {
  athlete_id: string;
  date: string;
  verdict: MorningVerdict;
  level: string | null;
  recovery: number | null;
  headline: string;
  title: string;
  reason: string;
  tips: string[];
  signals: Record<string, unknown> | null;
  change_mode: 'auto' | 'proposal' | null;
  change_status: 'applied' | 'proposed' | 'reverted' | 'accepted' | 'dismissed' | 'stale' | null;
  week_start: string | null;
  plan_before: PlanJson | null;
  plan_after: PlanJson | null;
  hash_before: string | null;
  hash_after: string | null;
  inputs_key: string | null;
  push: string | null;
  notified_at: string | null;
  seen_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PlanJson { days: PlanDay[]; insight?: string; [k: string]: unknown }

// Skrót planu niezależny od kolejności kluczy (jsonb w Postgresie przestawia klucze obiektów).
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}
export const planHash = (p: unknown) => createHash('sha256').update(stable(p)).digest('hex');

const tssOf = (days: PlanDay[]) => Math.round(days.reduce((a, d) => a + (Number(d.tss) || 0), 0));

/** Zapis planu tygodnia (bez zerowania suwaka godzin) + świeży brief dnia w czacie. */
export async function writeWeekPlan(supabase: SupabaseClient, athleteId: string, weekStart: string, plan: PlanJson): Promise<boolean> {
  const { error } = await supabase.from('weekly_plans')
    .update({ plan_json: plan, weekly_tss_target: tssOf(plan.days) })
    .eq('athlete_id', athleteId).eq('week_start', weekStart);
  if (error) return false;
  await supabase.from('athletes').update({ daily_brief_date: null }).eq('id', athleteId);
  return true;
}

export async function getMorningReport(supabase: SupabaseClient, athleteId: string, date = userTodayISO()): Promise<MorningReportRow | null> {
  const { data, error } = await supabase.from('morning_reports').select('*').eq('athlete_id', athleteId).eq('date', date).maybeSingle();
  if (error) return null; // brak tabeli (migracja 025 jeszcze nie puszczona) → bez raportu
  return (data as MorningReportRow | null) ?? null;
}

/**
 * Policz (albo zwróć już policzony) raport na dziś. null = brak dzisiejszej regeneracji WHOOP
 * albo brak tabeli. `whoop` – stan już wczytany przez wołającego (pulpit), żeby nie czytać drugi raz.
 */
export async function runMorningReport(
  supabase: SupabaseClient,
  athleteId: string,
  opts: { whoop?: WhoopState | null; force?: boolean } = {}
): Promise<MorningReportRow | null> {
  const today = userTodayISO();
  const whoop = opts.whoop ?? (await loadWhoop(supabase, athleteId, today).catch(() => null));
  const w = whoop?.today;
  if (!whoop || !w || w.date !== today || w.recovery == null) return null;

  const { data: existingRaw, error: exErr } = await supabase.from('morning_reports').select('*').eq('athlete_id', athleteId).eq('date', today).maybeSingle();
  if (exErr) return null;
  const existing = existingRaw as MorningReportRow | null;

  const tRow = whoop.history.find((r) => r.date === today);
  const inputsKey = createHash('sha256').update(stable({
    rec: w.recovery, hrv: w.hrv, rhr: w.rhr, sleep: w.sleepMin, perf: w.sleepPerf, need: w.sleepNeedMin,
    skin: tRow?.skin_temp ?? null, resp: tRow?.resp_rate ?? null,
  })).digest('hex');
  if (existing && existing.inputs_key === inputsKey && !opts.force) return existing;
  // zawodnik już zdecydował (cofnął / zatwierdził / odrzucił) – nie nadpisujemy jego decyzji
  if (existing && ['reverted', 'accepted', 'dismissed', 'stale'].includes(existing.change_status ?? '')) return existing;

  const weekStart = mondayOfISO(today);
  const [{ data: pmc }, { data: ath }, { data: planRow }, { data: acts }, { data: races }, { data: sleepRow }] = await Promise.all([
    supabase.from('fitness_metrics').select('tsb').eq('athlete_id', athleteId).order('date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('athletes').select('ftp_watts').eq('id', athleteId).maybeSingle(),
    supabase.from('weekly_plans').select('plan_json').eq('athlete_id', athleteId).eq('week_start', weekStart).maybeSingle(),
    supabase.from('strava_activities').select('activity_date').eq('athlete_id', athleteId).gte('activity_date', weekStart).lte('activity_date', shiftISO(weekStart, 6)),
    supabase.from('race_calendar').select('name, date, priority').eq('athlete_id', athleteId).gte('date', today).lte('date', shiftISO(today, 21)),
    supabase.from('whoop_daily').select('sleep_end').eq('athlete_id', athleteId).eq('date', today).maybeSingle(),
  ]);

  const current = (planRow?.plan_json as PlanJson | null) ?? null;
  const curHash = current ? planHash(current) : null;

  // Bazą decyzji jest plan SPRZED porannej zmiany: gdy rano już coś zapisaliśmy, a plan od tamtej pory
  // się nie zmienił – liczymy od oryginału (WHOOP przeliczył dane → decyzja może być inna).
  let base = current;
  if (existing?.change_status === 'applied') {
    if (curHash !== existing.hash_after) {
      // plan zmieniony ręcznie po porannej korekcie – nie ruszamy go, raport zostaje jak był
      await supabase.from('morning_reports').update({ change_status: 'stale', updated_at: new Date().toISOString() }).eq('athlete_id', athleteId).eq('date', today);
      return { ...existing, change_status: 'stale' };
    }
    base = existing.plan_before ?? current;
  }

  const done = new Set((acts ?? []).map((a) => a.activity_date as string));
  const result = decideMorning({
    today,
    whoop: w,
    history: whoop.history,
    tsb: pmc?.tsb != null ? Number(pmc.tsb) : null,
    ftp: ath?.ftp_watts != null ? Number(ath.ftp_watts) : null,
    days: base?.days ?? [],
    isDone: (d) => done.has(d),
    races: (races ?? []).map((r) => ({ date: r.date as string, priority: (r.priority as string | null) ?? null, name: r.name as string })),
    wakeAt: (sleepRow?.sleep_end as string | null) ?? null,
  });

  let status: MorningReportRow['change_status'] = null;
  let planBefore: PlanJson | null = null, planAfter: PlanJson | null = null;
  let hashBefore: string | null = null, hashAfter: string | null = null;

  if (base && result.days && result.mode) {
    planBefore = base;
    planAfter = { ...base, days: result.days };
    hashBefore = planHash(planBefore);
    hashAfter = planHash(planAfter);
    if (result.mode === 'auto') {
      status = (await writeWeekPlan(supabase, athleteId, weekStart, planAfter)) ? 'applied' : null;
      if (!status) { planBefore = planAfter = null; hashBefore = hashAfter = null; }
    } else {
      status = 'proposed';
      // propozycja nie zmienia planu; jeśli wcześniej rano coś zapisaliśmy – wracamy do oryginału
      if (existing?.change_status === 'applied' && base !== current) await writeWeekPlan(supabase, athleteId, weekStart, base);
    }
  } else if (existing?.change_status === 'applied' && base && base !== current) {
    // nowe dane WHOOP: korekta już niepotrzebna → przywróć oryginalny plan
    await writeWeekPlan(supabase, athleteId, weekStart, base);
  }

  const row: MorningReportRow = {
    athlete_id: athleteId,
    date: today,
    verdict: result.verdict,
    level: result.signals.level,
    recovery: w.recovery,
    headline: result.headline,
    title: result.title,
    reason: result.reason,
    tips: result.tips,
    signals: { flags: result.signals.flags, illness: result.signals.illness, sleepDebtMin: result.signals.sleepDebtMin, skinTempDelta: result.signals.skinTempDelta, respDelta: result.signals.respDelta, moved: result.moved ? { from: result.moved.from.date, to: result.moved.to.date } : null },
    change_mode: result.mode,
    change_status: status,
    week_start: result.mode ? weekStart : null,
    plan_before: planBefore,
    plan_after: planAfter,
    hash_before: hashBefore,
    hash_after: hashAfter,
    inputs_key: inputsKey,
    push: result.push,
    notified_at: existing?.notified_at ?? null,
    seen_at: existing && existing.verdict === result.verdict && existing.title === result.title ? existing.seen_at : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('morning_reports').upsert(row, { onConflict: 'athlete_id,date' });
  if (error) return null;

  // powiadomienie: tylko nowy raport albo zmieniona decyzja
  if (!existing || existing.title !== row.title) {
    const sent = await notifyMorning(supabase, row).catch(() => false);
    if (sent) {
      row.notified_at = new Date().toISOString();
      await supabase.from('morning_reports').update({ notified_at: row.notified_at }).eq('athlete_id', athleteId).eq('date', today);
    }
  }
  return row;
}

/** Przyciski karty: cofnij odciążenie / zatwierdź propozycję / odrzuć propozycję. */
export async function actOnMorningReport(
  supabase: SupabaseClient,
  athleteId: string,
  action: 'revert' | 'accept' | 'dismiss' | 'seen',
  date = userTodayISO()
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const rep = await getMorningReport(supabase, athleteId, date);
  if (!rep) return { ok: false, error: 'Nie ma raportu na ten dzień.' };
  const upd = (patch: Partial<MorningReportRow>) =>
    supabase.from('morning_reports').update({ ...patch, updated_at: new Date().toISOString() }).eq('athlete_id', athleteId).eq('date', date);

  if (action === 'seen') { if (!rep.seen_at) await upd({ seen_at: new Date().toISOString() }); return { ok: true }; }

  const { data: planRow } = rep.week_start
    ? await supabase.from('weekly_plans').select('plan_json').eq('athlete_id', athleteId).eq('week_start', rep.week_start).maybeSingle()
    : { data: null };
  const cur = planRow?.plan_json ? planHash(planRow.plan_json) : null;

  if (action === 'revert') {
    if (rep.change_status !== 'applied' && rep.change_status !== 'accepted') return { ok: false, error: 'Nie ma czego cofać.' };
    if (!rep.plan_before || !rep.week_start) return { ok: false, error: 'Brak zapisanego planu sprzed zmiany.' };
    if (cur !== rep.hash_after) return { ok: false, error: 'Plan zmienił się od rana – nie cofam automatycznie. Zmień go w planie albo w czacie.' };
    if (!(await writeWeekPlan(supabase, athleteId, rep.week_start, rep.plan_before))) return { ok: false, error: 'Nie udało się zapisać planu.' };
    await upd({ change_status: 'reverted' });
    return { ok: true, message: 'Przywrócono plan sprzed porannej zmiany.' };
  }
  if (action === 'accept') {
    if (rep.change_status !== 'proposed' || !rep.plan_after || !rep.week_start) return { ok: false, error: 'Ta propozycja jest już nieaktualna.' };
    if (cur !== rep.hash_before) { await upd({ change_status: 'stale' }); return { ok: false, error: 'Plan zmienił się od rana – propozycja nieaktualna.' }; }
    if (!(await writeWeekPlan(supabase, athleteId, rep.week_start, rep.plan_after))) return { ok: false, error: 'Nie udało się zapisać planu.' };
    await upd({ change_status: 'accepted' });
    return { ok: true, message: 'Zapisane – plan na dziś zaktualizowany.' };
  }
  // dismiss
  if (rep.change_status !== 'proposed') return { ok: false, error: 'Ta propozycja jest już nieaktualna.' };
  await upd({ change_status: 'dismissed' });
  return { ok: true, message: 'Plan bez zmian.' };
}
