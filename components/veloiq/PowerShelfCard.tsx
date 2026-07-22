import { C, F, RADIUS } from '@/lib/theme';
import { CardLabel } from './CardLabel';
import type { PowerRecord, PowerDuration } from '@/lib/dashboard-engagement';

// Rekordy mocy sezonu (ETAP 3.5) — 4 kafle 5s/1min/5min/20min. Kafel z rekordem z ostatnich 7 dni:
// zielona ramka + subtelny glow + badge "NOWY" (akcent niesie informację → dozwolony). Reszta stonowana.

const DUR_LABEL: Record<PowerDuration, string> = { '5s': '5 s', '1min': '1 min', '5min': '5 min', '20min': '20 min' };
const MONTH_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

function fmtDate(dateIso: string | null): string {
  if (!dateIso) return '—';
  const [, m, d] = dateIso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTH_SHORT[m - 1]}`;
}

export function PowerShelfCard({ power }: { power: PowerRecord[] }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.card, padding: '1.05rem 1.15rem' }}>
      <CardLabel style={{ marginBottom: 12 }}>Rekordy mocy · sezon</CardLabel>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {power.map((p) => (
          <div
            key={p.dur}
            style={{
              position: 'relative', textAlign: 'center', borderRadius: 12, padding: '0.7rem 0.35rem 0.56rem',
              background: C.card2,
              border: `1px solid ${p.isNew ? C.green + '88' : C.border}`,
              boxShadow: p.isNew ? `0 0 14px -6px ${C.green}99` : 'none',
            }}
          >
            {p.isNew && (
              <span style={{
                position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)',
                background: C.green, color: C.bg, borderRadius: 9, padding: '0.1rem 0.4rem',
                fontSize: 8, fontWeight: 800, letterSpacing: '0.1em',
              }}>NOWY</span>
            )}
            <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>{DUR_LABEL[p.dur]}</div>
            <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 700, marginTop: 4, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: p.isNew ? C.green : C.text }}>
              {p.watts != null ? p.watts : '—'}<span style={{ fontSize: 9, color: C.muted, fontWeight: 500 }}> W</span>
            </div>
            <div style={{ fontSize: 8.5, color: C.muted, marginTop: 4 }}>{fmtDate(p.date)}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 11, fontSize: 9.5, color: C.muted, textAlign: 'center' }}>NOWY = rekord pobity w ostatnich 7 dniach</div>
    </div>
  );
}
