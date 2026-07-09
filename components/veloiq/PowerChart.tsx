'use client';

// Wykres mocy w czasie — czysty SVG (bez bibliotek chartowych; recharts w karcie byłby
// przerostem dla jednej serii). Watts wygładzone 30 s, linia referencyjna FTP, oś czasu.
// Geometria w viewBox + preserveAspectRatio="none" (rozciąga się do szerokości karty),
// dlatego WSZYSTKIE napisy są w HTML obok/na SVG — tekst w SVG by się zdeformował.
import { C } from '@/lib/theme';
import { formatDuration } from '@/lib/format';
import { smoothWatts } from '@/lib/streams-view';
import type { StreamsJson } from '@/lib/strava/streams';

const W = 600;
const H = 160;
const MAX_POINTS = 600; // decymacja: >1 pkt na px szerokości nic nie wnosi, a SVG puchnie

// Ścieżki area (z przerwami na null — pauzy nie są rysowane jako zera).
function buildPaths(vals: (number | null)[], yOf: (w: number) => number): { line: string; area: string } {
  const n = vals.length;
  const step = Math.max(1, Math.ceil(n / MAX_POINTS));
  const xOf = (i: number) => (i / (n - 1)) * W;

  let line = '';
  let area = '';
  let runStart: number | null = null;
  let lastX = 0;

  const closeArea = (fromX: number, toX: number) => {
    area += ` L ${toX.toFixed(1)} ${H} L ${fromX.toFixed(1)} ${H} Z`;
  };

  for (let i = 0; i < n; i += step) {
    const v = vals[i];
    if (v == null) {
      if (runStart != null) closeArea(runStart, lastX);
      runStart = null;
      continue;
    }
    const x = xOf(i);
    const y = yOf(v);
    if (runStart == null) {
      runStart = x;
      line += ` M ${x.toFixed(1)} ${y.toFixed(1)}`;
      area += ` M ${x.toFixed(1)} ${y.toFixed(1)}`;
    } else {
      line += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
      area += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    lastX = x;
  }
  if (runStart != null) closeArea(runStart, lastX);
  return { line: line.trim(), area: area.trim() };
}

export default function PowerChart({ streams, ftp }: { streams: StreamsJson; ftp: number | null }) {
  const smoothed = smoothWatts(streams.series.watts, streams.dt);
  let maxW = 0;
  for (const v of smoothed) if (v != null && v > maxW) maxW = v;
  if (maxW <= 0) return null; // brak mocy — parent i tak nie renderuje (hasWatts)

  // Skala: mieści max wygładzony ORAZ FTP (linia referencyjna nie może uciec poza wykres).
  const yMax = Math.max(maxW, ftp ?? 0) * 1.08;
  const yOf = (w: number) => H - (w / yMax) * H;
  const { line, area } = buildPaths(smoothed, yOf);

  const totalSec = (streams.n - 1) * streams.dt;
  const yFtp = ftp != null && ftp > 0 ? yOf(ftp) : null;

  return (
    <div>
      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: `1px solid ${C.border}`, background: C.card }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: 150 }} aria-hidden="true">
          <path d={area} fill={C.cyan + '26'} stroke="none" />
          <path d={line} fill="none" stroke={C.cyan} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          {yFtp != null && (
            <line x1={0} x2={W} y1={yFtp} y2={yFtp} stroke={C.yellow} strokeWidth={1} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {yFtp != null && (
          <span style={{
            position: 'absolute', right: 6, top: `calc(${(yFtp / H) * 100}% - 16px)`,
            fontSize: 10, fontWeight: 600, color: C.yellow, background: C.card + 'CC',
            padding: '1px 5px', borderRadius: 5, pointerEvents: 'none',
          }}>
            FTP {ftp} W
          </span>
        )}
        <span style={{
          position: 'absolute', left: 6, top: 6, fontSize: 10, fontWeight: 600, color: C.muted,
          background: C.card + 'CC', padding: '1px 5px', borderRadius: 5, pointerEvents: 'none',
        }}>
          max {maxW} W (śr. 30 s)
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: C.muted }}>
        <span>0:00</span>
        <span>{formatDuration(Math.round(totalSec / 2))}</span>
        <span>{formatDuration(totalSec)}</span>
      </div>
    </div>
  );
}
