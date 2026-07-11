// Auto-korekta planu po przeciążeniu — silnik (trigger, klasyfikacja, propozycja).
// LOAD, nie intensywność: trigger po TSS (kalibracja na 60 dniach realnych danych — rozkład
// bimodalny: zgodne ≤1.27, przepalenia ≥1.79, więc 1.3×/30 ma szeroki margines). IF klasyfikuje
// TREŚĆ propozycji, nie bramkuje: objętościowe → scaleWeek w dół (SURVIVOR_PRIORITY chroni
// klucz), intensywnościowe → celowana zmiana następnego dnia. E-bike (IF null) → zawsze volume.
//
// GUARD TAPERU (warunek wejścia całej funkcji): dni w oknie [race − taperDaysFor(prio), race]
// są NIETYKALNE — lock przed mechanizmem + post-check + restore (lib/taper-guard).
//
// Zapis: pending_changes kind='plan' z markerem payload_json.source='overload' (TTL 12 h
// w commitChange; zero migracji — CHECK constraint z 010 zostaje). Commit/cancel przez
// istniejące endpointy #62 — deterministycznie, bez modelu.
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { scaleWeek } from '@/lib/plan';
import { sessionStructure } from '@/lib/workout';
import { taperProtector, lockTaperDays, taperViolations, restoreProtectedDays, type RaceRef } from '@/lib/taper-guard';
import { buildPlanDiff } from '@/lib/ai/chat-write-tools';
import { isOU, buildLabel, structureMainMin, type DayStructure } from '@/lib/structure';
import type { PlanDay } from '@/lib/ai/plan-generate';
import type { PlanModificationResult } from '@/lib/ai/plan-modify';

// ── Trigger (progi z kalibracji) ─────────────────────────────────────────────────
export const OVERLOAD_RATIO = 1.3;
export const OVERLOAD_MIN_SURPLUS_TSS = 30;

export function detectOverload(rideTss: number | null, planTss: number | null): { overload: boolean; ratio: number; surplus: number } {
  if (rideTss == null || planTss == null || planTss <= 0) return { overload: false, ratio: 0, surplus: 0 };
  const ratio = rideTss / planTss;
  const surplus = rideTss - planTss;
  return { overload: ratio > OVERLOAD_RATIO && surplus >= OVERLOAD_MIN_SURPLUS_TSS, ratio, surplus };
}

// ── Klasyfikacja treści: intensity gdy IF jazdy PONAD pasmem typu dnia ───────────
// Pasma = górna granica "zgodnej" intensywności dla typu (powyżej = jechane mocniej niż plan).
const TYPE_IF_BAND: Record<string, number> = { Z1: 0.6, Z2: 0.78, LONG: 0.78, SST: 0.88, THR: 0.95, OU: 0.95, VO2: 1.0 };
export type OverloadMode = 'volume' | 'intensity';

export function classifyOverload(rideIF: number | null, planType: string, isEbike: boolean): OverloadMode {
  if (isEbike || rideIF == null) return 'volume'; // e-bike: TSS-HR, moc silnika — zawsze objętościowa ścieżka
  const band = TYPE_IF_BAND[planType] ?? 0.85;
  return rideIF > band ? 'intensity' : 'volume';
}

// ── Wynik budowy korekty ─────────────────────────────────────────────────────────
export type CorrectionBuild =
  | { ok: true; result: PlanModificationResult; diff: string }
  | { ok: false; notice?: string }; // notice → pokazujemy userowi bez propozycji (np. klucz nieredukowalny)

const KEY_TYPES = new Set(['VO2', 'THR', 'OU', 'SST']); // hierarchia z lib/plan (SURVIVOR_PRIORITY)
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// buildPlanDiff kończy chatowym CTA („Napisz «tak»…") — w karcie z przyciskami myli; ucinamy.
function cardDiff(diff: string): string {
  return diff.split('\n').filter((l) => !l.startsWith('Napisz ')).join('\n').trimEnd();
}

function planResult(days: PlanDay[], insight: string): PlanModificationResult {
  return { days, insight, tssTarget: Math.round(days.reduce((a, d) => a + (d.tss || 0), 0)), skippedPastDows: [] };
}

// ── Ścieżka OBJĘTOŚCIOWA: scaleWeek w dół o ekwiwalent nadwyżki ──────────────────
export function buildVolumeCorrection(
  days: PlanDay[],
  surplusTss: number,
  races: RaceRef[],
  isDone: (date: string) => boolean,
  todayISO: string,
  weekStart: string
): CorrectionBuild {
  const prot = taperProtector(races);

  // Nadwyżka TSS → minuty przez gęstość planu tygodnia (deterministycznie, bez AI).
  const trainDays = days.filter((d) => d.type !== 'OFF' && d.type !== 'RACE' && d.dur_min > 0);
  const weekMin = trainDays.reduce((a, d) => a + d.dur_min, 0);
  const weekTss = trainDays.reduce((a, d) => a + d.tss, 0);
  if (weekMin <= 0 || weekTss <= 0) return { ok: false };
  const cutMin = Math.round(surplusTss / (weekTss / weekMin));
  if (cutMin < 15) return { ok: false }; // korekta poniżej kwadransa nie ma sensu treningowego

  const totalMin = days.reduce((a, d) => a + d.dur_min, 0);
  const locked = lockTaperDays(days, prot);

  // scaleWeek liczy deltę względem sumy dni SKALOWALNYCH (baseDur), nie całego tygodnia —
  // target musi być baseScalable − cut, inaczej dodatnia delta SKALUJE W GÓRĘ (zaobserwowane
  // w teście guardu: jedyny wolny dzień urósł 90→159 min). Te same predykaty co scaleWeek.
  const isPast = (date: string) => date < todayISO;
  const baseScalable = locked
    .filter((d) => d.type !== 'OFF' && d.type !== 'RACE' && !isDone(d.date) && !isPast(d.date) && !d.locked)
    .reduce((a, d) => a + d.dur_min, 0);
  if (baseScalable <= cutMin) return { ok: false }; // nie ma z czego ciąć (reszta tygodnia chroniona/done)

  const scaled = scaleWeek(locked, baseScalable - cutMin, isDone, todayISO);

  // Guard: post-check PRZED restore; potem zdejmij wstrzyknięte locki.
  if (taperViolations(locked, scaled, prot).length > 0) return { ok: false };
  const after = restoreProtectedDays(days, scaled, prot);

  // Sanity: korekta MUSI redukować (scaleWeek przy prawie-całym tygodniu zablokowanym
  // potrafi podnieść jedyny wolny dzień — zaobserwowane w teście guardu) i coś zmienić.
  const afterMin = after.reduce((a, d) => a + d.dur_min, 0);
  if (afterMin >= totalMin) return { ok: false };
  const diff = buildPlanDiff(days, planResult(after, ''), weekStart);
  if (!diff.trim()) return { ok: false };

  const insight = `Auto-korekta po przeciążeniu (+${Math.round(surplusTss)} TSS ponad plan): zdjęte ~${totalMin - afterMin} min z pozostałych dni tygodnia, kluczowe sesje chronione.`;
  return { ok: true, result: planResult(after, insight), diff: cardDiff(buildPlanDiff(days, planResult(after, insight), weekStart)) };
}

// ── Ścieżka INTENSYWNOŚCIOWA: celowana zmiana NASTĘPNEGO dnia ────────────────────
// Wypełniacz (Z1/Z2/LONG) → zamiana na Z1 „Regeneracja aktywna" 60 min.
// KLUCZ (VO2/THR/OU/SST) → NIE kasujemy bodźca: redukcja objętości interwałów o ~1/3
// (mniej reps, ta sama strefa/struktura). Nieredukowalny (structure null / reps 1) →
// ok:false z notice — lepiej brak propozycji niż propozycja kasująca klucz.
export function buildIntensityCorrection(
  days: PlanDay[],
  rideDate: string,
  races: RaceRef[],
  isDone: (date: string) => boolean,
  weekStart: string
): CorrectionBuild {
  const prot = taperProtector(races);

  // Najbliższy przyszły dzień treningowy; dni chronione taperem/locked/done pomijamy.
  const candidate = days.find(
    (d) => d.date > rideDate && d.type !== 'OFF' && d.type !== 'RACE' && !d.locked && !isDone(d.date) && !prot(d.date)
  );
  if (!candidate) return { ok: false };

  let newDay: PlanDay;
  if (!KEY_TYPES.has(candidate.type)) {
    // Wypełniacz → regeneracja.
    newDay = {
      ...candidate, type: 'Z1' as PlanDay['type'], label: 'Regeneracja aktywna',
      tss: 35, dur_min: 60, watt: '–', hr: '–', zones: [70, 30, 0, 0, 0], structure: null,
    };
  } else {
    // Klucz → redukcja reps o ~1/3, struktura i strefa zachowane.
    const s = candidate.structure;
    if (!s) return { ok: false, notice: 'Wykryto intensywność ponad plan, ale następny trening to kluczowa sesja bez struktury do redukcji — oceń sam, czy ją zmniejszyć.' };
    const newReps = Math.max(1, Math.round((s.reps * 2) / 3));
    if (newReps >= s.reps) return { ok: false, notice: 'Wykryto intensywność ponad plan, ale następny trening to pojedynczy kluczowy interwał — oceń sam, czy go zmniejszyć.' };
    const newStruct: DayStructure = { ...s, reps: newReps };
    const ss = sessionStructure(candidate.type);
    // warmup/cooldown to opcjonalne pola widoku (suwak) — w plan_json bywają, w typie PlanDay nie.
    const wc = candidate as PlanDay & { warmup?: number; cooldown?: number };
    const wUsed = wc.warmup ?? ss.warmupDefault;
    const cUsed = wc.cooldown ?? ss.cooldownDefault;
    const oldMain = structureMainMin(s);
    const newMain = structureMainMin(newStruct);
    const newDur = wUsed + newMain + cUsed;
    newDay = {
      ...candidate, structure: newStruct, label: buildLabel(candidate.type, newStruct),
      dur_min: newDur,
      tss: Math.max(1, Math.round(candidate.tss * (newDur / Math.max(1, candidate.dur_min)))),
    };
  }

  const after = days.map((d) => (d.date === candidate.date ? newDay : d));
  // Post-check guardu także tutaj (kandydat już odfiltrowany, ale pas i szelki).
  if (taperViolations(lockTaperDays(days, prot), after, prot).length > 0) return { ok: false };

  const verb = KEY_TYPES.has(candidate.type) ? `zmniejszone interwały (${candidate.label} → ${newDay.label})` : `${candidate.label} → regeneracja`;
  const insight = `Auto-korekta po intensywnym przeciążeniu: następny dzień (${candidate.date}) — ${verb}.`;
  const res = planResult(after, insight);
  const diff = buildPlanDiff(days, res, weekStart);
  if (!diff.trim()) return { ok: false };
  return { ok: true, result: res, diff: cardDiff(diff) };
}

// ── Pending: upsert z markerem source='overload' (NIE kasuje pendingów z chatu) ──
const FRESH_MS = 12 * 60 * 60 * 1000; // TTL 12 h — spójnie z commitChange (marker overload)

export async function upsertOverloadPending(
  supabase: SupabaseClient,
  athleteId: string,
  weekStart: string,
  planJson: unknown,
  result: PlanModificationResult
): Promise<{ changeId: string } | null> {
  // Idempotencja otwarć karty: świeży pending overload tego tygodnia → zwróć istniejący.
  const { data: existing } = await supabase
    .from('pending_changes')
    .select('id, created_at, base_hash')
    .eq('athlete_id', athleteId).eq('kind', 'plan').eq('week_start', weekStart)
    .contains('payload_json', { source: 'overload' })
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  const baseHash = sha256(JSON.stringify(planJson));
  if (existing && Date.now() - new Date(existing.created_at as string).getTime() < FRESH_MS && existing.base_hash === baseHash) {
    return { changeId: existing.id as string };
  }

  // Kasujemy WYŁĄCZNIE poprzednie korekty overload tego tygodnia (pending z chatu nietykalny).
  await supabase
    .from('pending_changes').delete()
    .eq('athlete_id', athleteId).eq('kind', 'plan').eq('week_start', weekStart)
    .contains('payload_json', { source: 'overload' });

  const { data, error } = await supabase
    .from('pending_changes')
    .insert({
      athlete_id: athleteId, kind: 'plan', week_start: weekStart, base_hash: baseHash,
      payload_json: { ...result, source: 'overload' },
    })
    .select('id').single();
  if (error || !data) return null;
  return { changeId: data.id as string };
}
