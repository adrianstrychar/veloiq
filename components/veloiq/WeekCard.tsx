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
export interface WeekTotals { rides: number; km: number; movingSec: number; doneTss: number; planTss: number }

const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });

// Czas w ruchu → "H:MM" (np. 3600 s → "1:00").
function hoursLabel(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function WeekCard({ days, streakWeeks, totals }: { days: WeekDay[]; streakWeeks: number; totals: WeekTotals }) {
  const pct = totals.planTss > 0 ? Math.round((totals.doneTss / totals.planTss) * 100) : 0;
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

      {/* Legenda pod słupkami — co znaczy pełny słupek vs przerywany obrys. Mikro, stonowana. */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 9, fontSize: 9, color: C.muted }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 8, borderRadius: 2, background: `linear-gradient(180deg, ${C.green}A6, ${C.green}26)` }} />
          wykonane
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 8, borderRadius: 2, border: `1.5px dashed ${C.border}` }} />
          zaplanowane
        </span>
      </div>

      {/* Podsumowanie tygodnia — jazdy · km · czas w ruchu · TSS wykonane. */}
      <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 11, fontSize: 11, color: C.muted }}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          <b style={{ color: C.text, fontWeight: 700 }}>{totals.rides} {totals.rides === 1 ? 'jazda' : 'jazdy'}</b> · {nf0.format(totals.km)} km · {hoursLabel(totals.movingSec)} h · {totals.doneTss} TSS
        </span>

        {/* Postęp tygodnia: wykonane / zaplanowane. Pasek bez glow (C.cyan). */}
        {totals.planTss > 0 ? (
          <>
            <div style={{ height: 5, background: C.dim, borderRadius: 3, overflow: 'hidden', marginTop: 9 }}>
              <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: C.cyan, borderRadius: 3 }} />
            </div>
            <div style={{ marginTop: 5, fontSize: 10.5, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
              <b style={{ color: C.text, fontWeight: 700 }}>{totals.doneTss}</b> / {totals.planTss} TSS · {pct}%
            </div>
          </>
        ) : (
          <div style={{ marginTop: 8, fontSize: 10.5, color: C.muted }}>brak planu na ten tydzień</div>
        )}
      </div>
    </div>
  );
}
