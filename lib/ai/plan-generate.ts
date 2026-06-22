// Generator planu tygodniowego (ETAP 5.1) — budowa promptu + walidacja JSON.

export const WORKOUT_TYPES = ['OFF', 'Z1', 'Z2', 'SST', 'THR', 'OU', 'VO2', 'LONG'] as const;
export type WorkoutType = (typeof WORKOUT_TYPES)[number];

export interface PlanDay {
  dow: number;        // 1=Pn ... 7=Nd
  date: string;       // ISO, doliczany server-side
  type: WorkoutType;
  label: string;
  tss: number;
  dur_min: number;
  watt: string;       // "255–275W" lub "–"
  hr: string;         // "155–168" lub "–"
  zones: number[];    // [Z1,Z2,Z3,Z4,Z5] %
}

export interface GeneratorInputs {
  weekStart: string;          // ISO poniedziałek
  ftp: number;
  mass: number | null;
  vo2max: number | null;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  raceName: string | null;
  raceDate: string | null;    // ISO
  daysToRace: number | null;
  weeklyTssTarget: number;
}

// ── Daty ────────────────────────────────────────────────────────────────────

// Poniedziałek tygodnia zawierającego `d` (ISO 'YYYY-MM-DD'), liczone w UTC.
export function mondayOf(d: Date): string {
  const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = u.getUTCDay(); // 0=Nd..6=So
  const diff = dow === 0 ? -6 : 1 - dow; // przesuń do poniedziałku
  u.setUTCDate(u.getUTCDate() + diff);
  return u.toISOString().slice(0, 10);
}

// ISO data dnia `dow` (1..7) w tygodniu zaczynającym się od weekStart.
export function dateForDow(weekStart: string, dow: number): string {
  const u = new Date(weekStart + 'T00:00:00Z');
  u.setUTCDate(u.getUTCDate() + (dow - 1));
  return u.toISOString().slice(0, 10);
}

// ── Prompt ────────────────────────────────────────────────────────────────────

export function buildPlanPrompt(inp: GeneratorInputs): { system: string; user: string } {
  const system = [
    'Jesteś doświadczonym trenerem kolarstwa budującym plan na JEDEN tydzień (Pn–Nd).',
    'Zawodnik: Adrian — puncheur. GŁÓWNA SŁABOŚĆ: próg utrzymany 20–60 min. To priorytet rozwojowy:',
    'zaplanuj min. 2 sesje jakościowe (THR/SST/OU) celujące w utrzymany wysiłek progowy 20–60 min.',
    'ZASADY ROZGRZEWKI (wlicz w dur_min i w rozkład stref): min 20 min spokojnej rozgrzewki przed Z2/SST,',
    'min 25 min przed THR/OU/VO2. Każda jakościowa sesja ma rozgrzewkę + część główną + schłodzenie.',
    'TWARDA REGUŁA dla zones[]: rozgrzewka i schłodzenie MUSZĄ być widoczne w rozkładzie stref.',
    'Dla THR/OU/VO2 udział Z1+Z2 (zones[0]+zones[1]) musi wynosić CO NAJMNIEJ tyle, ile odpowiada 25 min,',
    'czyli >= round(25 / dur_min * 100)%. Dla Z2/SST udział Z1+Z2 >= round(20 / dur_min * 100)%.',
    'Przykład: THR o dur_min=90 → Z1+Z2 >= 28%. Resztę procentów rozłóż na strefy pracy (Z3/Z4/Z5).',
    'Buduj progresywnie względem aktualnej formy (CTL). Zostaw regenerację: dni OFF/Z1 i jedną długą LONG w weekend.',
    'Nie przekraczaj rozsądnego tygodniowego obciążenia względem celu TSS.',
    'Typy: OFF=wolne, Z1=regeneracja aktywna, Z2=endurance, SST=sweet spot, THR=threshold, OU=over-under, VO2=vo2max, LONG=długa.',
    'Zwróć WYŁĄCZNIE poprawny JSON (bez markdown, bez tekstu przed/po).',
  ].join(' ');

  const raceLine = inp.raceName && inp.daysToRace != null
    ? `Najbliższy wyścig: ${inp.raceName} za ${inp.daysToRace} dni (${inp.raceDate}). Jesteśmy w fazie budowania.`
    : 'Brak nadchodzącego wyścigu — utrzymanie/budowanie ogólnej formy.';

  const user = [
    `Profil: FTP ${inp.ftp}W, masa ${inp.mass ?? '—'} kg, VO2max ${inp.vo2max ?? '—'}.`,
    `Forma: CTL ${inp.ctl ?? '—'}, ATL ${inp.atl ?? '—'}, TSB ${inp.tsb ?? '—'}.`,
    raceLine,
    `Cel tygodniowy ~${inp.weeklyTssTarget} TSS (orientacyjnie, rozłóż sensownie).`,
    `Tydzień zaczyna się w poniedziałek ${inp.weekStart}.`,
    '',
    'Zwróć JSON w formacie:',
    '{"days":[{"dow":1,"type":"OFF|Z1|Z2|SST|THR|OU|VO2|LONG","label":"krótka nazwa",' +
      '"tss":0,"dur_min":0,"watt":"255–275W lub –","hr":"155–168 lub –","zones":[Z1,Z2,Z3,Z4,Z5]}, ...dokładnie 7 dni dow 1..7...],' +
      '"insight":"1-2 zdania PO POLSKU co zaplanowałeś i dlaczego","weekly_tss_target":' + inp.weeklyTssTarget + '}',
    '',
    'Wymogi: dokładnie 7 dni (dow 1..7 rosnąco). Dla OFF: tss 0, dur_min 0, watt "–", hr "–", zones [0,0,0,0,0].',
    'zones to % czasu w strefach Z1–Z5, suma ~100. Nie dodawaj pola date — zostanie doliczone.',
  ].join('\n');

  return { system, user };
}

// ── Walidacja ────────────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  days?: PlanDay[];
  insight?: string;
  error?: string;
}

export function validatePlan(rawText: string, weekStart: string): ValidationResult {
  let parsed: unknown;
  try {
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return { ok: false, error: 'JSON parse failed' };
  }

  const obj = parsed as { days?: unknown; insight?: unknown };
  if (!Array.isArray(obj.days) || obj.days.length !== 7) {
    return { ok: false, error: `oczekiwano 7 dni, otrzymano ${Array.isArray(obj.days) ? obj.days.length : 'brak'}` };
  }

  const days: PlanDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = obj.days[i] as Record<string, unknown>;
    const dow = i + 1;

    const type = String(d.type ?? '') as WorkoutType;
    if (!WORKOUT_TYPES.includes(type)) {
      return { ok: false, error: `dzień ${dow}: nieznany typ "${d.type}"` };
    }

    let zones = Array.isArray(d.zones) ? d.zones.map((z) => Math.round(Number(z) || 0)) : [];
    if (zones.length !== 5) zones = [0, 0, 0, 0, 0];
    zones = zones.map((z) => Math.max(0, Math.min(100, z)));

    let tss = Math.max(0, Math.round(Number(d.tss) || 0));
    let durMin = Math.max(0, Math.round(Number(d.dur_min) || 0));
    let watt = typeof d.watt === 'string' && d.watt.trim() ? d.watt.trim() : '–';
    let hr = typeof d.hr === 'string' && d.hr.trim() ? d.hr.trim() : '–';

    // Normalizacja dnia wolnego
    if (type === 'OFF') {
      tss = 0; durMin = 0; watt = '–'; hr = '–'; zones = [0, 0, 0, 0, 0];
    } else {
      // dni z treningiem: walidacja sumy stref (tolerancja 90–110)
      const zsum = zones.reduce((a, b) => a + b, 0);
      if (zsum < 90 || zsum > 110) {
        return { ok: false, error: `dzień ${dow} (${type}): strefy sumują się do ${zsum}%, poza zakresem 90–110` };
      }
    }

    days.push({
      dow,
      date: dateForDow(weekStart, dow),
      type,
      label: typeof d.label === 'string' && d.label.trim() ? d.label.trim() : type,
      tss,
      dur_min: durMin,
      watt,
      hr,
      zones,
    });
  }

  return {
    ok: true,
    days,
    insight: typeof obj.insight === 'string' ? obj.insight.trim() : '',
  };
}
