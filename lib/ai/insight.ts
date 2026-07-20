import { buildSessionStructure, type LapInput, type SessionElement } from '@/lib/laps';
import { parseStructure, sessionStructure } from '@/lib/workout';
import { isOU, ouBlockMin, type DayStructure } from '@/lib/structure';
import type { FormSignals } from '@/lib/ai/insight-context';
import type { RaceDay } from '@/lib/race-day';

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
  warmup?: number;    // nadpisanie z suwaka (scaleWeek); brak → default z sessionStructure. Do celu ringu.
  cooldown?: number;
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

// ── WYŚCIG: osobny prompt. NIE ocenia wg stref, NIE porównuje z celem treningowym, NIE czyta
// wysokiego tętna jako zmęczenia, NIE sugeruje "odpuść", NIE zmyśla wyniku/pozycji (brak danych).
// Trzon: profil mocy (best efforts), zmienność (VI), moc vs FTP, koszt startu. Pacing WARUNKOWO —
// tylko gdy laps>1 (są dane czasowe); przy jednym odcinku ciągłym best efforts dają WIELKOŚCI, nie
// MOMENTY, więc opis rozłożenia sił start-vs-koniec byłby zmyśleniem.
function buildRacePrompt(
  activity: InsightActivity,
  hasPower: boolean,
  isEbike: boolean,
  structure: SessionElement[],
  signals: FormSignals | null,
  race: RaceDay,
  powerRule: string,
  ftp: number | null
): { system: string; user: string } {
  const lapCount = activity.laps?.length ?? 0;
  const hasSplits = lapCount > 1; // wiele okrążeń → są dane czasowe do opisu rozłożenia sił
  const np = activity.normalized_power;
  const avg = activity.avg_watts;
  const vi = !isEbike && np != null && avg != null && avg > 0 ? Math.round((np / avg) * 100) / 100 : null;

  const pacingRule = hasSplits
    ? 'Masz podział na okrążenia (niżej) — MOŻESZ opisać rozłożenie sił: równo czy odjazd na starcie, jak wyglądała końcówka.'
    : 'Jazda to JEDEN odcinek ciągły — NIE masz danych czasowych o przebiegu. Mów o PROFILU mocy (wielkości wysiłków z best efforts, powtarzalność), NIE o tym, kiedy w wyścigu nastąpiły ani o rozłożeniu start-vs-koniec. NIE zmyślaj przebiegu w czasie.';

  const system = [
    'Jesteś wymagającym, ale ludzkim trenerem kolarstwa. Mówisz do zawodnika (Adrian) na "Ty". 3-4 zdania, JEDEN wniosek.',
    'TO BYŁ WYŚCIG (start), NIE zaplanowany trening — rządzi się inną logiką. NIE oceniaj "czy trafił w cel wg stref", NIE porównuj z żadnym celem treningowym (na starcie nie ma zadanej struktury do wykonania).',
    'Wysokie tętno na starcie jest NORMALNE i wynika z INTENSYWNOŚCI wyścigu — NIE interpretuj go jako zmęczenia, kosztu ani przetrenowania.',
    'NIE sugeruj "odpuść / zamień kolejny dzień na regenerację" — start się odbył, nie ma czego korygować. Regeneracja PO wyścigu jest oczekiwana i normalna, nie alarm.',
    'NIE wymyślaj wyniku, pozycji, miejsca ani czasu względem grupy — VeloIQ NIE MA tych danych. Mów WYŁĄCZNIE o tym, co widać z pliku jazdy: moc, tętno, koszt.',
    'O CZYM masz mówić: profil mocy z best efforts (najmocniejsze wysiłki, powtarzalność), zmienność mocy (VI = NP / moc średnia — im wyżej, tym bardziej poszarpany, atakowy wyścig), moc względem FTP i ile było wysiłku nad progiem, oraz koszt startu (TSS, wpływ na formę).',
    pacingRule,
    powerRule,
    'Zakaz: recytacji liczb z kafli, nagłówków, markdown. Ton: konkretny, jeden actionable akcent na koniec (np. jak wpasować regenerację po starcie).',
  ].join(' ');

  // Fakt startu ZAMIAST bloku ZAPLANOWANO — model wie, czemu moc/TSS wysokie, bez podawania celu
  // Z2/Primer (to jest ta pokusa porównań ze strefami, którą wycinamy).
  const prio = race.priority ? ` (ranga ${race.priority})` : '';
  const dist = race.distanceKm != null ? `, ${race.distanceKm} km` : '';
  const raceLine = `TO BYŁ START: ${race.name}${prio}${dist} — nie zaplanowana sesja treningowa.`;

  // Sygnały: dla wyścigu przez buildFormSignals zostaje TYLKO trend (hrAtPower/ef/ring już null).
  const signalLines: string[] = [];
  if (signals?.trend) {
    signalLines.push('SYGNAŁY FORMY (o TYM mów — to nie jest na kaflach):', `- ${signals.trend}`, '');
  }

  const exec: string[] = ['DANE JAZDY (tło, NIE cytuj — user widzi to na karcie):'];
  exec.push(
    `- Czas ${activity.duration_seconds != null ? Math.round(activity.duration_seconds / 60) : '—'} min, dystans ${activity.distance_km ?? '—'} km, przewyższenie ${activity.elevation_m ?? '—'} m, TSS ${activity.tss != null ? Math.round(activity.tss) : '—'}.`
  );
  if (!isEbike) {
    exec.push(`- Moc: śr ${avg ?? '—'}W, NP ${np ?? '—'}W${vi != null ? `, VI ${vi} (zmienność — jak poszarpany wysiłek)` : ''}${ftp ? `, FTP ${ftp}W` : ''}.`);
  }
  exec.push(`- Tętno: śr ${activity.avg_hr ?? '—'}, max ${activity.max_hr ?? '—'} bpm.`);
  if (!isEbike) {
    const eff = activity.best_efforts ?? {};
    if (Object.keys(eff).length) {
      exec.push(`- Best efforts (moc szczytowa wg czasu): ${Object.entries(eff).map(([k, v]) => `${k}: ${v}W`).join(', ')}.`);
    }
  }
  exec.push(hasSplits ? '- Okrążenia:' : '- Struktura (jeden odcinek):', describeStructure(structure, isEbike));

  const closing = 'Napisz insight o tym STARCIE: profil mocy i najmocniejsze wysiłki, zmienność (VI), moc względem FTP, koszt i miejsce regeneracji po starcie (jako normalnej). 3-4 zdania, jeden wniosek, bez recytowania liczb z karty.';

  const user = [raceLine, '', ...signalLines, ...exec, '', closing].join('\n');
  return { system, user };
}

// Buduje prompt (system + user) po polsku: ocena REALIZACJI treningu (plan ↔ wykonanie).
// signals = warstwa interpretacyjna (trend/EF/HR@moc/ring%) — insight MA o niej mówić,
// a NIE recytować liczb z kafli (dystans/TSS/waty user już widzi na karcie).
export function buildInsightPrompt(
  activity: InsightActivity,
  ftp: number | null,
  trainingMode: string | null,
  planned: PlannedWorkout | null = null,
  signals: FormSignals | null = null,
  race: RaceDay | null = null
): { system: string; user: string } {
  // e-bike → moc z silnika, nierzetelna: wycinamy ją CAŁKOWICIE z promptu (nie podajemy watów,
  // żeby model nie miał czego komentować — spójnie z hrTSS dla e-bike).
  const isEbike = activity.type === 'EBikeRide';
  const hasPower = !isEbike && activity.avg_watts != null && trainingMode !== 'hr' && trainingMode !== 'basic';
  const structure = buildSessionStructure(activity.laps ?? [], ftp);

  const powerRule = hasPower
    ? `Zawodnik ma miernik mocy (FTP ${ftp ?? '—'}W). Analizuj po mocy i % FTP.`
    : `Brak wiarygodnych danych mocy (e-bike lub trening po tętnie) — analizuj WYŁĄCZNIE po tętnie, TSS i odczuciu. NIE wymyślaj wartości w watach.`;

  // WYŚCIG rządzi się inną logiką niż trening — osobna gałąź. Sygnał twardy z race_calendar
  // (nie type==='RACE': dzień bywa Z2 z metadaną race). Early-return → ścieżka treningowa niżej
  // pozostaje bajt-w-bajt bez zmian (reszta typów 1:1).
  if (race) {
    return buildRacePrompt(activity, hasPower, isEbike, structure, signals, race, powerRule, ftp);
  }

  const system = [
    'Jesteś wymagającym, ale ludzkim trenerem kolarstwa. Mówisz do zawodnika (Adrian) na "Ty". 3-4 zdania, JEDEN wniosek trenerski.',
    'ZASADA NADRZĘDNA: insight zaczyna się tam, gdzie kończą się kafle. Zawodnik WIDZI już na karcie dystans, czas, TSS, waty, tętno, best efforts — NIE recytuj tych liczb. Blok "DANE JAZDY" to wyłącznie tło dla Ciebie; NIE przepisuj go.',
    'Mów o INTERPRETACJI z bloku "SYGNAŁY FORMY": co znaczy trend formy, efektywność (moc/tętno), tętno przy podobnej mocy, realizacja celu — czyli czy forma rośnie, czy było zmęczenie, jak ta jazda wpisuje się w kierunek. Liczbę z "SYGNAŁÓW FORMY" możesz przywołać, gdy niesie wniosek (np. "tętno 6 bpm niżej niż zwykle przy tej mocy").',
    'Gdy jest ZAPLANOWANY trening: jedno zdanie, czy sesja trafiła w cel — jakościowo, bez cytowania TSS/watów, chyba że odchylenie jest sednem wniosku. Bez zaplanowanego treningu: oceń jazdę samodzielnie, naturalnie; NIE wspominaj, że była niezaplanowana.',
    'Zakaz: recytacji liczb z kafli, generycznego czepialstwa ("popracuj nad mocą"), nagłówków, markdown. Ton: konkretny, z jednym actionable akcentem na koniec.',
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

  // ── Blok SYGNAŁY FORMY (warstwa interpretacyjna — O TYM insight ma mówić) ──
  const signalLines: string[] = [];
  const sig = [signals?.trend, signals?.ef, signals?.hrAtPower, signals?.ring].filter((s): s is string => !!s);
  if (sig.length) {
    signalLines.push('SYGNAŁY FORMY (o TYM mów — to nie jest widoczne na kaflach):');
    for (const s of sig) signalLines.push(`- ${s}`);
    signalLines.push('');
  }

  // ── Blok DANE JAZDY (tło — user je widzi w kaflach, NIE cytuj) ──
  const exec: string[] = ['DANE JAZDY (tło, NIE cytuj — user widzi to na karcie):'];
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

  const closing = sig.length
    ? 'Napisz insight trenerski o formie i kierunku (z SYGNAŁÓW FORMY), NIE recytując danych jazdy. 3-4 zdania, jeden wniosek.'
    : planned
      ? 'Oceń jakościowo, czy sesja trafiła w cel dnia — bez recytowania liczb. 3-4 zdania.'
      : 'Oceń tę jazdę jakościowo, bez recytowania liczb z karty. 3-4 zdania.';

  const user = [...plannedLines, ...signalLines, ...exec, '', closing].join('\n');

  return { system, user };
}
