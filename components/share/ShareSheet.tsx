'use client';

// Bottom sheet naklejek Instagram (3 warianty: plan/stats/trasa). Miniatury renderowane
// TĄ SAMĄ renderSticker co finalny plik (drawImage do małego canvasa) — na szachownicy,
// żeby alfa PNG była widoczna. Jeden CTA „Zapisz naklejkę" → cache'owany blob 2× →
// istniejące shareImage() (bez zmian).
import { useEffect, useMemo, useRef, useState } from 'react';
import { renderSticker, type StickerData, type StickerVariant } from '@/lib/share/renderSticker';
import { shareImage } from '@/lib/share/shareImage';

const S = {
  bg: '#06080A',
  card: '#10141A',
  border: '#1E242C',
  accent: '#00CFFF',
  text: '#EDEFF2',
  muted: '#8B96A0',
};

const THUMB_BOX = { w: 150, h: 150 }; // różne proporcje wariantów → fit z zachowaniem aspect ratio

const VARIANT_LABEL: Record<StickerVariant, string> = {
  plan: 'Plan',
  stats: 'Statystyki',
  trasa: 'Trasa',
};

interface Thumb {
  variant: StickerVariant;
  blob: Blob;
  bmp: ImageBitmap;
  w: number;  // rozmiar canvasa miniatury po fit
  h: number;
}

export default function ShareSheet({ data, onClose }: { data: StickerData; onClose: () => void }) {
  // Dostępność: 'plan' gdy dzień miał plan (jest ring), 'trasa' gdy summary_polyline,
  // 'stats' zawsze. Niedostępne UKRYTE. Domyślny wybór: plan > trasa > stats.
  const variants = useMemo<StickerVariant[]>(() => {
    const out: StickerVariant[] = [];
    if (data.plan) out.push('plan');
    if (data.ride.polyline) out.push('trasa');
    out.push('stats');
    return out;
  }, [data]);

  const [selected, setSelected] = useState<StickerVariant>(variants[0]);
  const [thumbs, setThumbs] = useState<Thumb[] | null>(null);
  const [saving, setSaving] = useState(false);
  const canvasRefs = useRef<Partial<Record<StickerVariant, HTMLCanvasElement | null>>>({});

  // Render wszystkich dostępnych wariantów raz (pełne 2× — ten sam blob idzie potem do share).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Thumb[] = [];
      for (const v of variants) {
        try {
          const blob = await renderSticker(v, data);
          const bmp = await createImageBitmap(blob);
          const fit = Math.min(THUMB_BOX.w / bmp.width, THUMB_BOX.h / bmp.height);
          out.push({ variant: v, blob, bmp, w: Math.round(bmp.width * fit), h: Math.round(bmp.height * fit) });
        } catch {
          // wariant nie wyrenderował się (np. uszkodzona polyline) → po prostu go nie pokazujemy
        }
      }
      if (cancelled) { out.forEach((t) => t.bmp.close()); return; }
      setThumbs(out);
      if (out.length && !out.some((t) => t.variant === selected)) setSelected(out[0].variant);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants, data]);

  // drawImage bitmap → mały canvas miniatury (po tym, jak canvasy są w DOM).
  useEffect(() => {
    if (!thumbs) return;
    for (const t of thumbs) {
      const cv = canvasRefs.current[t.variant];
      const ctx = cv?.getContext('2d');
      if (cv && ctx) {
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(t.bmp, 0, 0, cv.width, cv.height);
      }
    }
  }, [thumbs]);

  async function save() {
    const t = thumbs?.find((x) => x.variant === selected);
    if (!t || saving) return;
    setSaving(true);
    try {
      await shareImage(t.blob, `veloiq-${t.variant}.png`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560, margin: '0 auto',
          background: S.bg, borderTop: `1px solid ${S.border}`,
          borderRadius: '16px 16px 0 0', padding: '16px 16px 0',
          paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: S.text }}>Naklejka na story</span>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, width: 32, height: 32, color: S.muted, fontSize: 18, lineHeight: 1, cursor: 'pointer' }}
          >
            ×
          </button>
        </div>

        {/* Miniatury na szachownicy (alfa widoczna); wybrana z obrysem akcentu */}
        {!thumbs ? (
          <div style={{ fontSize: 16, color: S.muted, textAlign: 'center', padding: '28px 0' }}>Renderuję naklejki…</div>
        ) : (
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            {thumbs.map((t) => {
              const active = t.variant === selected;
              return (
                <button
                  key={t.variant}
                  onClick={() => setSelected(t.variant)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                  }}
                >
                  <span
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: THUMB_BOX.w + 12, height: THUMB_BOX.h + 12, borderRadius: 10,
                      border: active ? `2px solid ${S.accent}` : `1px solid ${S.border}`,
                      background: 'repeating-conic-gradient(#14181E 0% 25%, #0B0E12 0% 50%) 0 0 / 16px 16px',
                    }}
                  >
                    <canvas
                      ref={(el) => { canvasRefs.current[t.variant] = el; }}
                      width={t.w}
                      height={t.h}
                      style={{ width: t.w, height: t.h, display: 'block' }}
                    />
                  </span>
                  <span style={{ fontSize: 16, fontWeight: active ? 700 : 400, color: active ? S.accent : S.muted }}>
                    {VARIANT_LABEL[t.variant]}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <button
          onClick={() => void save()}
          disabled={!thumbs || saving}
          style={{
            width: '100%', border: 'none', borderRadius: 12, padding: '15px', minHeight: 52,
            fontSize: 16, fontWeight: 600, cursor: 'pointer',
            background: S.accent, color: '#04212B',
            opacity: !thumbs || saving ? 0.55 : 1,
          }}
        >
          {saving ? 'Przygotowuję…' : 'Zapisz naklejkę'}
        </button>
      </div>
    </div>
  );
}
