// Raport poranny – SILNIK (czysty, bez I/O). Po nocy WHOOP daje regenerację, HRV, tętno spoczynkowe,
// sen, temperaturę skóry i oddech. Silnik zestawia to z formą (TSB), planem dnia, resztą tygodnia
// i startami, i decyduje, co z dzisiejszym treningiem:
//   keep  – jedziesz wg planu (ewentualnie z jedną wskazówką),
//   trim  – krócej: mniej powtórzeń interwałów / mniej objętości,
//   easy  – lekko (Z1) zamiast planu; kluczowa sesja, jeśli się da, PRZENOSI SIĘ na najbliższy lekki dzień,
//   rest  – odpoczynek (OFF); jak wyżej – klucz przenoszony, jeśli jest gdzie,
//   boost – organizm gotowy na więcej → PROPOZYCJA (+30 min Z2/LONG albo +1 powtórzenie), do zatwierdzenia.
// Odciążenia (trim/easy/rest) zapisują się same z przyciskiem „Przywróć plan”; dokładanie zawsze czeka
// na zgodę. Dni startu, taperu, zablokowane ręcznie, własne treningi zawodnika i dni już przejechane – bez zmian.

import { buildLabel, structureMainMin, isBlocks, isOU, isOwnSession, maxSessionMin, type DayStructure } from '@/lib/structure';
import { warmCool } from '@/lib/workout';
import { taperProtector, type RaceRef } from '@/lib/taper-guard';
import { shiftISO, dayNamePl, userTimeHM } from '@/lib/timezone';
import { fmtSleep, type WhoopDay, type WhoopToday } from '@/lib/whoop-summary';
import type { PlanDay } from '@/lib/ai/plan-generate';

export type MorningVerdict = 'keep' | 'trim' | 'easy' | 'rest' | 'boost' | 'race' | 'off' | 'done' | 'taper' | 'none';
export type ChangeMode = 'auto' | 'proposal';

export interface MorningInput {
  today: string;                      // ISO dnia (strefa zawodnika)
  whoop: WhoopToday;                  // podsumowanie dziś (summarizeWhoop)
  history: WhoopDay[];                // ostatnie ~30 dni (rosnąco), do trendów i norm temp./oddechu
  tsb: number | null;                 // forma z PMC (ostatni wiersz)
  ftp: number | null;
  days: PlanDay[];                    // dni BIEŻĄCEGO tygodnia (pn–nd), z datami
  isDone: (date: string) => boolean;  // czy w tym dniu jest już jazda
  races: Array<RaceRef & { name?: string }>;
  wakeAt?: string | null;             // koniec snu (ISO) – do godziny zaśnięcia przed jutrem
}

export interface MorningSignals {
  level: 'green' | 'yellow' | 'red';
  flags: string[];                    // czytelne powody (PL), w kolejności ważności
  hrvLow: boolean;
  rhrHigh: boolean;
  sleepShort: boolean;
  sleepDebtMin: number | null;        // niedobór snu z 3 nocy (min), >0 = dług
  tsbDeep: boolean;
  redStreak: boolean;                 // wczoraj też czerwono
  illness: boolean;                   // temp. skóry + tętno/oddech wyraźnie ponad normę
  skinTempDelta: number | null;
  respDelta: number | null;
}

export interface MorningResult {
  verdict: MorningVerdict;
  mode: ChangeMode | null;            // null = bez zmiany planu
  signals: MorningSignals;
  headline: string;                   // „Regeneracja 41% · HRV 52 ms (−18%) · sen 6 h 05 min”
  title: string;                      // „Dziś krócej: Threshold 3×15 → 2×15 min”
  reason: string;                     // dlaczego (1–2 zdania)
  tips: string[];                     // krótkie wskazówki (wykonanie, sen przed jutrem)
  before: PlanDay | null;             // dzień dziś przed zmianą
  after: PlanDay | null;              // dzień dziś po zmianie
  moved?: { from: PlanDay; to: PlanDay } | null; // klucz przeniesiony na inny dzień
  days: PlanDay[] | null;             // cały tydzień po zmianie (null = bez zmian)
  push: string;                       // jedno zdanie do powiadomienia
}

const KEY = new Set(['VO2', 'THR', 'OU', 'SST']);
const isKey = (d: PlanDay) => KEY.has(d.type);
const round15 = (m: number) => Math.max(15, Math.round(m / 15) * 15);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sign = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

// Odmiana dnia w „przeniesione na …” (biernik).
const DAY_ACC: Record<string, string> = {
  'poniedziałek': 'poniedziałek', 'wtorek': 'wtorek', 'środa': 'środę', 'czwartek': 'czwartek',
  'piątek': 'piątek', 'sobota': 'sobotę', 'niedziela': 'niedzielę',
};
const dayAcc = (iso: string) => { const n = dayNamePl(iso).toLowerCase(); return DAY_ACC[n] ?? n; };

// ── Sygnały ──────────────────────────────────────────────────────────────────

export function morningSignals(inp: MorningInput): MorningSignals {
  const w = inp.whoop;
  const rec = w.recovery ?? 50;
  const level: MorningSignals['level'] = rec >= 67 ? 'green' : rec >= 34 ? 'yellow' : 'red';
  const past = inp.history.filter((r) => r.date < inp.today && r.date >= shiftISO(inp.today, -30));
  const t = inp.history.find((r) => r.date === inp.today);

  // temperatura skóry i oddech vs norma 30 dni (min. 5 pomiarów)
  const base = (k: 'skin_temp' | 'resp_rate') => {
    const xs = past.map((r) => Number(r[k])).filter((v) => Number.isFinite(v) && v > 0);
    return xs.length >= 5 ? avg(xs) : null;
  };
  const stBase = base('skin_temp'), rrBase = base('resp_rate');
  const skinTempDelta = t?.skin_temp != null && stBase != null ? +(Number(t.skin_temp) - stBase).toFixed(1) : null;
  const respDelta = t?.resp_rate != null && rrBase != null ? +(Number(t.resp_rate) - rrBase).toFixed(1) : null;
  const rhrD = w.rhrDelta ?? 0;
  const illness =
    (skinTempDelta != null && skinTempDelta >= 0.5 && (rhrD >= 4 || (respDelta ?? 0) >= 1)) ||
    ((respDelta ?? 0) >= 1.5 && rhrD >= 5);

  // dług snu z 3 ostatnich nocy (dziś + 2 wcześniejsze): Σ(potrzeba − sen)
  const nights = inp.history.filter((r) => r.date > shiftISO(inp.today, -3) && r.date <= inp.today && r.sleep_min != null && r.sleep_need_min != null);
  const sleepDebtMin = nights.length >= 2 ? Math.round(nights.reduce((a, r) => a + (Number(r.sleep_need_min) - Number(r.sleep_min)), 0)) : null;

  const y = inp.history.find((r) => r.date === shiftISO(inp.today, -1));
  const redStreak = level === 'red' && y?.recovery_score != null && y.recovery_score < 34;
  const tsbDeep = inp.tsb != null && inp.tsb < -25;

  const flags: string[] = [];
  if (illness) flags.push('temperatura skóry i tętno/oddech wyraźnie ponad normę – możliwy początek infekcji');
  if (w.hrvLow) flags.push(`HRV ${Math.abs(w.hrvPct ?? 0)}% poniżej Twojej normy`);
  if (w.rhrHigh) flags.push(`tętno spoczynkowe +${w.rhrDelta} ud./min ponad normę`);
  if (w.sleepShort) flags.push(`krótki sen (${fmtSleep(w.sleepMin)}${w.sleepPerf != null ? `, ${w.sleepPerf}% potrzeby` : ''})`);
  else if (sleepDebtMin != null && sleepDebtMin >= 150) flags.push(`dług snu z ostatnich nocy ok. ${fmtSleep(sleepDebtMin)}`);
  if (redStreak) flags.push('drugi dzień z rzędu czerwona regeneracja');
  if (tsbDeep) flags.push(`skumulowane zmęczenie (TSB ${Math.round(inp.tsb!)})`);

  return {
    level, flags, hrvLow: w.hrvLow, rhrHigh: w.rhrHigh, sleepShort: w.sleepShort || (sleepDebtMin ?? 0) >= 150,
    sleepDebtMin, tsbDeep, redStreak, illness, skinTempDelta, respDelta,
  };
}

export function morningHeadline(w: WhoopToday): string {
  const p: string[] = [];
  if (w.recovery != null) p.push(`Regeneracja ${w.recovery}%`);
  if (w.hrv != null) p.push(`HRV ${w.hrv} ms${w.hrvPct != null ? ` (${sign(w.hrvPct)}%)` : ''}`);
  if (w.rhr != null) p.push(`tętno spocz. ${w.rhr}${w.rhrDelta != null && w.rhrDelta !== 0 ? ` (${sign(w.rhrDelta)})` : ''}`);
  if (w.sleepMin != null) p.push(`sen ${fmtSleep(w.sleepMin)}`);
  return p.join(' · ');
}

// ── Przekształcenia dnia ─────────────────────────────────────────────────────

function wattRange(ftp: number | null, lo: number, hi: number): string {
  return ftp ? `${Math.round((ftp * lo) / 100)}–${Math.round((ftp * hi) / 100)}W` : '–';
}

/** Lekki dzień zamiast planu (Z1 regeneracja). */
export function easyDay(d: PlanDay, minutes: number, ftp: number | null): PlanDay {
  const dur = Math.max(30, round15(minutes));
  return {
    ...d, type: 'Z1' as PlanDay['type'], label: 'Regeneracja aktywna', dur_min: dur,
    tss: Math.round(dur * 0.5), watt: wattRange(ftp, 45, 55), hr: '–', zones: [80, 20, 0, 0, 0], structure: null,
  };
}

export function restDay(d: PlanDay): PlanDay {
  return { ...d, type: 'OFF' as PlanDay['type'], label: 'Odpoczynek', dur_min: 0, tss: 0, watt: '–', hr: '–', zones: [0, 0, 0, 0, 0], structure: null };
}

function relabelDuration(label: string, dur: number): string {
  const txt = dur >= 60 ? `${Math.floor(dur / 60)}h${dur % 60 ? ` ${dur % 60}min` : ''}` : `${dur} min`;
  return label.replace(/\d+(?:[.,]\d+)?\s*h(?:\s*\d+\s*min)?|\b\d{2,3}\s*min\b/i, txt);
}

/** Mniej powtórzeń części głównej (≈ factor), struktura i moc bez zmian. null = nie da się sensownie. */
export function trimIntervals(d: PlanDay, factor = 2 / 3): PlanDay | null {
  const s = d.structure;
  if (!s || isOwnSession(s)) return null;
  let ns: DayStructure;
  if (isBlocks(s)) {
    const idx = s.blocks.reduce((best, b, i) => (b.repeat > s.blocks[best].repeat ? i : best), 0);
    const rep = s.blocks[idx].repeat;
    const nr = Math.max(1, Math.round(rep * factor));
    if (nr >= rep) return null;
    ns = { ...s, blocks: s.blocks.map((b, i) => (i === idx ? { ...b, repeat: nr } : b)) };
  } else if (s.reps >= 2) {
    const nr = Math.max(1, Math.round(s.reps * factor));
    if (nr >= s.reps) return null;
    ns = { ...s, reps: nr };
  } else if (!isOU(s) && s.work_min >= 15) {
    // pojedynczy długi interwał (np. 1×40 min SST) → krótszy
    ns = { ...s, work_min: Math.max(10, Math.round((s.work_min * factor) / 5) * 5) };
  } else return null;
  const { w, c } = warmCool(d as PlanDay & { warmup?: number; cooldown?: number });
  const filler = Math.max(0, d.dur_min - (w + structureMainMin(s) + c)); // Z2 „dopełnienia” – też skracamy
  const dur = w + structureMainMin(ns) + c + Math.round(filler * factor);
  if (dur >= d.dur_min) return null;
  return { ...d, structure: ns, label: buildLabel(d.type, ns), dur_min: dur, tss: Math.max(1, Math.round(d.tss * (dur / Math.max(1, d.dur_min)))) };
}

/** Krótsza jazda objętościowa (Z2/LONG/Z1). Struktura bloków (np. tempo w długiej) zostaje. */
export function trimVolume(d: PlanDay, factor: number): PlanDay | null {
  if (isOwnSession(d.structure)) return null;
  const { w, c } = warmCool(d as PlanDay & { warmup?: number; cooldown?: number });
  const floor = d.structure ? w + structureMainMin(d.structure) + c : 45;
  const dur = Math.max(floor, round15(d.dur_min * factor));
  if (dur >= d.dur_min - 10) return null;
  return { ...d, dur_min: dur, label: relabelDuration(d.label, dur), tss: Math.max(1, Math.round(d.tss * (dur / Math.max(1, d.dur_min)))) };
}

/** Więcej (propozycja): Z2/LONG +30 min, klucz +1 powtórzenie (rozsądny limit). */
export function boostDay(d: PlanDay): PlanDay | null {
  if (isOwnSession(d.structure)) return null;
  if (d.type === 'Z2' || d.type === 'LONG') {
    if (d.structure) return null; // długa z blokami – nie dokładamy na ślepo
    const dur = Math.min(maxSessionMin(d.type), d.dur_min + 30);
    if (dur <= d.dur_min) return null;
    return { ...d, dur_min: dur, label: relabelDuration(d.label, dur), tss: Math.round(d.tss * (dur / Math.max(1, d.dur_min))) };
  }
  if (!isKey(d) || !d.structure) return null;
  const s = d.structure;
  let ns: DayStructure;
  if (isBlocks(s)) {
    const idx = s.blocks.reduce((best, b, i) => (b.repeat > s.blocks[best].repeat ? i : best), 0);
    const rep = s.blocks[idx].repeat;
    if (rep < 2 || rep >= 10) return null;
    ns = { ...s, blocks: s.blocks.map((b, i) => (i === idx ? { ...b, repeat: rep + 1 } : b)) };
  } else {
    const cap = isOU(s) ? 4 : d.type === 'VO2' ? 6 : 4;
    if (s.reps < 2 || s.reps >= cap) return null;
    ns = { ...s, reps: s.reps + 1 };
  }
  const added = structureMainMin(ns) - structureMainMin(s);
  const dur = d.dur_min + added;
  if (dur > maxSessionMin(d.type)) return null;
  return { ...d, structure: ns, label: buildLabel(d.type, ns), dur_min: dur, tss: Math.round(d.tss * (dur / Math.max(1, d.dur_min))) };
}

/** Najbliższy dzień (1–3 dni do przodu, ten sam tydzień), na który można przenieść kluczową sesję. */
function swapTarget(inp: MorningInput, protectedDay: (iso: string) => boolean): PlanDay | null {
  for (let k = 1; k <= 3; k++) {
    const iso = shiftISO(inp.today, k);
    const d = inp.days.find((x) => x.date === iso);
    if (!d) return null; // koniec tygodnia
    if (d.type === 'RACE') return null;
    const ok = (d.type === 'Z1' || d.type === 'Z2') && !d.locked && !inp.isDone(iso) && !protectedDay(iso) && !isOwnSession(d.structure);
    if (!ok) continue;
    const next = inp.days.find((x) => x.date === shiftISO(iso, 1));
    if (next && (isKey(next) || next.type === 'RACE')) continue; // dwa klucze z rzędu / klucz dzień przed startem – nie
    return d;
  }
  return null;
}

function fmtDay(d: PlanDay): string {
  if (d.type === 'OFF') return 'wolne';
  return `${d.label}${d.label.match(/\d+\s*(min|h)/) ? '' : `, ${d.dur_min} min`}`;
}

// Godzina zaśnięcia przed kluczowym jutrem: pobudka − potrzeba snu − 20 min na zaśnięcie.
function bedtimeTip(inp: MorningInput, tomorrow: PlanDay | undefined): string | null {
  if (!tomorrow || !(isKey(tomorrow) || tomorrow.type === 'LONG' || tomorrow.type === 'RACE')) return null;
  const need = inp.whoop.sleepNeedMin;
  const what = tomorrow.type === 'RACE' ? 'start' : tomorrow.label;
  if (!need) return `Jutro ${what} – zadbaj dziś o pełny sen.`;
  let at = '';
  if (inp.wakeAt) {
    const wake = new Date(inp.wakeAt);
    const bed = new Date(wake.getTime() - (need + 20) * 60_000);
    const [h, m] = userTimeHM(bed).split(':').map(Number);
    const q = Math.round((h * 60 + m) / 15) * 15;
    at = ` – połóż się ok. ${String(Math.floor(q / 60) % 24).padStart(2, '0')}:${String(q % 60).padStart(2, '0')}`;
  }
  return `Jutro ${what}: potrzebujesz ok. ${fmtSleep(need)} snu${at}.`;
}

// ── Decyzja ──────────────────────────────────────────────────────────────────

export function decideMorning(inp: MorningInput): MorningResult {
  const sig = morningSignals(inp);
  const w = inp.whoop;
  const rec = w.recovery ?? 50;
  const headline = morningHeadline(w);
  const day = inp.days.find((d) => d.date === inp.today) ?? null;
  const tomorrow = inp.days.find((d) => d.date === shiftISO(inp.today, 1));
  const prot = taperProtector(inp.races);
  const raceSoon = inp.races.some((r) => r.date >= inp.today && r.date <= shiftISO(inp.today, 3));
  const tips: string[] = [];
  const bt = bedtimeTip(inp, tomorrow);
  const why = sig.flags.length ? sig.flags.slice(0, 2).join(', ') : null;

  const base = { signals: sig, headline, tips, before: day, after: null, moved: null, days: null, mode: null } as const;
  const res = (r: Partial<MorningResult> & Pick<MorningResult, 'verdict' | 'title' | 'reason' | 'push'>): MorningResult => {
    if (bt && !tips.includes(bt)) tips.push(bt);
    return { ...base, tips, ...r } as MorningResult;
  };
  const replace = (pairs: Array<[string, PlanDay]>) => inp.days.map((d) => pairs.find(([iso]) => iso === d.date)?.[1] ?? d);
  const mark = (d: PlanDay, verdict: MorningVerdict, from: PlanDay): PlanDay =>
    ({ ...d, morning: { verdict, from: fmtDay(from) } } as PlanDay);

  // ── dni bez decyzji ────────────────────────────────────────────────────────
  if (!day) return res({ verdict: 'none', title: 'Brak planu na dziś', reason: sig.level === 'red' ? 'Regeneracja słaba – jeśli jedziesz, to tylko lekko.' : 'Jeśli jedziesz, słuchaj organizmu.', push: `${headline}. Brak planu na dziś.` });
  if (day.type === 'RACE') {
    const t = sig.level === 'red'
      ? 'Regeneracja słaba – nie panikuj, adrenalina zrobi swoje. Dłuższa, spokojna rozgrzewka, dużo płynów, pierwsza godzina bez szarpania.'
      : sig.level === 'yellow' ? 'Regeneracja średnia – dłuższa rozgrzewka i rozsądny start, mocniej od połowy.' : 'Regeneracja dobra – jesteś gotowy. Plan żywienia i jedziemy.';
    return res({ verdict: 'race', title: 'Dzień startu', reason: t, push: `Dzień startu. ${headline}.` });
  }
  if (inp.isDone(inp.today)) return res({ verdict: 'done', title: 'Dzisiejszy trening już zrobiony', reason: 'Plan dnia bez zmian.', push: `${headline}.` });
  if (day.type === 'OFF') {
    const r = sig.level === 'red' || sig.illness ? 'Dobrze, że dziś wolne – regeneracja tego potrzebuje. Sen, jedzenie, nawodnienie.' : 'Dzień wolny – odpoczynek to też trening.';
    return res({ verdict: 'off', title: 'Dzień wolny', reason: r, push: `${headline}. Dziś wolne.` });
  }
  const frozen = day.locked || isOwnSession(day.structure) || prot(inp.today);
  if (frozen) {
    const t = prot(inp.today) ? 'taper przed startem – plan zostaje' : day.locked ? 'dzień zmieniony ręcznie – nie ruszam go' : 'Twój własny trening – nie ruszam go';
    const adv = sig.illness ? 'Objawy jak przy początku infekcji – rozważ odpuszczenie dzisiejszego treningu.'
      : sig.level === 'red' ? 'Regeneracja słaba – jedź spokojniej, trzymaj dolną część zakresów.'
        : sig.level === 'yellow' && sig.flags.length >= 2 ? 'Regeneracja średnia – nie dokładaj ponad plan.' : 'Jedź zgodnie z planem.';
    return res({ verdict: prot(inp.today) ? 'taper' : 'keep', title: `Dziś: ${fmtDay(day)}`, reason: `${adv} (${t}).`, push: `${headline}. ${adv}` });
  }

  // ── odciążenia (auto) ──────────────────────────────────────────────────────
  const downgrade = (kind: 'rest' | 'easy', reasonTxt: string): MorningResult => {
    const minutes = Math.min(60, Math.max(30, Math.round(day.dur_min * 0.5)));
    const today2 = kind === 'rest' ? restDay(day) : easyDay(day, minutes, inp.ftp);
    const target = isKey(day) || day.type === 'LONG' ? swapTarget(inp, prot) : null;
    const pairs: Array<[string, PlanDay]> = [[inp.today, mark(today2, kind, day)]];
    let moved: MorningResult['moved'] = null;
    if (target) {
      const movedDay = mark({ ...day, dow: target.dow, date: target.date }, kind, target);
      pairs.push([target.date, movedDay]);
      moved = { from: target, to: movedDay };
    }
    const title = kind === 'rest' ? 'Dziś odpoczynek' : `Dziś lekko: ${today2.label}, ${today2.dur_min} min`;
    const mv = moved ? ` ${day.label} przeniesione na ${dayAcc(moved.to.date)} (zamiast: ${fmtDay(moved.from)}).` : '';
    const after = pairs[0][1];
    return res({
      verdict: kind, mode: 'auto', after, moved, days: replace(pairs),
      title, reason: `${reasonTxt}${mv}`,
      push: `${headline}. ${title}.${moved ? ` ${day.label} → ${dayAcc(moved.to.date)}.` : ''}`,
    });
  };

  if (sig.illness) return downgrade('rest', 'Temperatura skóry i tętno/oddech wyraźnie ponad normę – możliwy początek infekcji. Trening dziś bardziej zaszkodzi, niż pomoże.');
  if (sig.level === 'red') {
    if (rec < 20 || (sig.redStreak && (sig.hrvLow || sig.rhrHigh))) {
      return downgrade('rest', `Bardzo słaba regeneracja${why ? ` (${why})` : ''}. Dziś organizm potrzebuje odpoczynku.`);
    }
    if (day.type === 'Z1') return res({ verdict: 'keep', title: `Dziś: ${fmtDay(day)}`, reason: 'Regeneracja słaba, ale w planie i tak lekka jazda – trzymaj ją naprawdę lekko.', push: `${headline}. Lekka jazda wg planu.` });
    return downgrade('easy', `Słaba regeneracja${why ? ` (${why})` : ''}. Mocny bodziec dziś by nie zadziałał – lepiej lekko i wrócić do jakości, gdy organizm odbije.`);
  }

  if (sig.level === 'yellow') {
    const n = sig.flags.length;
    if (n >= 3 && (isKey(day) || day.type === 'LONG')) {
      return downgrade('easy', `Kilka sygnałów zmęczenia naraz (${sig.flags.slice(0, 3).join(', ')}).`);
    }
    const heavy = n >= 2 || rec < 45;
    if (isKey(day) && heavy) {
      const t = trimIntervals(day);
      if (t) {
        const after = mark(t, 'trim', day);
        return res({
          verdict: 'trim', mode: 'auto', after, days: replace([[inp.today, after]]),
          title: `Dziś krócej: ${day.label} → ${t.label}`,
          reason: `Regeneracja średnia${why ? ` (${why})` : ''}. Ta sama moc, mniej powtórzeń – bodziec zostaje, koszt mniejszy.`,
          push: `${headline}. Krócej: ${t.label}.`,
        });
      }
    }
    if ((day.type === 'LONG' && heavy) || (day.type === 'Z2' && n >= 2)) {
      const t = trimVolume(day, day.type === 'LONG' ? 0.75 : 0.8);
      if (t) {
        const after = mark(t, 'trim', day);
        return res({
          verdict: 'trim', mode: 'auto', after, days: replace([[inp.today, after]]),
          title: `Dziś krócej: ${t.dur_min} min zamiast ${day.dur_min}`,
          reason: `Regeneracja średnia${why ? ` (${why})` : ''}. Tlenowa baza i tak zostanie zbudowana, bez dokładania zmęczenia.`,
          push: `${headline}. Krócej: ${t.dur_min} min.`,
        });
      }
    }
    const adv = isKey(day) ? 'Jedź wg planu, ale trzymaj dolną część zakresu i nie dokładaj.' : 'Jedź wg planu, bez dokładania.';
    return res({ verdict: 'keep', title: `Dziś: ${fmtDay(day)}`, reason: `Regeneracja średnia${why ? ` (${why})` : ''}. ${adv}`, push: `${headline}. ${adv}` });
  }

  // ── zielono ────────────────────────────────────────────────────────────────
  const canBoost = rec >= 80 && !w.calibrating && (inp.tsb == null || inp.tsb >= -10) && !w.hrvLow && !sig.sleepShort && !raceSoon && !(tomorrow && isKey(tomorrow) && isKey(day));
  if (canBoost) {
    const b = boostDay(day);
    if (b) {
      const after = mark(b, 'boost', day);
      const what = b.structure && day.structure ? `${day.label} → ${b.label}` : `${b.dur_min} min zamiast ${day.dur_min}`;
      return res({
        verdict: 'boost', mode: 'proposal', after, days: replace([[inp.today, after]]),
        title: `Organizm gotowy na więcej: ${what}?`,
        reason: `Regeneracja ${rec}%, HRV${w.hrvPct != null ? ` ${sign(w.hrvPct)}%` : ''} i świeże nogi. Możesz dołożyć – zatwierdź, jeśli masz czas i ochotę.`,
        push: `${headline}. Gotowy na więcej – propozycja: ${what}.`,
      });
    }
  }
  const adv = isKey(day) ? 'Świetny dzień na jakość – celuj w górną część zakresu.' : 'Jedź zgodnie z planem.';
  return res({ verdict: 'keep', title: `Dziś: ${fmtDay(day)}`, reason: `Regeneracja dobra. ${adv}`, push: `${headline}. ${adv}` });
}
