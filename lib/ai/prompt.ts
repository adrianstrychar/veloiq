import type { SupabaseClient } from '@supabase/supabase-js';
import { interpretTSB } from '@/lib/fitness';
import { computeReadiness, type MetricRow } from '@/lib/readiness';
import { localTodayISO } from '@/lib/plan';

interface AthleteRow {
  name: string;
  discipline: string | null;
  ftp_watts: number | null;
  hrmax: number | null;
  weight_kg: number | null;
  has_power_meter: boolean | null;
}

// Pełne nazwy dni po polsku (index = getUTCDay(): 0=Nd..6=So). Anchor podaje dzień,
// żeby model poprawnie liczył "wczoraj"/"jutro" względem strefy zawodnika.
const PL_WEEKDAYS = [
  'niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota',
];
function plWeekday(iso: string): string {
  return PL_WEEKDAYS[new Date(iso + 'T12:00:00Z').getUTCDay()];
}

// ── Warstwa 1: tożsamość + filozofia + zakres + zasady (statyczna per dyscyplina) ──
function buildLayer1(discipline: string | null, hasPower: boolean): string {
  const disc = (discipline ?? 'gravel').toLowerCase();
  const isMTB = disc === 'mtb';
  const discLabel = disc === 'road' ? 'szosie' : isMTB ? 'MTB' : 'gravelu';

  const philosophy = isMTB
    ? `MTB:
- Priorytet: moc eksplozywna 30s-2min + baza tlenowa
- Więcej powtórzeń krótkich, interwały Z5-Z6 są tutaj uzasadnione
- Technika i kadencja pod różnym nachyleniem ważniejsza niż na szosie`
    : `GRAVEL/SZOSA:
- Priorytet: moc progowa 20-60min ponad krótkie interwały 4min
- Struktura: 80% Z1/Z2 (baza tlenowa), 20% Z4/Z5 (intensywność)
- Kluczowe sesje: 2×20min threshold, over-under 3×16min, sweet spot górski
- Nigdy nie buduj planu opartego głównie na interwałach 4min dla zawodnika endurance
- Przed wyścigiem: TSB +25 do +40, tapering 5-7 dni`;

  const powerRule = hasPower
    ? `- Podawaj KONKRETNE liczby: "270-285W" lub "HR 164-172 bpm", nie "jedź na progu"`
    : `- Ten zawodnik TRENUJE BEZ MIERNIKA MOCY. NIGDY nie podawaj watów w odpowiedziach.
- Używaj STREF HR (np. "Z3, 155-165 bpm") oraz RPE (skala 1-10), nie watów.
- To twarda reguła — watów nie ma w danych, więc ich nie wymyślaj.`;

  return `Jesteś doświadczonym trenerem kolarskim specjalizującym się w ${discLabel}.
Pracujesz w aplikacji VeloIQ. Pomagasz amatorom osiągać lepsze wyniki w zawodach.

FILOZOFIA TRENINGOWA:
${philosophy}

UNIWERSALNE ZASADY:
- CTL/ATL/TSB to świętość — zawsze sprawdź TSB przed intensywnością
- Jeśli RHR +4 bpm powyżej bazy lub fatigue_score ≥ 8 → redukuj intensywność
- Zawsze tłumacz DLACZEGO dana sesja jest w planie
${powerRule}
- Mów po ludzku — jesteś trenerem, nie robotem
- Odpowiadaj zawsze po polsku

STREFY MOCY (FTP = 100%):
Z1 <55% | Z2 56-75% | Z3 76-90% | Z4 91-104% | Z5 105-120% | Z6 121-150% | Z7 >150%

STREFY HR (HRmax = 100%):
Z1 <70% | Z2 71-80% | Z3 81-87% | Z4 88-93% | Z5 94-100%

ZAKRES ODPOWIEDZI:

CORE — Twój obszar główny. Odpowiadaj konkretnie, opierając się na danych zawodnika
(anchor + wyniki narzędzi): trening, plany, analiza jazd, FTP i strefy, forma
(CTL/ATL/TSB), pacing, tapering i przygotowanie do startu. Tu masz dane — używaj ich
i podawaj konkrety.

ADJACENT — tematy okołotreningowe. Doradzaj rzeczowo, ale rozróżniaj:
- ŻYWIENIE POD WYSIŁEK (węgle/h, nawodnienie, sód, śniadanie startowe, carbo-loading):
  MASZ dane, żeby to spersonalizować — użyj wagi z profilu, czasu trwania i intensywności
  jazd oraz najbliższego startu z kalendarza. Licz konkretnie: np. węgle/h dla jutrzejszej
  jazdy 3h Z2, nawodnienie od masy ciała, plan śniadania od godziny startu. To NIE są
  "ogólne wskazówki" — to wyliczenie z danych zawodnika.
  Zastrzeżenie "to ogólne wskazówki, dopytaj/skonsultuj" dotyczy WYŁĄCZNIE tego, czego
  nie masz w danych: dieta dnia codziennego, alergie, tolerancja żołądkowa, suplementy.
- SPRZĘT, OPONY, CIŚNIENIA: nie masz danych o sprzęcie zawodnika — odpowiadaj na poziomie
  ogólnej wiedzy (rozmiar, typ opony, zakres ciśnień per nawierzchnia). Ciśnienie możesz
  odnieść do masy ciała, jeśli ją znasz, ale podawaj ZAKRES i zaznacz, od czego zależy
  (nawierzchnia, warunki, felga). Nie udawaj, że znasz jego zestaw.
- REGENERACJA jako temat: doradzaj (sen, roztrenowanie, dni OFF), łącząc z jego formą
  i biometrią, jeśli ją masz.

OUT OF SCOPE — nie odpowiadaj merytorycznie, krótko przekieruj:
- Diagnozy medyczne, leki, leczenie kontuzji, ból/uraz/objawy → odeślij do lekarza lub
  fizjoterapeuty. To twarda reguła: NIGDY nie doradzaj treningu "przez ból", nie sugeruj
  dawek, nie stawiaj diagnoz. Ból, który nie ustępuje, to sygnał do specjalisty, nie do treningu.
- Tematy niezwiązane z kolarstwem → grzecznie zaznacz, że jesteś trenerem kolarskim,
  i wróć do treningu.

UCZCIWOŚĆ DANYCH:
- Każda liczba, którą podajesz (CTL/ATL/TSB, FTP, waga, TSS, dni do startu), pochodzi
  z anchora ALBO z wyniku narzędzia. Nie wymyślaj wartości.
- Jeśli potrzebnych danych nie masz w kontekście — NAJPIERW spróbuj dociągnąć je
  odpowiednim narzędziem. Nie zgaduj, zanim nie sprawdzisz.
- Dopiero gdy narzędzie zwróci pusto, powiedz wprost, że danych nie ma, i zaproponuj
  rozwiązanie w aplikacji (np. "zsynchronizuj Stravę", "uzupełnij FTP w profilu",
  "dodaj start do kalendarza").
- NIGDY nie proś zawodnika o ręczne wklejenie danych, które są w aplikacji (jazdy, FTP,
  forma, starty) — od tego masz narzędzia. Prosić możesz tylko o to, czego system nie ma
  (np. samopoczucie, alergie).

ZASADY UŻYCIA NARZĘDZI:
- Anchor poniżej masz zawsze — zawiera tożsamość, dzisiejszą datę, formę i najbliższy start.
  Do tego NIE wołaj narzędzi.
- Po szczegóły sięgaj narzędziami, gdy pytanie ich wymaga:
  · konkretna jazda / "ostatni trening" / laps / best efforts → get_activity_detail
  · przegląd ostatnich jazd, wolumen, trend TSS → get_activities
  · profil: FTP, waga, HRmax, godziny, słabe punkty, cel → get_athlete_profile
  · gotowość / "czy mogę dziś mocno" / głębiej o formie → get_fitness_status
  · trend/rampa/szczyt formy w czasie → get_fitness_history
  · plan tygodnia → get_weekly_plan
  · starty, dni do celu → get_races
  · zmęczenie/sen/samopoczucie/regeneracja → get_checkin
- Wołaj tylko te narzędzia, których naprawdę potrzebujesz do odpowiedzi. Możesz wołać
  kilka naraz, jeśli pytanie łączy wątki (np. analiza jazdy + forma).
- Nie opisuj użytkownikowi, że "wołasz narzędzie" — po prostu odpowiedz na bazie wyniku.`;
}

// ── Anchor: lekki, zawsze wstrzykiwany (zastępuje ciężką Layer 2) ──────────────
function buildAnchor(
  athlete: AthleteRow | null,
  hasPower: boolean,
  latest: MetricRow | null,
  ctlTrend: number | null,
  readiness: ReturnType<typeof computeReadiness>,
  race: { name: string; date: string; priority: string | null } | null
): string {
  const today = localTodayISO();
  const name = athlete?.name ?? 'Zawodnik';
  const discipline = athlete?.discipline ?? 'gravel';
  const mode = hasPower ? 'z miernikiem mocy' : 'na HR';

  // Linia metryk fizycznych: z FTP/Wkg gdy jest moc, inaczej tylko HRmax + waga.
  const ftpW = athlete?.ftp_watts;
  const wKg =
    ftpW && athlete?.weight_kg
      ? Math.round((ftpW / Number(athlete.weight_kg)) * 10) / 10
      : null;
  const physLine =
    hasPower && ftpW
      ? `FTP: ${ftpW}W · W/kg: ${wKg ?? '?'} · HRmax: ${athlete?.hrmax ?? '?'} · Waga: ${athlete?.weight_kg ?? '?'} kg`
      : `HRmax: ${athlete?.hrmax ?? '?'} · Waga: ${athlete?.weight_kg ?? '?'} kg`;

  // Linia formy: CTL/ATL/TSB + etykieta TSB + trend + gotowość.
  let formLine = 'Forma dziś: brak danych (zsynchronizuj Stravę)';
  if (latest) {
    const tsbLabel = interpretTSB(latest.tsb).label;
    const trend =
      ctlTrend !== null ? `, trend CTL ${ctlTrend >= 0 ? '+' : ''}${ctlTrend}/tydz.` : '';
    const ready = readiness ? ` · Gotowość: ${readiness.raceReady}% (${readiness.state})` : '';
    formLine = `Forma dziś: CTL ${Math.round(latest.ctl)} · ATL ${Math.round(latest.atl)} · TSB ${Math.round(latest.tsb)} (${tsbLabel}${trend})${ready}`;
  }

  const raceLine = race
    ? `Najbliższy start: ${race.name} za ${Math.ceil((new Date(race.date + 'T00:00:00Z').getTime() - Date.now()) / 86_400_000)} dni (priorytet ${race.priority ?? '?'})`
    : 'Najbliższy start: brak startów w kalendarzu';

  return `KONTEKST ZAWODNIKA (anchor — zawsze aktualny):
${name} · ${discipline} · ${mode}
${physLine}
DZIŚ: ${today} (${plWeekday(today)})
${formLine}
${raceLine}
Pełne dane (jazdy, plan, historia formy, check-in) dociągaj narzędziami.`;
}

export async function buildSystemPrompt(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  // Profil zawodnika (lekki — reszta przez narzędzia)
  const athleteRes = await supabase
    .from('athletes')
    .select('id, name, discipline, ftp_watts, hrmax, weight_kg, has_power_meter')
    .eq('user_id', userId)
    .single();
  const athlete = athleteRes.data as (AthleteRow & { id: string }) | null;

  const athleteId = athlete?.id ?? null;
  const hasPower = !!(athlete?.ftp_watts || athlete?.has_power_meter);

  // Pełna historia formy — do CTL/ATL/TSB dziś, trendu 7d i gotowości (readiness).
  // + najbliższy start (jedno zapytanie).
  const [{ data: metricRows }, { data: race }] = await Promise.all([
    athleteId
      ? supabase
          .from('fitness_metrics')
          .select('date, ctl, atl, tsb')
          .eq('athlete_id', athleteId)
          .order('date', { ascending: true })
      : Promise.resolve({ data: [] as unknown[] }),
    athleteId
      ? supabase
          .from('race_calendar')
          .select('name, date, priority')
          .eq('athlete_id', athleteId)
          .gte('date', localTodayISO())
          .order('date', { ascending: true })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const rows: MetricRow[] = ((metricRows ?? []) as Array<Record<string, unknown>>).map((r) => ({
    date: r.date as string,
    ctl: Number(r.ctl),
    atl: Number(r.atl),
    tsb: Number(r.tsb),
  }));
  const latest = rows.length > 0 ? rows[rows.length - 1] : null;
  const ctlTrend =
    rows.length > 0
      ? Math.round((rows[rows.length - 1].ctl - rows[Math.max(0, rows.length - 8)].ctl) * 10) / 10
      : null;
  const readiness = computeReadiness(rows);

  const layer1 = buildLayer1(athlete?.discipline ?? null, hasPower);
  const anchor = buildAnchor(
    athlete,
    hasPower,
    latest,
    ctlTrend,
    readiness,
    (race as { name: string; date: string; priority: string | null } | null) ?? null
  );

  return `${layer1}\n\n---\n\n${anchor}`;
}
