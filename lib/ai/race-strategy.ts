// Strategia wyścigu AI — B2 Etap 1 (BEZ GPX). Czyste funkcje: typ, prompt, fingerprint.
// POZIOM 1: fazy z PROPORCJI przewyższenia i dystansu (przód/środek/finisz), tempo wg surface.
// TWARDY WARUNEK: bez profilu trasy (GPX) model NIE MA prawa wymyślać nazw podjazdów ani
// toponimów per km — zmyślona nazwa podjazdu, którego nie ma na trasie, jest GORSZA niż brak.
// Cache jak insight (#87): fingerprint wejść (parametry wyścigu + snapshot profilu), zapis race_plans.
import { createHash } from 'node:crypto';

export type PacingTier = 'oszczedz' | 'atak' | 'full';

export interface RaceStrategy {
  meta: { distance_km: number | null; elevation_m: number | null; surface: string };
  pacing: { phase: string; tier: PacingTier; watts: string; tip: string }[];
  fueling: { km: string; tip: string }[];
  tires: { front: string; rear: string; note: string };
  packing: { nutrition: string[]; hydration: string[]; summary: string };
  strengths: { km: string; tip: string }[];
  targets: { finish_time: string; avg_watts: number | null; if: number | null };
}

export interface StrategyRace {
  name: string;
  date: string;
  distance_km: number | null;
  elevation_m: number | null;
  discipline: string | null; // 'gravel' | 'road' | 'mtb'
  location: string | null;
}

export interface StrategyProfile {
  ftp_watts: number | null;
  weight_kg: number | null;
  current_goals: string | null;
  weak_points: string[] | null;
}

export const surfaceLabel = (d: string | null) => (d === 'road' ? 'szosa (asfalt)' : d === 'mtb' ? 'MTB (technicznie)' : 'gravel (szuter)');

// meta liczone z race_calendar (nie zapisywane — zawsze aktualne przy odczycie).
export function strategyMeta(race: StrategyRace): RaceStrategy['meta'] {
  return { distance_km: race.distance_km, elevation_m: race.elevation_m, surface: surfaceLabel(race.discipline) };
}

// Reassembly z kolumn race_plans (odczyt cache) → pełny RaceStrategy dla widoku. Współdzielone
// przez endpoint (cache hit) i races/page (SSR). Jedno źródło mapowania kolumny→typ.
export function reassembleStrategy(row: Record<string, unknown>, race: StrategyRace): RaceStrategy {
  const tp = (row.tactical_plan as { pacing?: RaceStrategy['pacing']; strengths?: RaceStrategy['strengths']; finish_time?: string } | null) ?? {};
  const np = (row.race_nutrition_plan as { fueling?: RaceStrategy['fueling']; packing?: RaceStrategy['packing'] } | null) ?? {};
  const tr = (row.tire_recommendations as RaceStrategy['tires'] | null) ?? { front: '', rear: '', note: '' };
  return {
    meta: strategyMeta(race),
    pacing: tp.pacing ?? [],
    fueling: np.fueling ?? [],
    tires: tr,
    packing: np.packing ?? { nutrition: [], hydration: [], summary: '' },
    strengths: tp.strengths ?? [],
    targets: {
      finish_time: tp.finish_time ?? '',
      avg_watts: (row.target_avg_watts as number | null) ?? null,
      if: row.target_if != null ? Number(row.target_if) : null,
    },
  };
}

// Fingerprint: parametry wyścigu + snapshot profilu. POGODY NIE MA (świeża, poza cache — Etap 3).
export function strategyFingerprint(race: StrategyRace, profile: StrategyProfile): string {
  const payload = JSON.stringify({
    r: [race.name, race.date, race.distance_km, race.elevation_m, race.discipline],
    p: [profile.ftp_watts, profile.weight_kg, profile.current_goals ?? '', (profile.weak_points ?? []).join('|')],
    v: 1, // wersja promptu — bump wymusza regeneracje po zmianie logiki
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function buildStrategyPrompt(race: StrategyRace, profile: StrategyProfile): { system: string; user: string } {
  const wkg = profile.ftp_watts && profile.weight_kg ? (profile.ftp_watts / Number(profile.weight_kg)).toFixed(2) : null;
  const surface = surfaceLabel(race.discipline);

  const system = [
    'Jesteś strategiem wyścigów gravel/kolarskich w VeloIQ. Tworzysz plan startu dla zawodnika (Adrian) na "Ty", po polsku.',
    // ── TWARDA REGUŁA HONESTY (bez GPX) ──
    'KRYTYCZNE: NIE masz profilu trasy (GPX). NIE ZNASZ konkretnych podjazdów, ich nazw, kilometrażu ani nawierzchni na poszczególnych odcinkach.',
    'BEZWZGLĘDNY ZAKAZ: nie wymyślaj nazw podjazdów, wzniesień, sektorów ani toponimów ("podjazd X", "sektor Y"). Zmyślona nazwa miejsca, którego nie ma na trasie, jest GORSZA niż brak nazwy i podważa zaufanie do całego planu.',
    'Fazy wyścigu opisuj WYŁĄCZNIE przez PROPORCJE dystansu i przewyższenia: "pierwsza trzecia — prawdopodobnie płasko/rozjazd", "środek — najcięższe metry przewyższenia", "ostatnia ćwiartka — finisz". Wyprowadzaj profil z RELACJI przewyższenie/dystans (m/km), nie z wyobrażonej mapy.',
    'Tempo/waty ustaw wg profilu zawodnika (FTP, W/kg) i typu nawierzchni. Podawaj ZAKRESY watów jako % FTP, ostrożnie.',
    'Uwzględnij mocne strony i słabości zawodnika w rozkładzie wysiłku (gdzie atakować, gdzie oszczędzać).',
    'ODPOWIEDZ WYŁĄCZNIE poprawnym JSON-em wg schematu w wiadomości użytkownika — bez markdown, bez komentarzy, bez tekstu poza JSON.',
  ].join(' ');

  const emPerKm = race.elevation_m && race.distance_km ? Math.round(race.elevation_m / race.distance_km) : null;
  const user = [
    'WYŚCIG:',
    `- Nazwa: ${race.name}`,
    `- Data: ${race.date}${race.location ? ` · kraj: ${race.location}` : ''}`,
    `- Dystans: ${race.distance_km ?? '?'} km · Przewyższenie: ${race.elevation_m ?? '?'} m${emPerKm != null ? ` (~${emPerKm} m/km — ${emPerKm >= 15 ? 'górski' : emPerKm >= 8 ? 'pofałdowany' : 'raczej płaski'})` : ''}`,
    `- Nawierzchnia: ${surface}`,
    '',
    'ZAWODNIK:',
    `- FTP: ${profile.ftp_watts ?? '?'} W${wkg ? ` · ${wkg} W/kg` : ''} · waga: ${profile.weight_kg ?? '?'} kg`,
    `- Cele/mocne strony: ${profile.current_goals ?? '—'}`,
    `- Słabości: ${(profile.weak_points ?? []).join(', ') || '—'}`,
    '',
    'ZWRÓĆ JSON (dokładnie te pola):',
    `{
  "pacing": [ { "phase": "opis fazy z PROPORCJI (np. 'Pierwsza trzecia · ~0-43 km')", "tier": "oszczedz|atak|full", "watts": "np. '235-250 W (76-81% FTP)'", "tip": "taktyka — bez zmyślonych nazw miejsc" } ],
  "fueling": [ { "km": "np. 'Start → 30 km'", "tip": "kiedy żel/bidon" } ],
  "tires": { "front": "typ+szerokość+ciśnienie wg nawierzchni, BEZ nazw handlowych", "rear": "j.w.", "note": "krótkie uzasadnienie wg surface" },
  "packing": { "nutrition": ["Żele ×N · 40g węgli", "..."], "hydration": ["Bidon 750ml izotonik ×2", "..."], "summary": "~X kcal · ~Y L · ~Zg węgli/h" },
  "strengths": [ { "km": "gdzie w proporcji trasy", "tip": "jak wykorzystać mocną stronę / chronić słabość" } ],
  "targets": { "finish_time": "np. '4h 30min' (szacunek)", "avg_watts": <int|null>, "if": <0.x|null> }
}`,
    'Fazy pacing: 3-5 sztuk wg proporcji. tier: oszczedz=oszczędzaj, atak=atakuj, full=finisz na maksa.',
  ].join('\n');

  return { system, user };
}
