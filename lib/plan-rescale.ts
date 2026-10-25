// Ręczna zmiana FTP → przeliczenie watów w zapisanych planach (bieżący tydzień od dziś + przyszłe).
// Plan trzyma waty absolutne (structure.work_w / under_w / over_w, pole `watt`, czasem w labelu),
// więc bez tego po podniesieniu FTP treningi zostałyby na starych, słabszych watach.

import type { SupabaseClient } from '@supabase/supabase-js';
import { mondayOfISO } from '@/lib/plan';
import { userTodayISO } from '@/lib/timezone';
import { isBlocks, isOU, structureWatt, type DayStructure } from '@/lib/structure';

const r5 = (w: number) => Math.round(w / 5) * 5;

interface Day { dow: number; label?: string; watt?: string; structure?: DayStructure | null; [k: string]: unknown }

export function rescaleDay(d: Day, ratio: number): Day {
  const out: Day = { ...d };
  const sc = (n: number) => r5(n * ratio);
  if (d.structure) {
    let s: DayStructure;
    const src = d.structure;
    if (isBlocks(src)) s = { ...src, blocks: src.blocks.map((b) => ({ ...b, steps: b.steps.map((st) => ({ ...st, w: sc(st.w) })) })) };
    else if (isOU(src)) s = { ...src, under_w: sc(src.under_w), over_w: sc(src.over_w) };
    else s = { ...src, work_w: sc(src.work_w) };
    out.structure = s;
    out.watt = structureWatt(s);
  } else if (typeof d.watt === 'string' && /\d/.test(d.watt)) {
    out.watt = d.watt.replace(/\d{2,4}/g, (m) => String(sc(+m)));
  }
  // „4×10 min @ 280W”, „270–290W” w nazwie dnia
  if (typeof d.label === 'string') {
    out.label = d.label.replace(/(\d{2,4})(?=\s*(?:[–-]\s*\d{2,4}\s*)?W\b)/g, (m) => String(sc(+m)));
  }
  return out;
}

/** Zwraca liczbę zmienionych tygodni. Dni już minione w bieżącym tygodniu zostają bez zmian. */
export async function rescalePlans(supabase: SupabaseClient, athleteId: string, oldFtp: number, newFtp: number): Promise<number> {
  if (!oldFtp || !newFtp || oldFtp === newFtp) return 0;
  const ratio = newFtp / oldFtp;
  const today = userTodayISO();
  const monday = mondayOfISO(today);
  const todayDow = ((new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1;
  const { data: weeks } = await supabase
    .from('weekly_plans').select('id, week_start, plan_json').eq('athlete_id', athleteId).gte('week_start', monday);
  let changed = 0;
  for (const w of weeks ?? []) {
    const pj = w.plan_json as { days?: Day[] } | null;
    if (!pj?.days) continue;
    const current = w.week_start === monday;
    const days = pj.days.map((d) => (current && d.dow < todayDow ? d : rescaleDay(d, ratio)));
    const { error } = await supabase.from('weekly_plans').update({ plan_json: { ...pj, days } }).eq('id', w.id);
    if (!error) changed++;
  }
  return changed;
}
