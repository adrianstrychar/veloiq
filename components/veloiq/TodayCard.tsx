import Link from 'next/link';
import { C, F, RADIUS } from '@/lib/theme';
import { CardLabel } from './CardLabel';
import { ZONE_COLORS } from '@/lib/plan';

// Karta "Dziś" (ETAP 3.5). Zaplanowana sesja: nazwa, czas+TSS w nagłówku, graficzny pasek stref,
// przycisk "Zobacz szczegóły". BEZ tekstowego opisu struktury sesji (usunięty wg specu).
// Dzień wolny / brak planu → stonowany komunikat, bez akcentu.

export interface TodayPlan {
  label: string;
  type: string;        // OFF/Z1/Z2/SST/THR/OU/VO2/LONG/RACE
  tss: number;
  durMin: number;
  zones: number[];     // [Z1..Z5] %
}

function durLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${m} min`;
}

export function TodayCard({ plan }: { plan: TodayPlan | null }) {
  const isRest = !plan || plan.type === 'OFF';
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.card, padding: '1.05rem 1.15rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <CardLabel style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: isRest ? C.muted : C.green }} />
          Dziś · {isRest ? 'wolne' : 'trening'}
        </CardLabel>
        {!isRest && plan && (
          <span style={{ fontSize: 10.5, color: C.yellow, fontWeight: 700, fontFamily: F.display, fontVariantNumeric: 'tabular-nums' }}>
            {durLabel(plan.durMin)} · {plan.tss} TSS
          </span>
        )}
      </div>

      {isRest ? (
        <div style={{ fontSize: 12.5, color: C.muted, fontStyle: 'italic', padding: '0.4rem 0 0.2rem' }}>
          {plan ? 'Dzień wolny — pełna regeneracja.' : 'Brak zaplanowanej sesji na dziś.'}
        </div>
      ) : plan && (
        <>
          <div style={{ fontFamily: F.display, fontSize: 19, fontWeight: 700, color: C.text }}>{plan.label}</div>
          {/* Graficzny pasek stref (Z1–Z5) — zastępuje usunięty tekstowy opis struktury. */}
          <div style={{ display: 'flex', height: 18, borderRadius: 7, overflow: 'hidden', background: C.dim, marginTop: 14 }}>
            {plan.zones.map((z, i) =>
              z > 0 ? <div key={i} style={{ width: `${(z / (plan.zones.reduce((a, b) => a + b, 0) || 1)) * 100}%`, background: ZONE_COLORS[i] }} /> : null
            )}
          </div>
          <Link href="/plan" style={{ display: 'inline-block', marginTop: 15, background: C.cyan, color: C.bg, borderRadius: 9, padding: '0.5rem 1.05rem', fontSize: 11.5, fontWeight: 700, textDecoration: 'none' }}>
            Zobacz szczegóły →
          </Link>
        </>
      )}
    </div>
  );
}
