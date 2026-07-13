// Pipeline modyfikacji planu tygodnia — WYDZIELONA z app/api/plan/modify/route.ts (PR groundwork).
// computePlanModification liczy zmodyfikowany plan BEZ zapisu (żeby write tools mogły zrobić dry-run
// i pokazać diff przed potwierdzeniem); applyPlanModification wykonuje zapis. Route i write tools
// wołają te same funkcje — ZERO równoległej logiki mutacji planu.
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isAiOutage, AI_UNAVAILABLE_MSG } from '@/lib/ai/ai-error';
import { buildModifyPrompt, validateWeek, parseCommandDows, type PlanDay, type ModifyContext } from '@/lib/ai/plan-generate';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface PlanModificationResult {
  days: PlanDay[];
  insight: string; // opis STANU tygodnia po zmianie → zapisywany na karcie planu (weekly_plans.plan_json)
  change: string;  // opis SAMEJ zmiany ("skróciłem wtorek bo…") → tylko do rozmowy, NIE zapisywany
  tssTarget: number;
  skippedPastDows: number[]; // dni minione (date < today), których zmiana została odrzucona
}

export type ComputeResult =
  | { ok: true; result: PlanModificationResult }
  | { ok: false; error: string };

// Liczy zmodyfikowany plan BEZ zapisu. Reużywa całej ścieżki /modify: prompt, walidacja,
// TWARDY ENFORCEMENT lockSet (#43), ochrona structure. NOWE: past-day guard (#44) — dni
// date < today NIE są zmieniane (przywracany oryginał), raportowane w skippedPastDows.
export async function computePlanModification(
  currentDays: PlanDay[],
  ctx: ModifyContext,
  message: string,
  weekStart: string,
  todayISO: string
): Promise<ComputeResult> {
  const { system, user: userMsg } = buildModifyPrompt(currentDays, ctx, message);
  const isPast = (date: string) => date < todayISO; // ostry '<' — dziś NIE jest przeszły (#44)

  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 5000, // structure + reguła spójności minut → model liczy w prozie przed JSON-em
        system,
        messages: [{ role: 'user', content: userMsg }],
      });
      const txt = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const a = txt.indexOf('{');
      const b = txt.lastIndexOf('}');
      if (a === -1 || b <= a) { lastErr = 'brak JSON'; continue; }
      const parsed = JSON.parse(txt.slice(a, b + 1));
      const v = validateWeek(parsed.days, weekStart, { outline: false });
      if (!v.ok || !v.days) { lastErr = v.error ?? 'walidacja nieudana'; continue; }

      // ── TWARDY ENFORCEMENT lockowanych dni (#43) — identyczny jak w /modify ──
      const off = new Set<number>(Array.isArray(parsed.off) ? parsed.off.map(Number) : []);
      const unlock = new Set<number>(Array.isArray(parsed.unlock) ? parsed.unlock.map(Number) : []);
      const userSpecified = new Set<number>(Array.isArray(parsed.userSpecifiedDays) ? parsed.userSpecifiedDays.map(Number) : []);
      const commandDays = new Set<number>(parseCommandDows(message));
      const lockSet = new Set<number>(Array.from(userSpecified).filter((d) => commandDays.has(d)));
      let days: PlanDay[] = v.days.map((aiDay) => {
        const dow = aiDay.dow;
        const orig = currentDays.find((o) => o.dow === dow);
        if (off.has(dow)) {
          return { ...aiDay, type: 'OFF' as const, label: 'Odpoczynek', tss: 0, dur_min: 0, watt: '–', hr: '–', zones: [0, 0, 0, 0, 0], locked: lockSet.has(dow), structure: null };
        }
        if (unlock.has(dow)) return { ...aiDay, locked: false };
        if (lockSet.has(dow)) return { ...aiDay, locked: true };
        if (orig?.locked) return { ...orig };
        return { ...aiDay, locked: false };
      });

      // ── OCHRONA STRUCTURE (nie ufamy, że AI ją przepisze) — identyczna jak w /modify ──
      days = days.map((day) => {
        if (day.structure || day.type === 'OFF') return day;
        const orig = currentDays.find((o) => o.dow === day.dow);
        if (orig?.structure && orig.type === day.type && orig.dur_min === day.dur_min && orig.tss === day.tss) {
          return { ...day, structure: orig.structure, label: orig.label, watt: orig.watt };
        }
        return day;
      });

      // ── PAST-DAY GUARD (#44) — NOWE: dzień date < today NIE jest zmieniany. Przywróć oryginał;
      // jeśli AI faktycznie próbowało go zmienić (różny typ/czas/TSS) — zaraportuj w skippedPastDows.
      const skippedPastDows: number[] = [];
      days = days.map((day) => {
        if (!isPast(day.date)) return day;
        const orig = currentDays.find((o) => o.dow === day.dow);
        if (!orig) return day;
        if (orig.type !== day.type || orig.dur_min !== day.dur_min || orig.tss !== day.tss) {
          skippedPastDows.push(day.dow);
        }
        return { ...orig };
      });

      const insight = typeof parsed.insight === 'string' ? parsed.insight : 'Plan zaktualizowany.';
      // change = opis samej edycji do rozmowy; fallback do insight, gdy model go nie zwrócił.
      const change = typeof parsed.change === 'string' ? parsed.change : insight;
      const tssTarget = days.reduce((s, d) => s + d.tss, 0);
      return { ok: true, result: { days, insight, change, tssTarget, skippedPastDows } };
    } catch (err: unknown) {
      // Awaria API (kredyty/limit/sieć) → czytelne zdanie; błędy walidacji zostają surowe.
      lastErr = isAiOutage(err) ? AI_UNAVAILABLE_MSG : err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, error: lastErr };
}

// Zapis do weekly_plans — plan_json + PRZELICZONY weekly_tss_target w tej samej operacji
// (standing rule: nigdy stale values).
export async function applyPlanModification(
  supabase: SupabaseClient,
  planId: string,
  result: PlanModificationResult
): Promise<void> {
  await supabase
    .from('weekly_plans')
    .update({ plan_json: { days: result.days, insight: result.insight }, weekly_tss_target: result.tssTarget })
    .eq('id', planId);
}
