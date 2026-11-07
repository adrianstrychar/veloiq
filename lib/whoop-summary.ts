// Podsumowanie danych WHOOP na dziś: regeneracja, HRV i tętno spoczynkowe względem Twojej normy
// (średnia z 30 dni), sen vs potrzeba snu, obciążenie wczoraj. Używane przez pulpit (gotowość + karta),
// czat AI, AI Insight i odprawę Enzo na rozgrzewce. Czyste funkcje + jeden loader.

import type { SupabaseClient } from '@supabase/supabase-js';
import { shiftISO } from '@/lib/timezone';

export interface WhoopDay {
  date: string;
  recovery_score: number | null;
  hrv_ms: number | null;
  rhr: number | null;
  spo2: number | null;
  skin_temp: number | null;
  calibrating: boolean | null;
  sleep_performance: number | null;
  sleep_min: number | null;
  sleep_need_min: number | null;
  deep_min: number | null;
  rem_min: number | null;
  light_min: number | null;
  awake_min: number | null;
  resp_rate: number | null;
  day_strain: number | null;
  workouts: { sport: string; min: number; strain: number | null }[] | null;
}

export type WhoopLevel = 'green' | 'yellow' | 'red';

export interface WhoopToday {
  date: string;
  recovery: number | null;
  level: WhoopLevel | null;
  calibrating: boolean;
  hrv: number | null;
  hrvBase: number | null;
  hrvPct: number | null;      // HRV dziś vs norma, %
  rhr: number | null;
  rhrBase: number | null;
  rhrDelta: number | null;    // RHR dziś − norma (bpm)
  sleepMin: number | null;
  sleepNeedMin: number | null;
  sleepPerf: number | null;
  deepMin: number | null;
  remMin: number | null;
  strainYesterday: number | null;
  hrvLow: boolean;
  rhrHigh: boolean;
  sleepShort: boolean;
}

export interface WhoopState {
  connected: boolean;
  needsReauth: boolean;
  lastSyncAt: string | null;
  today: WhoopToday | null;
  history: WhoopDay[];         // rosnąco po dacie (do 30 dni)
}

export const WHOOP_COLS = 'date, recovery_score, hrv_ms, rhr, spo2, skin_temp, calibrating, sleep_performance, sleep_min, sleep_need_min, deep_min, rem_min, light_min, awake_min, resp_rate, day_strain, workouts';

export function whoopLevel(rec: number | null | undefined): WhoopLevel | null {
  if (rec == null) return null;
  return rec >= 67 ? 'green' : rec >= 34 ? 'yellow' : 'red';
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Dziś = wiersz z dzisiejszą datą (regeneracja po nocy). Brak → null (np. przed pobudką / brak synchronizacji). */
export function summarizeWhoop(rows: WhoopDay[], today: string): WhoopToday | null {
  const t = rows.find((r) => r.date === today);
  if (!t) return null;
  const past = rows.filter((r) => r.date < today && r.date >= shiftISO(today, -30));
  const hrvs = past.map((r) => Number(r.hrv_ms)).filter((v) => v > 0);
  const rhrs = past.map((r) => Number(r.rhr)).filter((v) => v > 0);
  const hrvBase = hrvs.length >= 5 ? avg(hrvs) : null;
  const rhrBase = rhrs.length >= 5 ? avg(rhrs) : null;
  const hrv = t.hrv_ms != null ? Number(t.hrv_ms) : null;
  const rhr = t.rhr != null ? Number(t.rhr) : null;
  const y = rows.find((r) => r.date === shiftISO(today, -1));
  const sleepMin = t.sleep_min ?? null;
  const hrvPct = hrv != null && hrvBase ? Math.round(((hrv - hrvBase) / hrvBase) * 100) : null;
  const rhrDelta = rhr != null && rhrBase ? Math.round(rhr - rhrBase) : null;
  return {
    date: t.date,
    recovery: t.recovery_score,
    level: whoopLevel(t.recovery_score),
    calibrating: !!t.calibrating,
    hrv: hrv != null ? Math.round(hrv) : null,
    hrvBase: hrvBase != null ? Math.round(hrvBase) : null,
    hrvPct,
    rhr,
    rhrBase: rhrBase != null ? Math.round(rhrBase) : null,
    rhrDelta,
    sleepMin,
    sleepNeedMin: t.sleep_need_min ?? null,
    sleepPerf: t.sleep_performance ?? null,
    deepMin: t.deep_min ?? null,
    remMin: t.rem_min ?? null,
    strainYesterday: y?.day_strain != null ? Number(y.day_strain) : null,
    hrvLow: hrvPct != null && hrvPct <= -15,
    rhrHigh: rhrDelta != null && rhrDelta >= 5,
    sleepShort: (sleepMin != null && sleepMin < 360) || (t.sleep_performance != null && t.sleep_performance < 70),
  };
}

export async function loadWhoop(supabase: SupabaseClient, athleteId: string, today: string): Promise<WhoopState> {
  const [{ data: conn, error: connErr }, { data: rows }] = await Promise.all([
    supabase.from('whoop_connections').select('last_sync_at, sync_error').eq('athlete_id', athleteId).maybeSingle(),
    supabase.from('whoop_daily').select(WHOOP_COLS).eq('athlete_id', athleteId).gte('date', shiftISO(today, -31)).lte('date', today).order('date', { ascending: true }),
  ]);
  const history = ((rows ?? []) as WhoopDay[]);
  return {
    connected: !connErr && !!conn,
    needsReauth: (conn as { sync_error?: string | null } | null)?.sync_error === 'reauth',
    lastSyncAt: (conn as { last_sync_at?: string | null } | null)?.last_sync_at ?? null,
    today: summarizeWhoop(history, today),
    history,
  };
}

export function fmtSleep(min: number | null | undefined): string {
  if (min == null) return '—';
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/** Jedna linia dla AI (czat, insight): same fakty, po polsku. */
export function whoopLine(w: WhoopToday): string {
  const parts: string[] = [];
  if (w.recovery != null) parts.push(`regeneracja ${w.recovery}%${w.calibrating ? ' (WHOOP jeszcze się kalibruje)' : ''}`);
  if (w.hrv != null) parts.push(`HRV ${w.hrv} ms${w.hrvBase ? ` (norma 30 dni ${w.hrvBase} ms, ${w.hrvPct! >= 0 ? '+' : ''}${w.hrvPct}%)` : ''}`);
  if (w.rhr != null) parts.push(`tętno spoczynkowe ${w.rhr}${w.rhrBase ? ` (norma ${w.rhrBase})` : ''}`);
  if (w.sleepMin != null) parts.push(`sen ${fmtSleep(w.sleepMin)}${w.sleepNeedMin ? ` z potrzebnych ${fmtSleep(w.sleepNeedMin)}` : ''}${w.sleepPerf != null ? ` (${w.sleepPerf}% potrzeby)` : ''}`);
  if (w.strainYesterday != null) parts.push(`obciążenie dnia wczoraj (strain) ${w.strainYesterday.toFixed(1)}/21`);
  return parts.join(' | ');
}
