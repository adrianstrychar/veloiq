import { buildSessionStructure, type LapInput, type SessionElement } from '@/lib/laps';
import { parseStructure, sessionStructure } from '@/lib/workout';
import { isOU, ouBlockMin, type DayStructure } from '@/lib/structure';

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

// Zaplanowany trening na ten dzień (z weekly_plans). null = jazda niezaplanowana / dzień OFF.
export interface PlannedWorkout {
  type: string;
  label: string;
  watt: string;   // zakres np. "330–355W" lub "–"
  hr: string;     // zakres np. "175–185" lub "–"
  tss: number;
  dur_min: number;
  structure?: DayStructure | null; // parametry substruktury z plan_json (brak = stary plan → fallback z labela)
}

// Pełna rozpiska zaplanowanej sesji dla promptu — Z PRZERWAMI między interwałami/blokami
// i rozgrzewką/schłodzeniem, żeby AI nie krytykowało przerw zrobionych zgodnie z planem.
function describePlannedStructure(type: string, s: DayStructure): string {
  const ss = sessionStructure(type);
  const frame = `rozgrzewka ~${ss.warmupDefault} min, schłodzenie ~${ss.cooldownDefault} min`;
  if (isOU(s)) {
    return `${s.reps} bloki × ${s.cycles} cykle (${s.under_min}min @${s.under_w}W under + ${s.over_min}min @${s.over_w}W over) = ${s.reps}×${ouBlockMin(s)}min, przerwy między blokami ${s.rest_min} min Z1 (PLANOWE — nie krytykuj ich), ${frame}`;
  }
  return `${s.reps}×${s.work_min}min @${s.work_w}W, przerwy między interwałami ${s.rest_min} min Z1 (PLANOWE — nie krytykuj ich), ${frame}`;
}

// Opis struktury lapów. hidePower → e-bike: moc nierzetelna (silnik), pokazujemy tylko czas + HR.
function describeStructure(structure: SessionElement[], hidePower: boolean): string {
  if (structure.length === 0) return 'Brak danych o okrążeniach.';
  const lines = structure.map((el) => {
    if (el.type === 'single') {
      const l = el.lap;
      const min = (l.durationSec / 60).toFixed(0);
      if (hidePower) return `- Segment ciągły, lap ${l.n}: ${min} min, HR ${l.hr ?? '—'}`;
      const w = l.watts != null ? `${l.watts}W${l.pctFtp != null ? ` (${l.pctFtp}% FTP)` : ''}` : 'bez mocy';
      return `- Segment ciągły, lap ${l.n}: ${min} min, ${w}, HR ${l.hr ?? '—'}`;
    }
    const s = el.summary;
    if (hidePower) return `- Blok interwałowy: ${s.count}× (${s.label}), łączny czas ${(s.totalTimeSec / 60).toFixed(0)} min`;
    return `- Blok interwałowy: ${s.count}× (${s.label}), śr. ${s.avgWatts ?? '—'}W, łączny czas ${(s.totalTimeSec / 60).toFixed(0)} min`;
  });
  return lines.join('\n');
}

// Buduje prompt (system + user) po polsku: ocena REALIZACJI treningu (plan ↔ wykonanie).
export function buildInsightPrompt(
  activity: InsightActivity,
  ftp: number | null,
  trainingMode: string | null,
  planned: PlannedWorkout | null = null
): { system: string; user: string } {
  // e-bike → moc z silnika, nierzetelna: wycinamy ją CAŁKOWICIE z promptu (nie podajemy watów,
  // żeby model nie miał czego komentować — spójnie z hrTSS dla e-bike).
  const isEbike = activity.type === 'EBikeRide';
  const hasPower = !isEbike && activity.avg_watts != null && trainingMode !== 'hr' && trainingMode !== 'basic';
  const structure = buildSessionStructure(activity.laps ?? [], ftp);

  const powerRule = hasPower
    ? `Zawodnik ma miernik mocy (FTP ${ftp ?? '—'}W). Analizuj po mocy i % FTP.`
    : `Brak wiarygodnych danych mocy (e-bike lub trening po tętnie) — analizuj WYŁĄCZNIE po tętnie, TSS i odczuciu. NIE wymyślaj wartości w watach.`;

  const system = [
    'Jesteś wymagającym trenerem kolarstwa. Mówisz do zawodnika (Adrian) na "Ty".',
    'Zadanie: ocena REALIZACJI treningu — czy zlecona sesja została wykonana. MAKS 4 zdania.',
    'Gdy podany jest ZAPLANOWANY trening: porównaj go z WYKONANIEM. Każde "zabrakło/spadło/przekroczyłeś" MUSI wskazywać konkretną liczbę z porównania (interwały, waty, HR, TSS) — nie ogólniki.',
    'Wymagający = KONKRETNY i oparty na danych plan↔wykonanie, z jednym actionable wnioskiem. NIE generyczne czepialstwo ("popracuj nad mocą").',
    'Gdy NIE ma zaplanowanego treningu: oceń jazdę samodzielnie, naturalnie. NIE wspominaj, że była niezaplanowana, nie karć za spontaniczność.',
    'Struktura odpowiedzi: 1 zdanie plan vs wykonanie, 1-2 zdania gdzie odchylenie i dlaczego, 1 zdanie actionable wniosek. Sam tekst, bez nagłówków, bez markdown.',
    powerRule,
  ].join(' ');

  // ── Blok ZAPLANOWANO (tylko gdy jest plan) ──
  const plannedLines: string[] = [];
  if (planned) {
    // Pełna substruktura z plan_json (przerwy, waty per segment); stare plany bez structure →
    // fallback: N×M z labela albo surowy label (jak dotąd).
    const s = planned.structure ? null : parseStructure(planned.label);
    const struct = planned.structure
      ? describePlannedStructure(planned.type, planned.structure)
      : s ? `${s.reps} × ${s.minutes}min` : planned.label;
    const powerTarget = isEbike ? '' : `, moc ${planned.watt}`;
    plannedLines.push(
      `ZAPLANOWANO: ${planned.type} — "${planned.label}" (struktura: ${struct}), cele:${powerTarget} HR ${planned.hr}, TSS ${planned.tss}, czas ${planned.dur_min} min.`,
      ''
    );
  }

  // ── Blok WYKONANO (e-bike: bez linii mocy i bez best efforts mocy) ──
  const exec: string[] = ['WYKONANO:'];
  exec.push(
    `- Typ ${activity.type ?? '—'}, czas ${activity.duration_seconds != null ? Math.round(activity.duration_seconds / 60) : '—'} min, dystans ${activity.distance_km ?? '—'} km, przewyższenie ${activity.elevation_m ?? '—'} m, TSS ${activity.tss != null ? Math.round(activity.tss) : '—'}.`
  );
  if (!isEbike) {
    exec.push(`- Moc: śr ${activity.avg_watts ?? '—'}W, NP ${activity.normalized_power ?? '—'}W.`);
  }
  exec.push(`- Tętno: śr ${activity.avg_hr ?? '—'}, max ${activity.max_hr ?? '—'} bpm.`);
  if (!isEbike) {
    const eff = activity.best_efforts ?? {};
    if (Object.keys(eff).length) {
      exec.push(`- Best efforts (moc szczytowa): ${Object.entries(eff).map(([k, v]) => `${k}: ${v}W`).join(', ')}.`);
    }
  }
  exec.push('- Struktura sesji (lapy):', describeStructure(structure, isEbike));

  const closing = planned
    ? 'Porównaj zaplanowane z wykonanym. Oceń realizację treningu. Maks 4 zdania.'
    : 'Oceń tę jazdę. Maks 4 zdania.';

  const user = [...plannedLines, ...exec, '', closing].join('\n');

  return { system, user };
}
