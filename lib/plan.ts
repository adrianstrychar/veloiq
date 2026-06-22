import { C } from '@/lib/theme';

// Helpery planu treningowego (ETAP 5.2) — kolory stref/typów, formatowanie, daty.

// Kolory stref Z1–Z5 (1:1 z mockupu: Z1 szary, Z2 zielony, Z3 cyan, Z4 żółty, Z5 czerwony)
export const ZONE_COLORS = ['#3A4A5C', C.green, C.cyan, C.yellow, C.red];

// Kolor wg typu treningu (1:1 z mockupu)
const TYPE_COLORS: Record<string, string> = {
  OFF: C.muted, Z1: C.muted, Z2: C.green, SST: C.yellow,
  THR: C.yellow, OU: '#C68A4E', VO2: C.red, LONG: C.cyan,
};
export function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? C.muted;
}

// Minuty → "1h 30m" / "45min" (1:1 z mockupu fmtDur)
export function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  const mm = min % 60;
  return h > 0 ? `${h}h${mm > 0 ? ` ${mm}m` : ''}` : `${mm}min`;
}

// ── Daty (lokalne, niezależne od dow z bazy) ──────────────────────────────────

// Dzisiejsza data w STREFIE LOKALNEJ jako ISO 'YYYY-MM-DD' (nie UTC — unika
// przesunięcia o dzień blisko północy).
export function localTodayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Poniedziałek tygodnia zawierającego datę ISO (liczone w UTC-noon, bezpiecznie).
export function mondayOfISO(iso: string): string {
  const u = new Date(iso + 'T12:00:00Z');
  const dow = u.getUTCDay(); // 0=Nd..6=So
  const diff = dow === 0 ? -6 : 1 - dow;
  u.setUTCDate(u.getUTCDate() + diff);
  return u.toISOString().slice(0, 10);
}

const PL_DOW = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So']; // index = getUTCDay()

// Skrót dnia tygodnia WYPROWADZONY Z DATY (nie z pola dow) — odporne na błędny dow.
export function dowLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return PL_DOW[d.getUTCDay()];
}

// ISO → "22.06"
export function dateLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}`;
}

// weekStart ISO → "22–28.06" (lub "29.06–5.07" gdy różne miesiące)
export function weekRangeLabel(weekStart: string): string {
  const start = new Date(weekStart + 'T12:00:00Z');
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const sD = start.getUTCDate();
  const sM = start.getUTCMonth() + 1;
  const eD = end.getUTCDate();
  const eM = end.getUTCMonth() + 1;
  const mm = (m: number) => String(m).padStart(2, '0');
  return sM === eM
    ? `${sD}–${eD}.${mm(eM)}`
    : `${sD}.${mm(sM)}–${eD}.${mm(eM)}`;
}
