// Render naklejki Instagram Story (1080×1920) na canvasie — czysty frontend, bez zależności.
// Z photo: cover-fit + scrim na dole, eksport JPEG 0.92. Bez photo: przezroczysty PNG
// (sama naklejka do nałożenia na story w Instagramie) + cień pod tekstem dla czytelności.
// Wywoływane WYŁĄCZNIE client-side (document/canvas).

export interface StoryRide {
  label: string;
  distanceKm: number;
  elevationM: number;
  movingTimeS: number;
}

export interface RenderStoryOpts {
  photo?: ImageBitmap;
  ride: StoryRide;
}

const W = 1080;
const H = 1920;
const PAD = 72;

// Paleta naklejki (spec share-sticker — celowo własna, nie motyw aplikacji).
const LABEL_COLOR = '#C8D2DA';
const VALUE_COLOR = '#FFFFFF';
const CAPTION_COLOR = '#AEB9C2';
const LOGO_ACCENT = '#00CFFF';
const URL_COLOR = '#6B7680';

const FONT_STACK = '-apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

// ── Formatowanie pl-PL (spacja tysięcy, przecinek dziesiętny) ────────────────────
const nfKm = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Spacja tysięcy ręcznie (NBSP): polskie ICU nie grupuje liczb 4-cyfrowych
// (minimumGroupingDigits=2 → "1250"), a naklejka ma mieć "1 250".
function groupThousands(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
}

export function fmtDistance(km: number): string {
  return `${nfKm.format(km)} km`;
}

export function fmtElevation(m: number): string {
  return `${groupThousands(m)} m`;
}

export function fmtMovingTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${m} min`;
}

// Tekst z letter-spacing: natywne ctx.letterSpacing gdy dostępne (Chrome/nowe Safari),
// fallback = rysowanie znak po znaku (starsze Safari nie zna właściwości).
function drawSpacedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacingPx: number) {
  const anyCtx = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in anyCtx) {
    anyCtx.letterSpacing = `${spacingPx}px`;
    ctx.fillText(text, x, y);
    anyCtx.letterSpacing = '0px';
    return;
  }
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacingPx;
  }
}

// Przytnij tekst z wielokropkiem do maxWidth (nazwy jazd bywają długie).
function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

export async function renderStoryImage(opts: RenderStoryOpts): Promise<Blob> {
  const { photo, ride } = opts;

  // Fonty systemowe muszą być gotowe zanim zmierzymy/narysujemy tekst.
  await document.fonts.ready;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');

  if (photo) {
    // Cover-fit: skaluj do wypełnienia 1080×1920, centruj, przytnij nadmiar.
    const scale = Math.max(W / photo.width, H / photo.height);
    const dw = photo.width * scale;
    const dh = photo.height * scale;
    ctx.drawImage(photo, (W - dw) / 2, (H - dh) / 2, dw, dh);

    // Scrim na dolnych 35% — gradient przezroczysty → ciemny (czytelność naklejki na zdjęciu).
    const scrimTop = H * 0.65;
    const grad = ctx.createLinearGradient(0, scrimTop, 0, H);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.45, 'rgba(0,0,0,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, scrimTop, W, H - scrimTop);
  } else {
    // Przezroczysty PNG: cień pod CAŁYM tekstem, żeby naklejka była czytelna na każdym
    // zdjęciu, na które user nałoży ją w Instagramie.
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 24;
  }

  // ── Naklejka (dolna strefa) ───────────────────────────────────────────────────
  ctx.textBaseline = 'alphabetic';

  // Label jazdy: 40px, letter-spacing 6, uppercase.
  ctx.textAlign = 'left';
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = `400 40px ${FONT_STACK}`;
  const label = truncate(ctx, ride.label.toUpperCase(), W - 2 * PAD);
  drawSpacedText(ctx, label, PAD, 1470, 6);

  // 3 statystyki w rzędzie: dystans (lewo), przewyższenie (środek), czas (prawo).
  const stats: { value: string; caption: string; x: number; align: CanvasTextAlign }[] = [
    { value: fmtDistance(ride.distanceKm), caption: 'dystans', x: PAD, align: 'left' },
    { value: fmtElevation(ride.elevationM), caption: 'przewyższenie', x: W / 2, align: 'center' },
    { value: fmtMovingTime(ride.movingTimeS), caption: 'czas', x: W - PAD, align: 'right' },
  ];
  for (const s of stats) {
    ctx.textAlign = s.align;
    ctx.fillStyle = VALUE_COLOR;
    ctx.font = `600 84px ${FONT_STACK}`;
    ctx.fillText(s.value, s.x, 1610);
    ctx.fillStyle = CAPTION_COLOR;
    ctx.font = `400 34px ${FONT_STACK}`;
    ctx.fillText(s.caption, s.x, 1662);
  }

  // Logo: „VELO" (akcent) + „IQ" (biały), pod spodem adres.
  ctx.textAlign = 'left';
  ctx.font = `600 44px ${FONT_STACK}`;
  ctx.fillStyle = LOGO_ACCENT;
  ctx.fillText('VELO', PAD, 1790);
  const veloW = ctx.measureText('VELO').width;
  ctx.fillStyle = VALUE_COLOR;
  ctx.fillText('IQ', PAD + veloW, 1790);
  ctx.fillStyle = URL_COLOR;
  ctx.font = `400 30px ${FONT_STACK}`;
  ctx.fillText('veloiq.app', PAD, 1836);

  // Z photo → JPEG 0.92 (story pełnoekranowe); bez → PNG z alfą (sama naklejka).
  const type = photo ? 'image/jpeg' : 'image/png';
  const quality = photo ? 0.92 : undefined;
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))), type, quality);
  });
}
