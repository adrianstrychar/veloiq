// JEDNO źródło prawdy o "jak wygląda tydzień planu" dla warstwy AI.
//
// PO CO TO ISTNIEJE: widok tygodnia był dotąd zaszyty w handlerze narzędzia get_weekly_plan
// (lib/ai/chat-tools.ts) i dostępny WYŁĄCZNIE wtedy, gdy model sam zdecydował się je wywołać.
// Przy krótkim pytaniu w toku rozmowy ("A dzisiaj?") model tego nie robił i improwizował sesję,
// która przeczyła planowi na ten dzień. Wyciągnięcie widoku tutaj pozwala wstrzyknąć plan
// always-on do system promptu (lib/ai/prompt.ts) i JEDNOCZEŚNIE obsłużyć narzędzie tym samym
// kodem — dwa renderingi planu, które mogłyby się rozjechać, to dokładnie ta klasa błędu.
//
// Reconcile RACE vs żywy race_calendar jest WARSTWĄ ODCZYTU — plan_json pozostaje nietknięty.

import type { SupabaseClient } from '@supabase/supabase-js';
import { dayNamePl } from '@/lib/timezone';
import { estimateRaceDay, type RacePriority } from '@/lib/race-taper';
import type { DayStructure } from '@/lib/structure';

export interface PlanViewDay {
  dow: number;
  date: string;
  date_local: string;
  day_name_pl: string;
  type: string;
  label: unknown;
  tss: unknown;
  dur_min: unknown;
  watt: unknown;
  hr: unknown;
  zones: unknown;
  structure: DayStructure | null;
  locked: boolean;
  outline: boolean;
  past: boolean;
  done: boolean;
}

export interface PlanViewCompletion {
  sessions_due_to_date: number;
  sessions_done_to_date: number;
  tss_planned_to_date: number;
  tss_of_done_sessions: number;
  sessions_completion_pct: number | null;
}

export interface PlanView {
  found: true;
  week_start: string;
  user_hours: number | null;
  insight: string | null;
  completion: PlanViewCompletion;
  days: PlanViewDay[];
}

export interface PlanViewMissing {
  found: false;
  week_start: string;
  message: string;
}

// Buduje widok tygodnia: dni planu z reconcile RACE + flagi past/done + realizacja do teraz.
// `today` podaje wołający (data lokalna użytkownika) — moduł nie zgaduje "dziś".
export async function fetchPlanView(
  supabase: SupabaseClient,
  athleteId: string,
  weekStart: string,
  today: string
): Promise<PlanView | PlanViewMissing> {
  const { data: r } = await supabase
    .from('weekly_plans')
    .select('week_start, plan_json, user_hours')
    .eq('athlete_id', athleteId)
    .eq('week_start', weekStart)
    .maybeSingle();

  if (!r) {
    return { found: false, week_start: weekStart, message: `Brak planu na tydzień od ${weekStart}. Możesz go wygenerować w widoku Plan.` };
  }

  const planDays = (r.plan_json as { days?: Array<Record<string, unknown>> } | null)?.days ?? [];
  const dates = planDays.map((d) => d.date as string);

  // Done-dates + LIVE race_calendar RÓWNOLEGLE (oba keyed po datach planu; +1 round-trip bez latencji).
  // Live race_calendar jest autorytatywny dla dni RACE — reconcile niżej (spójnie z Plan.tsx).
  const [{ data: acts }, { data: raceRows }] = await Promise.all([
    supabase.from('strava_activities').select('activity_date').eq('athlete_id', athleteId).in('activity_date', dates),
    supabase.from('race_calendar').select('date, name, priority, distance_km, elevation_m, discipline').eq('athlete_id', athleteId).in('date', dates),
  ]);
  const doneDates = new Set((acts ?? []).map((a) => a.activity_date));
  const raceByDate = new Map(
    (raceRows ?? []).map((rc) => {
      const est = estimateRaceDay(rc.distance_km as number | null, rc.elevation_m as number | null, rc.discipline as string | null, (rc.priority as RacePriority) ?? 'C');
      return [rc.date as string, { name: rc.name as string, estTss: est?.estTss ?? 0, estTimeMin: est?.estTimeMin ?? 0 }];
    })
  );

  const days: PlanViewDay[] = planDays.map((d) => {
    const dateStr = d.date as string;
    // - live wyścig na tę datę → RACE (z szacunkiem live),
    // - materializowany RACE bez live wyścigu (sierota po usuniętym starcie) → OFF.
    const rm = raceByDate.get(dateStr);
    let type = d.type as string;
    let label = d.label as unknown;
    let tss = d.tss as unknown;
    let dur_min = d.dur_min as unknown;
    let zones = d.zones as unknown;
    let structure = (d.structure ?? null) as DayStructure | null;
    let watt = d.watt as unknown;
    let hr = d.hr as unknown;
    if (rm) {
      type = 'RACE'; label = rm.name; tss = rm.estTss; dur_min = rm.estTimeMin;
      zones = [0, 0, 0, 0, 0]; structure = null; watt = '–'; hr = '–';
    } else if (type === 'RACE') {
      type = 'OFF'; label = 'Odpoczynek'; tss = 0; dur_min = 0;
      zones = [0, 0, 0, 0, 0]; structure = null; watt = '–'; hr = '–';
    }
    return {
      dow: d.dow as number,
      date: dateStr,
      date_local: dateStr,
      day_name_pl: dayNamePl(dateStr),
      type,
      label,
      tss,
      dur_min,
      watt,
      hr,
      zones,
      structure,
      locked: !!d.locked,
      outline: !!d.outline,
      past: dateStr < today,
      done: doneDates.has(dateStr),
    };
  });

  // Realizacja sesji do teraz — TANI wariant z flag past/done + zaplanowanego tss (bez streams).
  // Dni treningowe minione (typ≠OFF) = "należne"; z jazdą tego dnia = "odbyte". Ważone
  // zaplanowanym TSS. MIERZY, czy sesje się ODBYŁY, NIE czy trafiłeś w obciążenie.
  const dueDays = days.filter((d) => d.past && d.type !== 'OFF');
  const doneDoneDays = dueDays.filter((d) => d.done);
  const tssDue = dueDays.reduce((a, d) => a + ((d.tss as number) || 0), 0);
  const tssDone = doneDoneDays.reduce((a, d) => a + ((d.tss as number) || 0), 0);

  return {
    found: true,
    week_start: r.week_start as string,
    user_hours: (r.user_hours as number | null) ?? null,
    insight: (r.plan_json as { insight?: string } | null)?.insight ?? null,
    completion: {
      sessions_due_to_date: dueDays.length,
      sessions_done_to_date: doneDoneDays.length,
      tss_planned_to_date: tssDue,
      tss_of_done_sessions: tssDone,
      sessions_completion_pct: tssDue > 0 ? Math.round((tssDone / tssDue) * 100) : null,
    },
    days,
  };
}

// ── Render do system promptu ────────────────────────────────────────────────

const TYPE_PL: Record<string, string> = {
  OFF: 'wolne', Z1: 'regeneracja', Z2: 'endurance', SST: 'sweet spot',
  THR: 'threshold', OU: 'over-under', VO2: 'VO2max', LONG: 'długa', RACE: 'WYŚCIG',
};

// Zawodnik BEZ miernika mocy: prompt ma twardą regułę "NIGDY nie podawaj watów". Waty wchodzą tu
// bocznymi drzwiami — etykieta sesji jest generowana z substruktury przez buildLabel() i zawiera
// waty absolutne ("Threshold 3×12min @300W"). Samo pominięcie pola `watt` nie wystarcza: model,
// widząc waty w kontekście, powtórzy je w odpowiedzi. Czyścimy u źródła.
function stripWatts(s: string): string {
  return s.replace(/\s*@?\s*\d{2,4}\s*W\b/g, '').replace(/\s{2,}/g, ' ').trim();
}

function labelOf(d: PlanViewDay, hasPower: boolean): string {
  const raw = String(d.label ?? '');
  return hasPower ? raw : stripWatts(raw);
}

// Jedna linia dnia w skrócie tygodnia.
function shortLine(d: PlanViewDay, todayIso: string, tomorrowIso: string, hasPower: boolean): string {
  const mark = d.date === todayIso ? ' ← DZIŚ' : d.date === tomorrowIso ? ' ← JUTRO' : '';
  const status = d.type === 'OFF' ? '' : d.done ? ' [odbyte]' : d.past ? ' [NIEZREALIZOWANE]' : '';
  const body = d.type === 'OFF'
    ? 'wolne'
    : `${d.type} "${labelOf(d, hasPower)}" ${d.dur_min}min, ${d.tss} TSS`;
  return `  ${d.day_name_pl} ${d.date}: ${body}${status}${mark}`;
}

// Pełny opis sesji (dziś/jutro) — tyle, żeby model nie musiał wołać narzędzia dla zwykłego pytania.
function fullLine(d: PlanViewDay, hasPower: boolean): string {
  if (d.type === 'OFF') return `${d.day_name_pl} ${d.date}: DZIEŃ WOLNY (bez jazdy)`;
  const parts: string[] = [
    `${d.day_name_pl} ${d.date}: ${d.type} (${TYPE_PL[d.type] ?? d.type}) — "${labelOf(d, hasPower)}"`,
    `czas ${d.dur_min} min, ${d.tss} TSS`,
  ];
  if (hasPower && d.watt && d.watt !== '–') parts.push(`moc ${d.watt}`);
  if (d.hr && d.hr !== '–') parts.push(`HR ${d.hr}`);
  // structure niesie waty absolutne (work_w / under_w / over_w) — bez miernika mocy NIE wchodzi.
  if (d.structure && hasPower) parts.push(`struktura: ${JSON.stringify(d.structure)}`);
  if (d.done) parts.push('sesja JUŻ ODBYTA (jest jazda na ten dzień)');
  else if (d.past) parts.push('sesja NIEZREALIZOWANA');
  if (d.outline) parts.push('UWAGA: to dopiero zarys, nie pełna rozpiska');
  return parts.join(' | ');
}

/**
 * Blok planu do anchora system promptu. Dziś i jutro w pełnym szczególe, reszta tygodnia skrótem.
 * Zwraca null, gdy planu na ten tydzień nie ma — wtedy model dowie się o tym z narzędzia i nie
 * dostanie w promptcie pustej ramki sugerującej, że plan istnieje.
 */
export function renderPlanAnchor(
  view: PlanView | PlanViewMissing,
  todayIso: string,
  tomorrowIso: string,
  hasPower: boolean
): string | null {
  if (!view.found) return null;

  const today = view.days.find((d) => d.date === todayIso);
  const tomorrow = view.days.find((d) => d.date === tomorrowIso);

  const lines: string[] = ['PLAN TYGODNIA (tydzień od ' + view.week_start + ') — ŹRÓDŁO PRAWDY, nie musisz go dociągać narzędziem:'];
  lines.push(today ? `DZIŚ W PLANIE → ${fullLine(today, hasPower)}` : 'DZIŚ W PLANIE → brak dnia w planie tego tygodnia');
  if (tomorrow) lines.push(`JUTRO W PLANIE → ${fullLine(tomorrow, hasPower)}`);
  lines.push('Cały tydzień skrótem:');
  for (const d of view.days) lines.push(shortLine(d, todayIso, tomorrowIso, hasPower));

  const c = view.completion;
  if (c.sessions_due_to_date > 0) {
    lines.push(`Realizacja do teraz: ${c.sessions_done_to_date} z ${c.sessions_due_to_date} należnych sesji się odbyło.`);
  }
  if (view.insight) lines.push(`Zamysł tygodnia (z generatora): ${view.insight}`);

  return lines.join('\n');
}
