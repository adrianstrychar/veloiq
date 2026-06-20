import { buildSessionStructure, type LapInput, type SessionElement } from '@/lib/laps';

export interface InsightActivity {
  name: string | null;
  activity_date: string;
  type: string | null;
  distance_km: number | null;
  elevation_m: number | null;
  duration_seconds: number | null;
  tss: number | null;
  avg_watts: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  normalized_power: number | null;
  best_efforts: Record<string, number> | null;
  laps: LapInput[] | null;
}

function describeStructure(structure: SessionElement[], ftp: number | null): string {
  if (structure.length === 0) return 'Brak danych o okrążeniach.';
  const lines = structure.map((el) => {
    if (el.type === 'single') {
      const l = el.lap;
      const min = (l.durationSec / 60).toFixed(0);
      const w = l.watts != null ? `${l.watts}W${l.pctFtp != null ? ` (${l.pctFtp}% FTP)` : ''}` : 'bez mocy';
      return `- Segment ciągły, lap ${l.n}: ${min} min, ${w}, HR ${l.hr ?? '—'}`;
    }
    const s = el.summary;
    return `- Blok interwałowy: ${s.count}× (${s.label}), śr. ${s.avgWatts ?? '—'}W, łączny czas ${(s.totalTimeSec / 60).toFixed(0)} min`;
  });
  return lines.join('\n');
}

// Buduje prompt (system + user) po polsku dla analizy jednej jazdy.
export function buildInsightPrompt(
  activity: InsightActivity,
  ftp: number | null,
  trainingMode: string | null
): { system: string; user: string } {
  const hasPower = activity.avg_watts != null && trainingMode !== 'hr' && trainingMode !== 'basic';
  const structure = buildSessionStructure(activity.laps ?? [], ftp);

  const powerRule = hasPower
    ? `Zawodnik ma miernik mocy (FTP ${ftp ?? '—'}W). Analizuj po mocy i % FTP.`
    : `Zawodnik NIE ma wiarygodnych danych mocy — analizuj WYŁĄCZNIE po tętnie i odczuciu. NIE wymyślaj wartości w watach.`;

  const system = [
    'Jesteś doświadczonym trenerem kolarstwa. Mówisz do zawodnika na "Ty", po imieniu (Adrian).',
    'Twoje zadanie: zwięzła ocena JEDNEJ jazdy na podstawie danych — 2-3 zdania, konkretnie, z liczbami.',
    'Wykryj typ sesji z danych (interwały progowe/VO2, długie wytrzymałościowe, tempo, spokojna regeneracja).',
    'Oceń jakość: jak trzymane były interwały, czy moc/tętno spadało, jak to się ma do FTP.',
    'Bez żargonu, bez waty z sufitu, bez ogólników. Jedno krótkie spostrzeżenie + jedna wskazówka na przyszłość.',
    'Zwróć sam tekst analizy — bez nagłówków, bez markdown, bez pogrubień.',
    powerRule,
  ].join(' ');

  const eff = activity.best_efforts ?? {};
  const effLine = Object.keys(eff).length
    ? Object.entries(eff).map(([k, v]) => `${k}: ${v}W`).join(', ')
    : 'brak';

  const user = [
    `Jazda: ${activity.name ?? 'bez nazwy'} (${activity.activity_date}), typ ${activity.type ?? '—'}.`,
    `Statystyki: dystans ${activity.distance_km ?? '—'} km, czas ${activity.duration_seconds != null ? Math.round(activity.duration_seconds / 60) : '—'} min, przewyższenie ${activity.elevation_m ?? '—'} m, TSS ${activity.tss != null ? Math.round(activity.tss) : '—'}.`,
    `Moc: śr. ${activity.avg_watts ?? '—'}W, NP ${activity.normalized_power ?? '—'}W. Tętno: śr. ${activity.avg_hr ?? '—'}, max ${activity.max_hr ?? '—'} bpm.`,
    `Best efforts (moc szczytowa): ${effLine}.`,
    `Struktura sesji (lapy):`,
    describeStructure(structure, ftp),
    '',
    'Napisz 2-3 zdania analizy tej jazdy.',
  ].join('\n');

  return { system, user };
}
