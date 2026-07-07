// Weryfikacja startów względem KUROWANYCH oficjalnych kalendarzy UCI (gravel + granfondo/szosa).
// PROPOSE, NOT PERSIST: ten moduł TYLKO czyta i raportuje rozjazdy. Żaden zapis nie idzie stąd —
// poprawki wykonuje model przez ISTNIEJĄCY propose_race_change + commit_change (z potwierdzeniem).
// Odporność: fetch z timeoutem, błąd źródła → wyjątek łapany wyżej; parser defensywny → [] + log.

// Kurowane źródła (mała, rzadko zmienna lista — konfiguracja w kodzie, nie DB).
const SOURCES = {
  gravel: 'https://ucigravelworldseries.com/en/calendar/',
  road: 'https://ucigranfondoworldseries.com/en/calendar/',
} as const;
export type Source = keyof typeof SOURCES;

const FETCH_TIMEOUT_MS = 15000;
const UA = 'Mozilla/5.0 (compatible; VeloIQ-RaceVerify/1.0)';

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export interface OfficialRace {
  name: string;
  city: string;
  country: string;
  date: string | null; // YYYY-MM-DD
  url: string;
  series: Source;
}

const MON: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

// Parser defensywny: bloki glz-event z polami event-name/date/city/country. Zmiana struktury
// strony → brak dopasowań → [] (log wyżej), NIE crash. Data: ostatnia "DD Mon YYYY" (zakres → koniec).
export function parseCalendarHtml(html: string, series: Source): OfficialRace[] {
  const out: OfficialRace[] = [];
  const blocks = html.match(/<div class="glz-event event-\d+">[\s\S]*?<\/a>/g) ?? [];
  for (const blk of blocks) {
    const nm = blk.match(/class="event-name">\s*<h5>([\s\S]*?)<\/h5>/);
    const dt = blk.match(/class="event-date">\s*([\s\S]*?)\s*<\/div>/);
    if (!nm || !dt) continue;
    const city = blk.match(/class="event-city">([\s\S]*?)<\/span>/);
    const ctry = blk.match(/class="event-country">[\s\S]*?<span>([\s\S]*?)<\/span>/);
    const href = blk.match(/<a href="([^"]+)"/);
    const raw = dt[1].replace(/\s+/g, ' ').trim();
    const dm = Array.from(raw.matchAll(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/g));
    const last = dm[dm.length - 1];
    const date = last ? `${last[3]}-${String(MON[last[2]]).padStart(2, '0')}-${String(+last[1]).padStart(2, '0')}` : null;
    out.push({
      name: nm[1].replace(/<[^>]+>/g, '').trim(),
      city: city ? city[1].trim() : '',
      country: ctry ? ctry[1].trim() : '',
      date,
      url: href ? href[1] : SOURCES[series],
      series,
    });
  }
  return out;
}

export async function fetchOfficialCalendar(series: Source): Promise<OfficialRace[]> {
  const races = parseCalendarHtml(await fetchText(SOURCES[series]), series);
  if (races.length === 0) console.warn(`[race-verify] 0 wyścigów sparsowanych dla ${series} — struktura strony mogła się zmienić`);
  return races;
}

// ── Dystans z podstrony wyścigu ──────────────────────────────────────────────────
export interface DistanceRange {
  minKm: number;
  maxKm: number;
}

// <h6>Distances</h6><span>88 - 129 km</span> (zakres) albo pojedyncza "129 km".
export function parseDistanceHtml(html: string): DistanceRange | null {
  const range = html.match(/Distances<\/h6>[\s\S]{0,60}?<span[^>]*>\s*(\d+)\s*[-–]\s*(\d+)\s*km/i);
  if (range) {
    const a = parseInt(range[1], 10), b = parseInt(range[2], 10);
    return { minKm: Math.min(a, b), maxKm: Math.max(a, b) };
  }
  const single = html.match(/Distances<\/h6>[\s\S]{0,60}?<span[^>]*>\s*(\d+)\s*km/i);
  if (single) {
    const a = parseInt(single[1], 10);
    return { minKm: a, maxKm: a };
  }
  return null;
}

export async function fetchRaceDistance(url: string): Promise<DistanceRange | null> {
  try {
    return parseDistanceHtml(await fetchText(url));
  } catch {
    return null; // podstrona niedostępna → dystansu nie sprawdzamy (data i tak z listy)
  }
}

// REGUŁA SERII (nie best-effort): zakres to DWIE trasy — Medio Fondo (krótsza) i Gran Fondo (dłuższa).
// Przypisanie wg wieku zawodnika: ≤54 lat → Gran Fondo (MAX), 55+ → Medio (MIN). Zawodnik ma 30 lat
// (kategoria M19-34) → zawsze MAX. Reguła jawna: przy 55+ zmienia się jedna gałąź.
export function officialDistanceForAge(range: DistanceRange, age: number): { km: number; label: string } {
  if (age >= 55) return { km: range.minKm, label: 'Medio Fondo' };
  return { km: range.maxKm, label: 'Gran Fondo' };
}

// ── Fuzzy match (normalizacja + Jaccard tokenów name+city+country) ────────────────
const STOP = new Set(['gravel', 'race', 'granfondo', 'gran', 'fondo', 'the', 'de', 'di', 'tour', 'festival', 'classic', 'world', 'series', 'uci', '2026']);
function tokens(...parts: string[]): Set<string> {
  const t = parts.join(' ').toLowerCase().replace(/['’.,\-–()]/g, ' ');
  return new Set(t.split(/\s+/).filter((w) => w && !STOP.has(w)));
}
export function matchScore(mineName: string, mineLoc: string, off: OfficialRace): number {
  const A = tokens(mineName, mineLoc);
  const B = tokens(off.name, off.city, off.country);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((x) => { if (B.has(x)) inter++; });
  return inter / (A.size + B.size - inter);
}

export interface MyRace {
  race_id: string;
  name: string;
  date: string;
  distance_km: number | null;
  location: string | null;
}

// Próg 0.15: najniższy prawdziwy match to 0.20 (Matildica), więc bufor. Fałszywy match kończy się
// co najwyżej ODRZUCONĄ propozycją (propose→user mówi „nie") — asymetria ryzyka sprzyja niskiemu progowi.
const MATCH_THRESHOLD = 0.15;

export function matchRaces(mine: MyRace[], official: OfficialRace[]): Array<{ mine: MyRace; official: OfficialRace | null; score: number }> {
  return mine.map((r) => {
    let best: OfficialRace | null = null;
    let bestScore = 0;
    for (const o of official) {
      const s = matchScore(r.name, r.location ?? '', o);
      if (s > bestScore) { bestScore = s; best = o; }
    }
    return bestScore >= MATCH_THRESHOLD ? { mine: r, official: best, score: bestScore } : { mine: r, official: null, score: bestScore };
  });
}

export interface Discrepancy {
  race_id: string;
  race_name: string;
  field: 'date' | 'distance_km';
  mine: string;
  official: string;
  source_url: string;
}

export interface VerifyResult {
  checked: number;
  matched: number;
  discrepancies: Discrepancy[];
  errors: string[];
}

// Rdzeń weryfikacji. DATA z listy kalendarza (jeden fetch/serię), porównanie EXACT (cały sens —
// tapering liczy się od daty). DYSTANS z podstrony (tylko zmatchowane, max ~6 fetchy) z PROGIEM
// ISTOTNOŚCI distanceThreshold: wpisy usera to szacunki, więc drobne różnice nie są rozjazdem;
// próg łapie realne zmiany tras. PROPOSE NOT PERSIST: zwraca raport, nic nie zapisuje.
export async function findDiscrepancies(mine: MyRace[], age: number, distanceThreshold = 0.15): Promise<VerifyResult> {
  const errors: string[] = [];
  const official: OfficialRace[] = [];
  for (const s of ['gravel', 'road'] as Source[]) {
    try {
      official.push(...(await fetchOfficialCalendar(s)));
    } catch (e) {
      errors.push(`Nie udało się pobrać oficjalnego kalendarza ${s === 'gravel' ? 'gravel' : 'szosowego'}: ${e instanceof Error ? e.message : 'błąd sieci'}. Spróbuj później.`);
    }
  }

  const matched = matchRaces(mine, official).filter((m) => m.official != null) as Array<{ mine: MyRace; official: OfficialRace; score: number }>;
  const discrepancies: Discrepancy[] = [];

  for (const m of matched) {
    if (m.official.date && m.mine.date !== m.official.date) {
      discrepancies.push({
        race_id: m.mine.race_id, race_name: m.mine.name, field: 'date',
        mine: m.mine.date, official: m.official.date, source_url: SOURCES[m.official.series],
      });
    }
    if (m.mine.distance_km != null) {
      const range = await fetchRaceDistance(m.official.url);
      if (range) {
        const chosen = officialDistanceForAge(range, age);
        const rel = Math.abs(m.mine.distance_km - chosen.km) / chosen.km;
        if (rel >= distanceThreshold) {
          discrepancies.push({
            race_id: m.mine.race_id, race_name: m.mine.name, field: 'distance_km',
            mine: `${m.mine.distance_km} km`,
            official: `${chosen.label} ${chosen.km} km (zakres ${range.minKm}-${range.maxKm})`,
            source_url: m.official.url,
          });
        }
      }
    }
  }

  return { checked: mine.length, matched: matched.length, discrepancies, errors };
}
