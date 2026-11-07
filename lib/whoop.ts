// Integracja WHOOP (Developer API v2, OAuth 2.0 authorization code + refresh token).
// Pobieramy: cykle (strain dnia), regenerację (recovery, HRV, RHR, SpO2, temp. skóry), sen (fazy,
// potrzeba snu, wydajność) i treningi. Zapis: whoop_daily (1 wiersz = dzień pobudki).
// Dokumentacja: https://developer.whoop.com/api · tokeny rotują przy każdym odświeżeniu.

import type { SupabaseClient } from '@supabase/supabase-js';

export const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
export const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
export const WHOOP_API = 'https://api.prod.whoop.com/developer';
export const WHOOP_SCOPES = 'offline read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement';

export function whoopConfigured(): boolean {
  return !!(process.env.WHOOP_CLIENT_ID && process.env.WHOOP_CLIENT_SECRET);
}

export function whoopRedirectUri(): string {
  return process.env.WHOOP_REDIRECT_URI ?? `${process.env.NEXT_PUBLIC_APP_URL}/api/whoop/callback`;
}

export class WhoopAuthError extends Error {}
export class WhoopRateLimit extends Error {}

export interface WhoopTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<WhoopTokens> {
  const id = process.env.WHOOP_CLIENT_ID!, secret = process.env.WHOOP_CLIENT_SECRET!;
  // client_secret_post (jak w dokumentacji WHOOP); gdy serwer odrzuci klienta – próba z Basic auth
  const send = (basic: boolean) => fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(basic ? { Authorization: `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}` } : {}),
    },
    body: new URLSearchParams(basic ? body : { ...body, client_id: id, client_secret: secret }).toString(),
    cache: 'no-store',
  });
  let res = await send(false);
  let txt = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 200);
  if (res.status === 401 && /invalid_client/.test(txt)) {
    res = await send(true);
    txt = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 200);
  }
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) throw new WhoopAuthError(`WHOOP token ${res.status}: ${txt}`);
    throw new Error(`WHOOP token ${res.status}: ${txt}`);
  }
  return (await res.json()) as WhoopTokens;
}

export function exchangeWhoopCode(code: string) {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: whoopRedirectUri() });
}

function refreshWhoopToken(refreshToken: string) {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: 'offline' });
}

export async function whoopGet<T>(token: string, path: string, params?: Record<string, string>): Promise<T> {
  const url = `${WHOOP_API}${path}${params ? `?${new URLSearchParams(params).toString()}` : ''}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (res.status === 401) throw new WhoopAuthError('WHOOP 401');
  if (res.status === 429) throw new WhoopRateLimit('WHOOP 429');
  if (!res.ok) throw new Error(`WHOOP ${path} ${res.status}`);
  return (await res.json()) as T;
}

interface Page<T> { records: T[]; next_token?: string | null }

async function collection<T>(token: string, path: string, startISO: string, maxPages = 8): Promise<T[]> {
  const out: T[] = [];
  let next: string | null | undefined;
  for (let i = 0; i < maxPages; i++) {
    const params: Record<string, string> = { limit: '25', start: startISO };
    if (next) params.nextToken = next;
    const page = await whoopGet<Page<T>>(token, path, params);
    out.push(...(page.records ?? []));
    next = page.next_token;
    if (!next) break;
  }
  return out;
}

// ── Typy odpowiedzi (tylko pola, których używamy) ──────────────────────────────

interface WCycle {
  id: number; start: string; end?: string | null; timezone_offset?: string; score_state?: string;
  score?: { strain?: number; kilojoule?: number; average_heart_rate?: number; max_heart_rate?: number } | null;
}
interface WRecovery {
  cycle_id: number; sleep_id?: string; score_state?: string;
  score?: { user_calibrating?: boolean; recovery_score?: number; resting_heart_rate?: number; hrv_rmssd_milli?: number; spo2_percentage?: number; skin_temp_celsius?: number } | null;
}
interface WSleep {
  id: string; cycle_id?: number; start: string; end: string; timezone_offset?: string; nap?: boolean; score_state?: string;
  score?: {
    stage_summary?: {
      total_in_bed_time_milli?: number; total_awake_time_milli?: number; total_light_sleep_time_milli?: number;
      total_slow_wave_sleep_time_milli?: number; total_rem_sleep_time_milli?: number; disturbance_count?: number;
    };
    sleep_needed?: { baseline_milli?: number; need_from_sleep_debt_milli?: number; need_from_recent_strain_milli?: number; need_from_recent_nap_milli?: number };
    respiratory_rate?: number; sleep_performance_percentage?: number; sleep_consistency_percentage?: number; sleep_efficiency_percentage?: number;
  } | null;
}
interface WWorkout {
  id: string; start: string; end: string; timezone_offset?: string; sport_name?: string; score_state?: string;
  score?: { strain?: number; average_heart_rate?: number; max_heart_rate?: number; kilojoule?: number; distance_meter?: number } | null;
}

// ── Daty: lokalny dzień wg przesunięcia strefy z WHOOP ("+01:00") ─────────────

function offsetMin(tz?: string): number {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz ?? '');
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}
function localDate(iso: string, tz?: string, addMs = 0): string {
  return new Date(new Date(iso).getTime() + addMs + offsetMin(tz) * 60_000).toISOString().slice(0, 10);
}
const min = (ms?: number) => (ms != null ? Math.round(ms / 60_000) : null);

export interface WhoopDailyRow {
  athlete_id: string; date: string; cycle_id: number;
  recovery_score: number | null; hrv_ms: number | null; rhr: number | null; spo2: number | null; skin_temp: number | null; calibrating: boolean | null;
  sleep_performance: number | null; sleep_efficiency: number | null; sleep_consistency: number | null;
  sleep_min: number | null; sleep_need_min: number | null; in_bed_min: number | null; light_min: number | null; deep_min: number | null;
  rem_min: number | null; awake_min: number | null; disturbances: number | null; resp_rate: number | null;
  sleep_start: string | null; sleep_end: string | null;
  day_strain: number | null; day_kj: number | null; day_avg_hr: number | null; day_max_hr: number | null;
  workouts: { sport: string; start: string; min: number; strain: number | null; avg_hr: number | null; max_hr: number | null; kj: number | null; km: number | null }[];
  updated_at: string;
}

/** Cykle + regeneracja + sen + treningi → wiersze dzienne. Dzień = lokalna data pobudki (koniec snu głównego). */
export function buildDailyRows(athleteId: string, cycles: WCycle[], recs: WRecovery[], sleeps: WSleep[], workouts: WWorkout[]): WhoopDailyRow[] {
  const recBy = new Map(recs.map((r) => [r.cycle_id, r]));
  const sleepBy = new Map<number, WSleep>();
  for (const s of sleeps) {
    if (s.nap || s.cycle_id == null) continue;
    const prev = sleepBy.get(s.cycle_id);
    if (!prev || new Date(s.end).getTime() - new Date(s.start).getTime() > new Date(prev.end).getTime() - new Date(prev.start).getTime()) sleepBy.set(s.cycle_id, s);
  }
  const now = new Date().toISOString();
  const rows = new Map<string, WhoopDailyRow & { _start: number }>();
  for (const c of cycles) {
    const sl = sleepBy.get(c.id);
    // dzień pobudki; bez snu: początek cyklu (≈ zaśnięcie) + 12 h
    const date = sl ? localDate(sl.end, sl.timezone_offset ?? c.timezone_offset) : localDate(c.start, c.timezone_offset, 12 * 3600_000);
    const start = new Date(c.start).getTime();
    const ex = rows.get(date);
    if (ex && ex._start > start) continue; // dwa cykle na jeden dzień → późniejszy
    const r = recBy.get(c.id);
    const rs = r?.score_state === 'SCORED' ? r.score : null;
    const ss = sl?.score_state === 'SCORED' ? sl.score : null;
    const st = ss?.stage_summary;
    const need = ss?.sleep_needed;
    const asleep = st ? (st.total_light_sleep_time_milli ?? 0) + (st.total_slow_wave_sleep_time_milli ?? 0) + (st.total_rem_sleep_time_milli ?? 0) : null;
    const needMs = need ? (need.baseline_milli ?? 0) + (need.need_from_sleep_debt_milli ?? 0) + (need.need_from_recent_strain_milli ?? 0) - Math.abs(need.need_from_recent_nap_milli ?? 0) : null;
    const cs = c.score_state === 'SCORED' || c.score?.strain != null ? c.score : null;
    rows.set(date, {
      _start: start,
      athlete_id: athleteId, date, cycle_id: c.id,
      recovery_score: rs?.recovery_score != null ? Math.round(rs.recovery_score) : null,
      hrv_ms: rs?.hrv_rmssd_milli != null ? Math.round(rs.hrv_rmssd_milli * 10) / 10 : null,
      rhr: rs?.resting_heart_rate != null ? Math.round(rs.resting_heart_rate) : null,
      spo2: rs?.spo2_percentage ?? null,
      skin_temp: rs?.skin_temp_celsius ?? null,
      calibrating: rs?.user_calibrating ?? null,
      sleep_performance: ss?.sleep_performance_percentage != null ? Math.round(ss.sleep_performance_percentage) : null,
      sleep_efficiency: ss?.sleep_efficiency_percentage != null ? Math.round(ss.sleep_efficiency_percentage * 10) / 10 : null,
      sleep_consistency: ss?.sleep_consistency_percentage != null ? Math.round(ss.sleep_consistency_percentage) : null,
      sleep_min: asleep != null ? min(asleep) : null,
      sleep_need_min: needMs != null && needMs > 0 ? min(needMs) : null,
      in_bed_min: min(st?.total_in_bed_time_milli),
      light_min: min(st?.total_light_sleep_time_milli),
      deep_min: min(st?.total_slow_wave_sleep_time_milli),
      rem_min: min(st?.total_rem_sleep_time_milli),
      awake_min: min(st?.total_awake_time_milli),
      disturbances: st?.disturbance_count ?? null,
      resp_rate: ss?.respiratory_rate != null ? Math.round(ss.respiratory_rate * 10) / 10 : null,
      sleep_start: sl?.start ?? null,
      sleep_end: sl?.end ?? null,
      day_strain: cs?.strain != null ? Math.round(cs.strain * 10) / 10 : null,
      day_kj: cs?.kilojoule != null ? Math.round(cs.kilojoule) : null,
      day_avg_hr: cs?.average_heart_rate ?? null,
      day_max_hr: cs?.max_heart_rate ?? null,
      workouts: [],
      updated_at: now,
    });
  }
  for (const w of workouts) {
    const d = localDate(w.start, w.timezone_offset);
    const row = rows.get(d);
    if (!row) continue;
    const s = w.score_state === 'SCORED' ? w.score : null;
    row.workouts.push({
      sport: w.sport_name ?? 'aktywność',
      start: w.start,
      min: Math.round((new Date(w.end).getTime() - new Date(w.start).getTime()) / 60_000),
      strain: s?.strain != null ? Math.round(s.strain * 10) / 10 : null,
      avg_hr: s?.average_heart_rate ?? null,
      max_hr: s?.max_heart_rate ?? null,
      kj: s?.kilojoule != null ? Math.round(s.kilojoule) : null,
      km: s?.distance_meter != null ? Math.round(s.distance_meter / 100) / 10 : null,
    });
  }
  return Array.from(rows.values()).map(({ _start, ...r }) => { void _start; return r; });
}

// ── Połączenie + ważny token (z odświeżeniem i obsługą wyścigu dwóch równoległych syncy) ──

export interface WhoopConnection {
  athlete_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  last_sync_at: string | null;
  sync_error?: string | null;
}

const CONN_COLS = 'athlete_id, access_token, refresh_token, expires_at, last_sync_at, sync_error';

export async function getWhoopConnection(supabase: SupabaseClient, athleteId: string): Promise<WhoopConnection | null> {
  const { data, error } = await supabase.from('whoop_connections').select(CONN_COLS).eq('athlete_id', athleteId).maybeSingle();
  if (error) return null; // brak tabeli (migracja 024) = brak integracji
  return (data as WhoopConnection | null) ?? null;
}

async function refreshConn(supabase: SupabaseClient, conn: WhoopConnection): Promise<WhoopConnection> {
  if (!conn.refresh_token) throw new WhoopAuthError('no refresh token');
  try {
    const t = await refreshWhoopToken(conn.refresh_token);
    const upd = {
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? conn.refresh_token,
      expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
      sync_error: null,
    };
    await supabase.from('whoop_connections').update(upd).eq('athlete_id', conn.athlete_id);
    return { ...conn, ...upd };
  } catch (e) {
    // inny proces mógł właśnie odświeżyć (stary refresh token unieważniony; WHOOP wysyła np. webhooki
    // sleep + recovery naraz) → poczekaj chwilę na jego zapis i weź świeży token z bazy
    for (let i = 0; i < 3; i++) {
      const fresh = await getWhoopConnection(supabase, conn.athlete_id);
      if (fresh && fresh.refresh_token !== conn.refresh_token && new Date(fresh.expires_at).getTime() > Date.now() + 60_000) return fresh;
      if (!(e instanceof WhoopAuthError)) break;
      await new Promise((r) => setTimeout(r, 700));
    }
    if (e instanceof WhoopAuthError) {
      // tylko jeśli w bazie wciąż jest TEN refresh token – świeżo odświeżonego połączenia nie psujemy
      await supabase.from('whoop_connections').update({ sync_error: 'reauth' })
        .eq('athlete_id', conn.athlete_id).eq('refresh_token', conn.refresh_token);
    }
    throw e;
  }
}

/** Ważny token (odświeżony, jeśli wygasa). Wołane PRZED ograniczonym czasowo syncem – odświeżenie
 *  musi się zapisać w bazie, bo stary refresh token po nim już nie działa. */
export async function validConn(supabase: SupabaseClient, conn: WhoopConnection): Promise<WhoopConnection> {
  if (new Date(conn.expires_at).getTime() > Date.now() + 120_000) return conn;
  return refreshConn(supabase, conn);
}

/** Wywołanie API z automatycznym odświeżeniem tokenu przy 401 (raz). */
async function withToken<T>(supabase: SupabaseClient, conn: WhoopConnection, fn: (token: string) => Promise<T>): Promise<{ res: T; conn: WhoopConnection }> {
  let c = await validConn(supabase, conn);
  try {
    return { res: await fn(c.access_token), conn: c };
  } catch (e) {
    if (!(e instanceof WhoopAuthError)) throw e;
    c = await refreshConn(supabase, c);
    return { res: await fn(c.access_token), conn: c };
  }
}

export interface WhoopSyncResult { ok: boolean; days: number; error?: 'reauth' | 'rate_limit' | 'failed' | 'not_connected'; message?: string }

/** Pobiera ostatnie `days` dni z WHOOP i zapisuje do whoop_daily. */
export async function syncWhoop(supabase: SupabaseClient, athleteId: string, opts: { days?: number; conn?: WhoopConnection | null } = {}): Promise<WhoopSyncResult> {
  const conn = opts.conn ?? await getWhoopConnection(supabase, athleteId);
  if (!conn) return { ok: false, days: 0, error: 'not_connected' };
  const days = Math.min(Math.max(opts.days ?? 4, 1), 120);
  const startISO = new Date(Date.now() - (days + 1) * 86400_000).toISOString();
  try {
    const { res } = await withToken(supabase, conn, async (token) => {
      const [cycles, recs, sleeps, workouts] = await Promise.all([
        collection<WCycle>(token, '/v2/cycle', startISO),
        collection<WRecovery>(token, '/v2/recovery', startISO),
        collection<WSleep>(token, '/v2/activity/sleep', startISO),
        collection<WWorkout>(token, '/v2/activity/workout', startISO).catch(() => [] as WWorkout[]),
      ]);
      return { cycles, recs, sleeps, workouts };
    });
    const rows = buildDailyRows(athleteId, res.cycles, res.recs, res.sleeps, res.workouts);
    if (rows.length) {
      const { error } = await supabase.from('whoop_daily').upsert(rows, { onConflict: 'athlete_id,date' });
      if (error) throw new Error(error.message);
    }
    await supabase.from('whoop_connections').update({ last_sync_at: new Date().toISOString(), sync_error: null }).eq('athlete_id', athleteId);
    return { ok: true, days: rows.length };
  } catch (e) {
    if (e instanceof WhoopAuthError) return { ok: false, days: 0, error: 'reauth', message: 'Połączenie z WHOOP wygasło – połącz ponownie.' };
    // nieudana próba też liczy się jako „sync” (last_sync_at) – pulpit nie odpytuje WHOOP przy każdym wejściu
    const now = new Date().toISOString();
    if (e instanceof WhoopRateLimit) {
      await supabase.from('whoop_connections').update({ last_sync_at: now, sync_error: 'rate_limit' }).eq('athlete_id', athleteId);
      return { ok: false, days: 0, error: 'rate_limit', message: 'WHOOP chwilowo ogranicza zapytania – spróbuj za kilka minut.' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from('whoop_connections').update({ last_sync_at: now, sync_error: msg.slice(0, 200) }).eq('athlete_id', athleteId);
    return { ok: false, days: 0, error: 'failed', message: msg };
  }
}

/** Sync „przy okazji” (pulpit): tylko gdy dane są nieświeże; nie blokuje strony dłużej niż `timeoutMs`. */
export async function syncWhoopIfStale(supabase: SupabaseClient, athleteId: string, maxAgeMin = 30, timeoutMs = 4500): Promise<void> {
  const conn = await getWhoopConnection(supabase, athleteId);
  if (!conn || conn.sync_error === 'reauth') return;
  const age = conn.last_sync_at ? (Date.now() - new Date(conn.last_sync_at).getTime()) / 60_000 : Infinity;
  if (age < maxAgeMin) return;
  let c: WhoopConnection;
  try { c = await validConn(supabase, conn); } catch { return; }
  await Promise.race([
    syncWhoop(supabase, athleteId, { days: 3, conn: c }).catch(() => null),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
}

/** Odłączenie: cofnięcie dostępu w WHOOP (best-effort) i usunięcie tokenów. Dane dzienne zostają. */
export async function disconnectWhoop(supabase: SupabaseClient, athleteId: string): Promise<void> {
  const conn = await getWhoopConnection(supabase, athleteId);
  if (conn) {
    try {
      const c = await validConn(supabase, conn);
      await fetch(`${WHOOP_API}/v2/user/access`, { method: 'DELETE', headers: { Authorization: `Bearer ${c.access_token}` } });
    } catch { /* i tak usuwamy lokalnie */ }
  }
  await supabase.from('whoop_connections').delete().eq('athlete_id', athleteId);
}
