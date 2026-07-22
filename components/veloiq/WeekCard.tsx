import { Flame } from 'lucide-react';
import { C, F, RADIUS } from '@/lib/theme';
import { CardLabel } from './CardLabel';

// Karta "Ten tydzień" (ETAP 3.5). Słupki dni: wykonane = pełny gradient, zaplanowane = przerywany
// obrys bez wypełnienia, dziś = cyjanowa obwódka (outline offset 2px). Streak w prawym rogu nagłówka.
// Akcent niesie informację: zielony = wykonane, cyjan = dziś. Reszta stonowana.

export interface WeekDay {
  label: string;       // PN..ND
  done: boolean;       // ma jazdę tego dnia
  planned: boolean;    // dzień treningowy planu bez jazdy
  isToday: boolean;
  heightPct: number;   // 0..100 względem maks. tygodnia (done TSS lub plan TSS)
}
export interface WeekTotals { rides: number; km: number; doneTss: number; planTss: number }

const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });

export function WeekCard({ days, streakWeeks, totals }: { days: WeekDay[]; streakWeeks: number; totals: WeekTotals }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.card, padding: '1.05rem 1.15rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <CardLabel>Ten tydzień</CardLabel>
        {streakWeeks > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.yellow, fontWeight: 700, fontSize: 11 }}>
            <Flame size={14} color={C.yellow} strokeWidth={2} />{streakWeeks} tyg.
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 7, alignItems: 'flex-end', height: 88 }}>
        {days.map((d, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', textAlign: 'center', height: '100%' }}>
            <div
              style={{
                minHeight: 8,
                height: `${Math.max(6, d.heightPct)}%`,
                borderRadius: '4px 4px 2px 2px',
                background: d.done ? `linear-gradient(180deg, ${C.green}A6, ${C.green}26)` : 'transparent',
                border: d.done ? 'none' : `1.5px dashed ${C.border}`,
                outline: d.isToday ? `1.5px solid ${C.cyan}` : 'none',
                outlineOffset: d.isToday ? 2 : 0,
              }}
            />
            <span style={{ fontSize: 8, color: d.isToday ? C.cyan : C.muted, fontWeight: d.isToday ? 700 : 400, letterSpacing: '0.06em', marginTop: 6, textTransform: 'uppercase' }}>{d.label}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 11, fontSize: 11, color: C.muted, flexWrap: 'wrap', gap: 8 }}>
        <span><b style={{ color: C.text, fontWeight: 700 }}>{totals.rides} {totals.rides === 1 ? 'jazda' : 'jazdy'}</b> · {nf0.format(totals.km)} km · {totals.doneTss} TSS</span>
        <span>plan: <b style={{ color: C.text, fontWeight: 700 }}>{totals.planTss} TSS</b></span>
      </div>
    </div>
  );
}
