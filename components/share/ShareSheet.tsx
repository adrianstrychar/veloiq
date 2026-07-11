'use client';

// Bottom sheet udostępniania story (Instagram sticker, wariant A). Czysty frontend:
// render 1080×1920 na canvasie (lib/share/renderStoryImage), share przez Web Share API
// z fallbackiem do pobrania (lib/share/shareImage). Wzorzec overlaya jak karty w appce
// (fixed inset + stopPropagation), ale zakotwiczony do dołu (mobile-first, safe-area).
import { useEffect, useRef, useState } from 'react';
import { renderStoryImage, type StoryRide } from '@/lib/share/renderStoryImage';
import { shareImage } from '@/lib/share/shareImage';

// Paleta arkusza wg spec (celowo nie motyw aplikacji).
const S = {
  bg: '#06080A',
  card: '#10141A',
  border: '#1E242C',
  accent: '#00CFFF',
  text: '#EDEFF2',
  muted: '#8B96A0',
};

const PREVIEW_W = 270;
const PREVIEW_H = 480;

interface ShareSheetProps {
  ride: StoryRide;
  onClose: () => void;
}

export default function ShareSheet({ ride, onClose }: ShareSheetProps) {
  const [photo, setPhoto] = useState<ImageBitmap | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);   // cache renderu dla bieżącego zdjęcia
  const [rendering, setRendering] = useState(true);
  const [sharing, setSharing] = useState<null | 'story' | 'sticker'>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  // Live compositing podglądu: render pełnego 1080×1920 → przeskalowanie do ~270×480.
  // Duże zdjęcie z telefonu może mielić ~1 s — stąd stan loading zamiast zamrożonego UI.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRendering(true);
      try {
        const b = await renderStoryImage({ photo: photo ?? undefined, ride });
        if (cancelled) return;
        setBlob(b);
        const bmp = await createImageBitmap(b);
        if (cancelled) { bmp.close(); return; }
        const cv = previewRef.current;
        const ctx = cv?.getContext('2d');
        if (cv && ctx) {
          ctx.clearRect(0, 0, cv.width, cv.height); // clear zamiast fill — alfa PNG widoczna na szachownicy
          ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
        }
        bmp.close();
      } catch {
        if (!cancelled) setBlob(null);
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => { cancelled = true; };
  }, [photo, ride]);

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      // imageOrientation: zdjęcia z telefonu mają EXIF rotation; starsze Safari nie zna opcji → fallback.
      let bmp: ImageBitmap;
      try {
        bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch {
        bmp = await createImageBitmap(file);
      }
      photo?.close();
      setPhoto(bmp);
    } catch {
      // nieczytelny plik — zostajemy przy obecnym stanie
    }
  }

  async function doShare(kind: 'story' | 'sticker') {
    if (sharing) return;
    setSharing(kind);
    try {
      if (kind === 'story' && blob) {
        await shareImage(blob, photo ? 'veloiq-story.jpg' : 'veloiq-story.png');
      } else if (kind === 'sticker') {
        // Sama naklejka: ZAWSZE przezroczysty PNG (render bez zdjęcia), niezależnie od pickera.
        const png = await renderStoryImage({ ride });
        await shareImage(png, 'veloiq-sticker.png');
      }
    } finally {
      setSharing(null);
    }
  }

  const btnBase: React.CSSProperties = {
    width: '100%', border: 'none', borderRadius: 12, padding: '15px',
    fontSize: 16, fontWeight: 600, cursor: 'pointer', minHeight: 52,
  };

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
          <span style={{ fontSize: 16, fontWeight: 700, color: S.text }}>Udostępnij story</span>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, width: 32, height: 32, color: S.muted, fontSize: 18, lineHeight: 1, cursor: 'pointer' }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
          {/* Podgląd na szachownicy — przezroczystość PNG jest WIDOCZNA (kryterium akceptacji) */}
          <div
            style={{
              width: PREVIEW_W / 2, height: PREVIEW_H / 2, flexShrink: 0,
              borderRadius: 10, border: `1px solid ${S.border}`, overflow: 'hidden', position: 'relative',
              background: 'repeating-conic-gradient(#14181E 0% 25%, #0B0E12 0% 50%) 0 0 / 20px 20px',
            }}
          >
            <canvas ref={previewRef} width={PREVIEW_W} height={PREVIEW_H} style={{ width: '100%', height: '100%', display: 'block' }} />
            {rendering && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(6,8,10,0.55)', color: S.muted, fontSize: 16 }}>
                Renderuję…
              </div>
            )}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
            <label
              style={{
                ...btnBase, background: S.card, color: S.text, border: `1px solid ${S.border}`,
                textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {photo ? 'Zmień zdjęcie' : 'Dodaj zdjęcie z jazdy'}
              <input type="file" accept="image/*" onChange={onPickPhoto} style={{ display: 'none' }} />
            </label>
            <div style={{ fontSize: 16, color: S.muted, lineHeight: 1.45 }}>
              {photo
                ? 'Story ze zdjęciem i statystykami jazdy.'
                : 'Bez zdjęcia zapisze się przezroczysta naklejka — nałożysz ją na własne story.'}
            </div>
          </div>
        </div>

        <button
          onClick={() => void doShare('story')}
          disabled={rendering || sharing != null || !blob}
          style={{
            ...btnBase, background: S.accent, color: '#04212B',
            opacity: rendering || sharing != null || !blob ? 0.55 : 1,
          }}
        >
          {sharing === 'story' ? 'Przygotowuję…' : 'Udostępnij story'}
        </button>
        <button
          onClick={() => void doShare('sticker')}
          disabled={sharing != null}
          style={{
            ...btnBase, background: 'transparent', color: S.accent, border: `1px solid ${S.accent}55`,
            opacity: sharing != null ? 0.55 : 1,
          }}
        >
          {sharing === 'sticker' ? 'Przygotowuję…' : 'Zapisz samą naklejkę (PNG)'}
        </button>
      </div>
    </div>
  );
}
