// Klocki skeletonów dla loading.tsx tras (P1-a). Pulsujące bloki w estetyce apki
// (C.card + C.border, animate-pulse Tailwinda) — układ loadera odwzorowuje docelową stronę,
// żeby przejście render→treść nie skakało. Server-safe (zero stanu).
import { C } from '@/lib/theme';

export function SkBlock({ h, w, r = 10, style }: { h: number; w?: number | string; r?: number; style?: React.CSSProperties }) {
  return (
    <div
      className="animate-pulse"
      style={{ height: h, width: w ?? '100%', borderRadius: r, background: C.card, border: `1px solid ${C.border}`, ...style }}
    />
  );
}

export function SkRow({ n, h, gap = 8 }: { n: number; h: number; gap?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: n }, (_, i) => <SkBlock key={i} h={h} />)}
    </div>
  );
}

export function SkGrid({ cols, n, h, gap = 8 }: { cols: number; n: number; h: number; gap?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap }}>
      {Array.from({ length: n }, (_, i) => <SkBlock key={i} h={h} />)}
    </div>
  );
}

export function SkHeader({ title }: { title: string }) {
  return (
    <header className="flex items-center justify-between py-2">
      <span className="text-lg font-bold">{title}</span>
      <SkBlock h={14} w={90} r={7} style={{ border: 'none' }} />
    </header>
  );
}
