import { C } from '@/lib/theme';
import { ZONE_COLORS } from '@/lib/plan';

// Skumulowany słupek rozkładu stref Z1–Z5 (1:1 z mockupu). Reuse w 5.4/5.5.
export function ZoneBar({ zones }: { zones: number[] }) {
  const tot = zones.reduce((a, b) => a + b, 0) || 1;
  return (
    <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: C.dim }}>
      {zones.map((z, i) =>
        z > 0 ? <div key={i} style={{ width: `${(z / tot) * 100}%`, background: ZONE_COLORS[i] }} /> : null
      )}
    </div>
  );
}
