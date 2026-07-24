import { C, F, RADIUS } from '@/lib/theme';
import { CardLabel } from './CardLabel';
import type { GoalStatus } from '@/lib/dashboard-engagement';

// Cel sezonu (ETAP 3.5) — slim strip poziomy: [label + km duże] [pasek + tick "dziś wg planu"]
// [status vs plan + prognoza daty]. Akcent (zielony/czerwony) niesie informację o statusie planu.
// Pasek BEZ glow (zasada koloru). Cel = stała w configu (DASHBOARD_CONFIG.SEASON_KM_GOAL).

const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });
const MONTH_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

function fmtDate(dateIso: string | null): string {
  if (!dateIso) return '—';
  const [, m, d] = dateIso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTH_GEN[m - 1]}`;
}

export function SeasonGoalCard({ goal }: { goal: GoalStatus }) {
  const ahead = goal.aheadKm >= 0;
  const barPct = Math.max(0, Math.min(100, goal.pct));
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.card, padding: '1.05rem 1.15rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        {/* Lewa: label + km */}
        <div style={{ flexShrink: 0 }}>
          <CardLabel style={{ marginBottom: 6 }}>Cel sezonu</CardLabel>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontFamily: F.display, fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: C.text, lineHeight: 1 }}>{nf0.format(goal.kmYtd)}</span>
            <span style={{ fontSize: 12, color: C.muted }}>/ {nf0.format(goal.goalKm)} km</span>
          </div>
        </div>

        {/* Środek: pasek + tick "dziś wg planu" */}
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ position: 'relative', height: 8, background: C.dim, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${barPct}%`, borderRadius: 4, background: C.cyan }} />
          </div>
          {/* tick poza overflow paska (pełna wysokość) */}
          <div style={{ position: 'relative', height: 0 }}>
            <div title="zakładane tempo" style={{ position: 'absolute', top: -12, left: `${goal.tickPct}%`, width: 2, height: 14, background: C.muted, transform: 'translateX(-1px)' }} />
          </div>
          {/* mikro-podpis pod znacznikiem — wyjaśnia, co oznacza pionowa kreska */}
          <div style={{ position: 'relative', height: 10, marginTop: 5 }}>
            <span style={{ position: 'absolute', left: `${goal.tickPct}%`, transform: 'translateX(-50%)', fontSize: 8, lineHeight: 1, color: C.muted, whiteSpace: 'nowrap' }}>zakładane tempo</span>
          </div>
        </div>

        {/* Prawa: status vs plan + prognoza */}
        <div style={{ flexShrink: 0, textAlign: 'right', fontSize: 10.5, color: C.muted, lineHeight: 1.55 }}>
          <b style={{ color: ahead ? C.green : C.red, fontWeight: 700 }}>{ahead ? '▲' : '▼'} {nf0.format(Math.abs(goal.aheadKm))} km</b> {ahead ? 'przed planem' : 'za planem'}<br />
          przy obecnym tempie: cel <span style={{ color: C.text, fontWeight: 600 }}>~{fmtDate(goal.projectedDate)}</span>
        </div>
      </div>
    </div>
  );
}
