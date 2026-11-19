// Widok raportu porannego dla karty (serializowalny, bez pełnych planów).
import { dayNamePl } from '@/lib/timezone';
import type { MorningReportRow } from '@/lib/morning/run';
import type { PlanDay } from '@/lib/ai/plan-generate';

export interface MorningView {
  date: string;
  verdict: string;
  level: 'green' | 'yellow' | 'red' | null;
  headline: string;
  title: string;
  reason: string;
  tips: string[];
  status: MorningReportRow['change_status'];
  mode: MorningReportRow['change_mode'];
  changes: Array<{ day: string; from: string; to: string }>;
  at: string | null;                 // kiedy policzony (HH:mm)
}

const dayTxt = (d: PlanDay | undefined) =>
  !d ? '—' : d.type === 'OFF' ? 'wolne' : `${d.label}${/\d+\s*(min|h)/.test(d.label) ? '' : ` · ${d.dur_min} min`}`;

export function morningView(r: MorningReportRow | null, today: string): MorningView | null {
  if (!r || r.date !== today) return null;
  const changes: MorningView['changes'] = [];
  if (r.plan_before && r.plan_after) {
    for (const a of r.plan_after.days) {
      const b = r.plan_before.days.find((x) => x.date === a.date);
      if (!b || JSON.stringify({ ...b, morning: undefined }) === JSON.stringify({ ...a, morning: undefined })) continue;
      const name = a.date === today ? 'Dziś' : dayNamePl(a.date).replace(/^./, (c) => c.toUpperCase());
      changes.push({ day: name, from: dayTxt(b), to: dayTxt(a) });
    }
  }
  const t = r.created_at ?? r.updated_at ?? null;
  return {
    date: r.date, verdict: r.verdict,
    level: (r.level as MorningView['level']) ?? null,
    headline: r.headline, title: r.title, reason: r.reason, tips: r.tips ?? [],
    status: r.change_status, mode: r.change_mode, changes,
    at: t ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t)) : null,
  };
}
