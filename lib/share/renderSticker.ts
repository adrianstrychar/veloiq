// Naklejki Instagram (3 warianty) — przezroczyste PNG przycięte CIASNO do treści
// (PAD 56 tylko na cień; w Instagramie naklejka jest obiektem wielkości swojego PNG).
// Render 2× (retina), czysty Canvas 2D (bez serializacji SVG). Wywołanie WYŁĄCZNIE client-side.
//
// Jedno źródło prawdy ringu: pct przychodzi z computeExecutionRing (RideAnalysis),
// status słowem z ringHeadline (lib/execution-ring) — identyczne z kartą, zero
// równoległego matchingu.
import { ringHeadline } from '@/lib/execution-ring';
import { sessionStructure } from '@/lib/workout';
import { isOU } from '@/lib/structure';
import { decodePolyline } from '@/lib/share/decodePolyline';
import type { PlannedWorkout } from '@/lib/ai/insight';

export type StickerVariant = 'plan' | 'stats' | 'trasa';

export interface StickerRide {
  distanceKm: number;
  elevationM: number;
  movingTimeS: number;
  polyline?: string | null;   // map.summary_polyline ze Stravy (wariant 'trasa')
}

export interface StickerPlanData {
  label: string;              // nazwa treningu (np. "Threshold 3×15min")
  pct: number;                // completion% z computeExecutionRing — TO SAMO źródło co karta
  planned: PlannedWorkout;    // struktura dnia → profil interwałów
  recovery?: { pass: boolean; reason: string }; // dzień regeneracyjny (Z1): kolor ringu binarny (pass/fail)
}

export interface StickerData {
  ride: StickerRide;
  plan?: StickerPlanData | null;
}

// ── Stałe wspólne ────────────────────────────────────────────────────────────────
const S = 2;                   // retina 2×
const PAD = 56;                // margines na cień — jedyny "pusty" obszar PNG

const ACCENT = '#00CFFF';      // słupki/ślad/plan + "IQ" w logo
const RING_GREEN = '#00E87A';  // ring wykonania + status
const RING_RED = '#d64f4f';    // FAIL dnia regeneracyjnego (Z1) — ta sama czerwień co karta (toneFor)
const NONWORK = '#828C95';     // warmup/rest/cooldown
const WHITE = '#FFFFFF';
const CAPTION = '#AEB9C2';

// ── Formatowanie pl-PL ──────────────────────────────────────────────────────────
const nfKm = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Twarda spacja tysięcy ręcznie: polskie ICU nie grupuje 4 cyfr ("2140" zamiast "2 140").
function groupThousands(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
}

export function fmtDistance(km: number): string {
  return `${nfKm.format(km)} km`;
}
export function fmtElevation(m: number): string {
  return `${groupThousands(m)} m`;
}
export function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

// ── Profil interwałów: segmenty z planu (warmup, N×(work, rest), cooldown) ───────
interface ProfileSeg { min: number; rel: number; work: boolean }
const NONWORK_REL = 0.42; // wysokość segmentów nieroboczych względem max mocy

export function buildProfileSegments(p: PlannedWorkout): ProfileSeg[] {
  const s = p.structure;
  // Steady (Z1/Z2/LONG lub brak struktury): jeden szeroki słupek.
  if (!s) return [{ min: Math.max(1, p.dur_min || 60), rel: 1, work: true }];

  const ss = sessionStructure(p.type);
  const wUsed = p.warmup ?? ss.warmupDefault;
  const cUsed = p.cooldown ?? ss.cooldownDefault;
  const segs: ProfileSeg[] = [];
  if (wUsed > 0) segs.push({ min: wUsed, rel: NONWORK_REL, work: false });

  if (isOU(s)) {
    // OU: blok = cycles × (under + over); wysokość ∝ moc/over_w.
    for (let r = 0; r < s.reps; r++) {
      for (let cyc = 0; cyc < s.cycles; cyc++) {
        segs.push({ min: s.under_min, rel: s.under_w / s.over_w, work: true });
        segs.push({ min: s.over_min, rel: 1, work: true });
      }
      if (r < s.reps - 1) segs.push({ min: s.rest_min, rel: NONWORK_REL, work: false });
    }
  } else {
    for (let r = 0; r < s.reps; r++) {
      segs.push({ min: s.work_min, rel: 1, work: true });
      if (r < s.reps - 1) segs.push({ min: s.rest_min, rel: NONWORK_REL, work: false });
    }
  }
  if (cUsed > 0) segs.push({ min: cUsed, rel: NONWORK_REL, work: false });
  return segs;
}

// ── Helpery rysowania ────────────────────────────────────────────────────────────
function realFontFamily(): string {
  // Realna rodzina z computed style (NIE var(--font-*)) — canvas nie rozwiązuje zmiennych CSS.
  const fam = typeof document !== 'undefined' ? getComputedStyle(document.body).fontFamily : '';
  return fam || '-apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Tekst z letter-spacing (fallback znak-po-znaku dla starszych Safari). Zwraca szerokość.
function measureSpaced(ctx: CanvasRenderingContext2D, text: string, spacing: number): number {
  return ctx.measureText(text).width + spacing * Math.max(0, text.length - 1);
}
function drawSpaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
  const anyCtx = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in anyCtx) {
    anyCtx.letterSpacing = `${spacing}px`;
    ctx.fillText(text, x, y);
    anyCtx.letterSpacing = '0px';
    return;
  }
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}

// Logo „VELO"(biały) + „IQ"(cyjan). textAlign musi być 'left'. Zwraca szerokość całości.
function drawLogo(ctx: CanvasRenderingContext2D, fam: string, x: number, y: number, sizePx: number): number {
  ctx.font = `700 ${sizePx}px ${fam}`;
  ctx.textAlign = 'left';
  const veloW = ctx.measureText('VELO').width;
  const iqW = ctx.measureText('IQ').width;
  ctx.fillStyle = WHITE;
  ctx.fillText('VELO', x, y);
  ctx.fillStyle = ACCENT;
  ctx.fillText('IQ', x + veloW, y);
  return veloW + iqW;
}
function logoWidth(ctx: CanvasRenderingContext2D, fam: string, sizePx: number): number {
  ctx.font = `700 ${sizePx}px ${fam}`;
  return ctx.measureText('VELOIQ').width;
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

// Kanwas 2× z globalnym cieniem na KAŻDYM elemencie i baseline='top'.
function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * S);
  canvas.height = Math.round(h * S);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.scale(S, S);
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 24 * S; // shadowBlur ignoruje transformację — skalujemy ręcznie
  return { canvas, ctx };
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))), 'image/png')
  );
}

// ── Wariant 'plan': ring (lewo) + nazwa/profil/dane/logo (prawo) ────────────────
const RING_D = 400;
const COL_GAP = 56;
const COL_W = 830;
const NAME_PX = 56;   const NAME_H = 64;
const GAP_NAME_STRIP = 24;
const STRIP_H = 120;
const GAP_STRIP_DATA = 28;
// Rząd danych DYSTANS/CZAS: podpis 30px ls3 → gap 10 → wartość 52px w600; kol. 2 na +300.
const DATA_CAP_PX = 30; const DATA_CAP_LS = 3; const DATA_CAP_H = 36;
const GAP_DATACAP_VAL = 10;
const DATA_VAL_PX = 52; const DATA_VAL_H = 60;
const DATA_COL2_X = 300;
const GAP_DATA_LOGO = 28;
const LOGO_PLAN_PX = 58; const LOGO_PLAN_H = 66;

function renderPlan(data: StickerData, fam: string): HTMLCanvasElement {
  const plan = data.plan;
  if (!plan) throw new Error('renderSticker(plan) bez danych planu');
  // Kolumna urosła o rząd danych — jest wyższa niż ring; treść = max z obu, ring i kolumna
  // wyśrodkowane wzajemnie w tej wysokości. Ciasne przycięcie bez zmian (PAD tylko na cień).
  const colH = NAME_H + GAP_NAME_STRIP + STRIP_H + GAP_STRIP_DATA
    + DATA_CAP_H + GAP_DATACAP_VAL + DATA_VAL_H + GAP_DATA_LOGO + LOGO_PLAN_H;
  const contentH = Math.max(RING_D, colH);
  const W = PAD + RING_D + COL_GAP + COL_W + PAD;   // 1398
  const H = PAD + contentH + PAD;
  const { canvas, ctx } = makeCanvas(W, H);

  // Ring: tor + progress od -90°, kąt = completion%.
  const cx = PAD + RING_D / 2;
  const cy = PAD + contentH / 2;
  const r = (RING_D - 40) / 2; // promień osi toru (lw 40 mieści się w RING_D)
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 40;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  // Dzień regeneracyjny (recovery obecne): kolor BINARNY — zielony natywny stickera (pass) /
  // czerwień karty (fail). Inne typy (recovery undefined) → RING_GREEN jak dotąd, bez zmian.
  const ringColor = plan.recovery ? (plan.recovery.pass ? RING_GREEN : RING_RED) : RING_GREEN;
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 34;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.min(100, plan.pct)) / 100);
  ctx.stroke();

  // Środek ringu: "96%" + status (blok ~140 wyśrodkowany pionowo).
  ctx.textAlign = 'center';
  ctx.fillStyle = WHITE;
  ctx.font = `600 88px ${fam}`;
  ctx.fillText(`${Math.round(plan.pct)}%`, cx, cy - 70);
  // Status: recovery → 'Idealnie' (pass) / 'Poniżej celu' (fail; pełny powód zostaje na karcie —
  // długie powody Z3/Z4+ nie mieszczą się w środku ringu). Inne typy → ringHeadline(pct), bez zmian.
  const status = plan.recovery ? (plan.recovery.pass ? 'Idealnie' : 'Poniżej celu') : ringHeadline(plan.pct);
  ctx.fillStyle = ringColor;
  ctx.font = `400 34px ${fam}`;
  ctx.fillText(status, cx, cy + 34);

  // Kolumna prawa — wyśrodkowana pionowo względem ringu (wspólna oś w contentH).
  const colX = PAD + RING_D + COL_GAP;
  let y = PAD + (contentH - colH) / 2;

  ctx.textAlign = 'left';
  ctx.fillStyle = WHITE;
  ctx.font = `600 ${NAME_PX}px ${fam}`;
  ctx.fillText(truncate(ctx, plan.label, COL_W), colX, y);
  y += NAME_H + GAP_NAME_STRIP;

  // Profil interwałów: szer ∝ czas, wys ∝ moc/max, work=cyan, reszta=szary, rx 8, gap 8, min 20.
  const segs = buildProfileSegments(plan.planned);
  const GAP_BAR = 8;
  const MIN_BAR = 20;
  const innerW = COL_W - GAP_BAR * (segs.length - 1);
  const totalMin = segs.reduce((a, s) => a + s.min, 0);
  let widths = segs.map((s) => Math.max(MIN_BAR, (innerW * s.min) / totalMin));
  const overflow = widths.reduce((a, b) => a + b, 0) - innerW;
  if (overflow > 0) {
    // Przeskaluj w dół tylko słupki powyżej minimum (min 20 nietykalne).
    const scalable = widths.filter((w) => w > MIN_BAR).reduce((a, b) => a + b, 0);
    widths = widths.map((w) => (w > MIN_BAR ? Math.max(MIN_BAR, w - (overflow * w) / scalable) : w));
  }
  let bx = colX;
  for (let i = 0; i < segs.length; i++) {
    const bh = Math.max(10, STRIP_H * segs[i].rel);
    ctx.fillStyle = segs[i].work ? ACCENT : NONWORK;
    roundRect(ctx, bx, y + STRIP_H - bh, widths[i], bh, 8);
    ctx.fill();
    bx += widths[i] + GAP_BAR;
  }
  y += STRIP_H + GAP_STRIP_DATA;

  // Rząd danych DYSTANS/CZAS — wspólna lewa krawędź z nazwą/profilem/logo, kol. 2 na +300.
  const dataCols = [
    { cap: 'DYSTANS', val: fmtDistance(data.ride.distanceKm), x: colX },
    { cap: 'CZAS', val: fmtTime(data.ride.movingTimeS), x: colX + DATA_COL2_X },
  ];
  for (const c of dataCols) {
    ctx.textAlign = 'left';
    ctx.fillStyle = CAPTION;
    ctx.font = `400 ${DATA_CAP_PX}px ${fam}`;
    drawSpaced(ctx, c.cap, c.x, y, DATA_CAP_LS);
    ctx.fillStyle = WHITE;
    ctx.font = `600 ${DATA_VAL_PX}px ${fam}`;
    ctx.fillText(c.val, c.x, y + DATA_CAP_H + GAP_DATACAP_VAL);
  }
  y += DATA_CAP_H + GAP_DATACAP_VAL + DATA_VAL_H + GAP_DATA_LOGO;

  drawLogo(ctx, fam, colX, y, LOGO_PLAN_PX);
  return canvas;
}

// ── Wariant 'stats': 3 kolumny + logo ────────────────────────────────────────────
const STAT_CAP_PX = 34; const STAT_CAP_SPACING = 3; const STAT_CAP_H = 42;
const GAP_CAP_VAL = 10;
const STAT_VAL_PX = 78; const STAT_VAL_H = 88;
const STAT_COL_GAP = 72;
const GAP_STATS_LOGO = 28;
const LOGO_STATS_PX = 56; const LOGO_STATS_H = 64;

function renderStats(data: StickerData, fam: string): HTMLCanvasElement {
  const cols = [
    { cap: 'DYSTANS', val: fmtDistance(data.ride.distanceKm) },
    { cap: 'PRZEWYŻSZENIE', val: fmtElevation(data.ride.elevationM) },
    { cap: 'CZAS', val: fmtTime(data.ride.movingTimeS) },
  ];

  // Faza pomiaru (offscreen) → ciasna szerokość kanwasu.
  const meas = document.createElement('canvas').getContext('2d')!;
  meas.font = `400 ${STAT_CAP_PX}px ${fam}`;
  const capWs = cols.map((c) => measureSpaced(meas, c.cap, STAT_CAP_SPACING));
  meas.font = `600 ${STAT_VAL_PX}px ${fam}`;
  const valWs = cols.map((c) => meas.measureText(c.val).width);
  const colWs = cols.map((_, i) => Math.max(capWs[i], valWs[i]));

  const contentW = colWs.reduce((a, b) => a + b, 0) + STAT_COL_GAP * 2;
  const contentH = STAT_CAP_H + GAP_CAP_VAL + STAT_VAL_H + GAP_STATS_LOGO + LOGO_STATS_H;
  const W = PAD + contentW + PAD;
  const H = PAD + contentH + PAD;
  const { canvas, ctx } = makeCanvas(W, H);

  let x = PAD;
  const yCap = PAD;
  const yVal = PAD + STAT_CAP_H + GAP_CAP_VAL;
  for (let i = 0; i < cols.length; i++) {
    const cxCol = x + colWs[i] / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = CAPTION;
    ctx.font = `400 ${STAT_CAP_PX}px ${fam}`;
    drawSpaced(ctx, cols[i].cap, cxCol - capWs[i] / 2, yCap, STAT_CAP_SPACING);
    ctx.textAlign = 'center';
    ctx.fillStyle = WHITE;
    ctx.font = `600 ${STAT_VAL_PX}px ${fam}`;
    ctx.fillText(cols[i].val, cxCol, yVal);
    x += colWs[i] + STAT_COL_GAP;
  }

  const lw = logoWidth(ctx, fam, LOGO_STATS_PX);
  drawLogo(ctx, fam, W / 2 - lw / 2, PAD + STAT_CAP_H + GAP_CAP_VAL + STAT_VAL_H + GAP_STATS_LOGO, LOGO_STATS_PX);
  return canvas;
}

// ── Wariant 'trasa': ślad GPS + rząd statystyk + logo ────────────────────────────
const TRACK_MAX_W = 880; const TRACK_MAX_H = 720;
const GAP_TRACK_STATS = 40;
const TR_CAP_PX = 30; const TR_CAP_H = 36;
const TR_GAP_CAP_VAL = 8;
const TR_VAL_PX = 60; const TR_VAL_H = 68;
const GAP_TRSTATS_LOGO = 32;
const LOGO_TRACK_PX = 58; const LOGO_TRACK_H = 66;
const MAX_TRACK_POINTS = 1500;

function renderTrack(data: StickerData, fam: string): HTMLCanvasElement {
  const encoded = data.ride.polyline;
  if (!encoded) throw new Error('renderSticker(trasa) bez polyline');
  let pts = decodePolyline(encoded);
  if (pts.length < 2) throw new Error('polyline pusta');
  if (pts.length > MAX_TRACK_POINTS) {
    const step = Math.ceil(pts.length / MAX_TRACK_POINTS);
    pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  }

  // Projekcja: KOREKTA lng o cos(śr. szerokości) — bez niej trasa spłaszczona ~35% na PL.
  const lats = pts.map((p) => p[0]);
  const lngs = pts.map((p) => p[1]);
  const midLat = ((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180);
  const cosLat = Math.cos(midLat);
  const xs = pts.map((p) => p[1] * cosLat);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  const spanX = Math.max(1e-9, maxX - minX);
  const spanY = Math.max(1e-9, maxLat - minLat);
  const scale = Math.min(TRACK_MAX_W / spanX, TRACK_MAX_H / spanY);
  const trackW = spanX * scale;
  const trackH = spanY * scale;

  const contentW = TRACK_MAX_W;
  const statsBlockH = TR_CAP_H + TR_GAP_CAP_VAL + TR_VAL_H;
  const W = PAD + contentW + PAD;
  const H = PAD + trackH + GAP_TRACK_STATS + statsBlockH + GAP_TRSTATS_LOGO + LOGO_TRACK_H + PAD;
  const { canvas, ctx } = makeCanvas(W, H);

  // Ślad — wyśrodkowany poziomo w polu 880.
  const ox = PAD + (contentW - trackW) / 2;
  const oy = PAD;
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const px = ox + (xs[i] - minX) * scale;
    const py = oy + (maxLat - pts[i][0]) * scale; // oś Y canvasa w dół
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Rząd statystyk na x = 25% / 50% / 75%.
  const yCap = oy + trackH + GAP_TRACK_STATS;
  const yVal = yCap + TR_CAP_H + TR_GAP_CAP_VAL;
  const cols = [
    { cap: 'DYSTANS', val: fmtDistance(data.ride.distanceKm), x: W * 0.25 },
    { cap: 'PRZEWYŻSZENIE', val: fmtElevation(data.ride.elevationM), x: W * 0.5 },
    { cap: 'CZAS', val: fmtTime(data.ride.movingTimeS), x: W * 0.75 },
  ];
  for (const c of cols) {
    ctx.textAlign = 'center';
    ctx.fillStyle = CAPTION;
    ctx.font = `400 ${TR_CAP_PX}px ${fam}`;
    ctx.fillText(c.cap, c.x, yCap);
    ctx.fillStyle = WHITE;
    ctx.font = `600 ${TR_VAL_PX}px ${fam}`;
    ctx.fillText(c.val, c.x, yVal);
  }

  const lw = logoWidth(ctx, fam, LOGO_TRACK_PX);
  drawLogo(ctx, fam, W / 2 - lw / 2, yVal + TR_VAL_H + GAP_TRSTATS_LOGO, LOGO_TRACK_PX);
  return canvas;
}

// ── API ──────────────────────────────────────────────────────────────────────────
export async function renderSticker(variant: StickerVariant, data: StickerData): Promise<Blob> {
  await document.fonts.ready;
  const fam = realFontFamily();
  const canvas =
    variant === 'plan' ? renderPlan(data, fam)
    : variant === 'trasa' ? renderTrack(data, fam)
    : renderStats(data, fam);
  return toBlob(canvas);
}
