'use client';

// Pasek rozkładu czasu w strefach mocy (6 stref) pod wykresem. Osobny od ZoneBar.tsx (ten jest
// 5-strefowy dla Planu, inne kolory) — nie mieszamy kontraktów. Liczony z watts wygładzonych 30 s
// (zoneDistribution) → spójny z kolorami mapy. Brak watts/FTP → sekcja znika (zwraca null).
import { C } from '@/lib/theme';
import { zoneDistribution, zonePowerColor, ZONES } from '@/lib/streams-view';
import type { StreamsJson } from '@/lib/strava/streams';

export default function PowerZoneBar({ streams, ftp }: { streams: StreamsJson; ftp: number | null }) {
  const dist = zoneDistribution(streams, ftp);
  const total = dist.reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const pct = dist.map((c) => (c / total) * 100);

  return (
    <div>
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: C.dim }}>
        {ZONES.map((z, i) =>
          pct[i] > 0 ? <div key={z} style={{ width: `${pct[i]}%`, background: zonePowerColor(z) }} /> : null
        )}
      </div>
      <div style={{ display: 'flex', marginTop: 6, gap: 4 }}>
        {ZONES.map((z, i) => (
          <div key={z} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: zonePowerColor(z) }}>{z}</span>
            <span style={{ fontSize: 10, color: C.muted }}>{Math.round(pct[i])}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
