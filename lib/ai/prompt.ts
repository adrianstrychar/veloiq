import type { SupabaseClient } from '@supabase/supabase-js';

interface AthleteRow {
  id: string;
  name: string;
  discipline: string | null;
  ftp_watts: number | null;
  hrmax: number | null;
  weight_kg: number | null;
  has_power_meter: boolean | null;
  weekly_hours_min: number | null;
  weekly_hours_max: number | null;
  training_days: number[] | null;
  long_ride_days: number[] | null;
  current_goals: string | null;
  weak_points: string[] | null;
}

// Mapowanie dni tygodnia (DB: 1=pon..7=nd) na etykiety PL
const DAY_NAMES: Record<number, string> = {
  1: 'pon', 2: 'wt', 3: 'śr', 4: 'czw', 5: 'pt', 6: 'sob', 7: 'nd',
};

function getMonday(): string {
  const d = new Date();
  const day = d.getDay(); // 0=nd
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

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
Z1 <70% | Z2 71-80% | Z3 81-87% | Z4 88-93% | Z5 94-100%`;
}

function summarizeLast14Days(
  activities: Array<{
    activity_date: string;
    type: string;
    distance_km: number;
    avg_watts: number | null;
    avg_hr: number | null;
    tss: number | null;
  }>,
  hasPower: boolean
): string {
  if (!activities || activities.length === 0) return '';

  const totalTSS = activities.reduce((sum, a) => sum + (a.tss ?? 0), 0);
  const totalKm = activities.reduce((sum, a) => sum + (a.distance_km ?? 0), 0);
  const rideCount = activities.length;

  // Ostatnia "ciężka" sesja (najwyższy TSS)
  const heaviest = [...activities].sort((a, b) => (b.tss ?? 0) - (a.tss ?? 0))[0];
  const heaviestMetric = hasPower && heaviest.avg_watts
    ? `${heaviest.avg_watts}W avg`
    : heaviest.avg_hr
    ? `HR avg ${heaviest.avg_hr} bpm`
    : '';

  // Lista z jedną linią na aktywność (zwięzła)
  const lines = activities.map((a) => {
    const metric = hasPower && a.avg_watts
      ? `${a.avg_watts}W`
      : a.avg_hr
      ? `HR ${a.avg_hr}`
      : '-';
    return `  ${a.activity_date} | ${a.type} | ${Math.round(a.distance_km ?? 0)}km | ${metric} | TSS ${Math.round(a.tss ?? 0)}`;
  });

  return `OSTATNIE 14 DNI (${rideCount} jazd, ${Math.round(totalKm)}km łącznie, TSS ${Math.round(totalTSS)}):
Najcięższa sesja: ${heaviest.activity_date} ${heaviestMetric} TSS ${Math.round(heaviest.tss ?? 0)}
${lines.join('\n')}`;
}

export async function buildSystemPrompt(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  // Pobierz profil zawodnika
  const athleteRes = await supabase
    .from('athletes')
    .select(
      'id, name, discipline, ftp_watts, hrmax, weight_kg, has_power_meter, ' +
      'weekly_hours_min, weekly_hours_max, training_days, long_ride_days, ' +
      'current_goals, weak_points'
    )
    .eq('user_id', userId)
    .single();
  const athlete = athleteRes.data as AthleteRow | null;

  const athleteId = athlete?.id ?? null;
  const hasPower = !!(athlete?.ftp_watts || athlete?.has_power_meter);

  // Równoległe zapytania do bazy
  const [
    { data: latestMetric },
    { data: weekAgoMetric },
    { data: recentActivities },
    { data: races },
    { data: checkin },
  ] = await Promise.all([
    athleteId
      ? supabase
          .from('fitness_metrics')
          .select('ctl, atl, tsb')
          .eq('athlete_id', athleteId)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),

    athleteId
      ? supabase
          .from('fitness_metrics')
          .select('ctl')
          .eq('athlete_id', athleteId)
          .order('date', { ascending: false })
          .range(6, 6)
          .maybeSingle()
      : Promise.resolve({ data: null }),

    athleteId
      ? supabase
          .from('strava_activities')
          .select('activity_date, type, distance_km, avg_watts, avg_hr, tss')
          .eq('athlete_id', athleteId)
          .gte(
            'activity_date',
            new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10)
          )
          .order('activity_date', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),

    athleteId
      ? supabase
          .from('race_calendar')
          .select('name, date, priority')
          .eq('athlete_id', athleteId)
          .gte('date', new Date().toISOString().slice(0, 10))
          .order('date', { ascending: true })
          .limit(5)
      : Promise.resolve({ data: [] }),

    athleteId
      ? supabase
          .from('weekly_checkins')
          .select('rhr_bpm, sleep_hours, hrv, fatigue_score, legs_feeling, motivation, notes')
          .eq('athlete_id', athleteId)
          .gte('week_start', getMonday())
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // --- Warstwa 1: tożsamość + filozofia ---
  const layer1 = buildLayer1(athlete?.discipline ?? null, hasPower);

  // --- Warstwa 2: profil zawodnika ---
  const ctl = latestMetric?.ctl ?? 0;
  const atl = latestMetric?.atl ?? 0;
  const tsb = latestMetric?.tsb ?? 0;
  const ctlTrend = weekAgoMetric
    ? Math.round((ctl - weekAgoMetric.ctl) * 10) / 10
    : null;

  const ftpW = athlete?.ftp_watts;
  const wKg =
    ftpW && athlete?.weight_kg
      ? Math.round((ftpW / Number(athlete.weight_kg)) * 10) / 10
      : null;

  const trainingDays =
    (athlete?.training_days as number[] | null)
      ?.map((d) => DAY_NAMES[d])
      .join(', ') ?? 'nieznane';
  const longRideDays =
    (athlete?.long_ride_days as number[] | null)
      ?.map((d) => DAY_NAMES[d])
      .join(', ') ?? 'nieznane';

  let layer2 = `ZAWODNIK: ${athlete?.name ?? 'Nieznany'}
Dyscyplina: ${athlete?.discipline ?? 'gravel'}\n`;

  if (hasPower && ftpW) {
    layer2 += `FTP: ${ftpW}W${wKg ? ` | W/kg: ${wKg}` : ''} | HRmax: ${athlete?.hrmax ?? '?'} bpm | Waga: ${athlete?.weight_kg ?? '?'}kg\n`;
  } else {
    layer2 += `HRmax: ${athlete?.hrmax ?? '?'} bpm | Waga: ${athlete?.weight_kg ?? '?'}kg | TRENUJE NA HR (bez miernika mocy)\n`;
  }

  layer2 += `Tygodniowe godziny: ${athlete?.weekly_hours_min ?? '?'}-${athlete?.weekly_hours_max ?? '?'}h | Dni: ${trainingDays} | Długie jazdy: ${longRideDays}\n`;

  layer2 += `\nFORMA DZIŚ:
CTL: ${Math.round(ctl)} | ATL: ${Math.round(atl)} | TSB: ${Math.round(tsb)}${ctlTrend !== null ? ` | Trend CTL: ${ctlTrend >= 0 ? '+' : ''}${ctlTrend}/tydzień` : ''}\n`;

  const activitiesSummary = summarizeLast14Days(recentActivities ?? [], hasPower);
  if (activitiesSummary) layer2 += `\n${activitiesSummary}\n`;

  if (races && races.length > 0) {
    layer2 += '\nKALENDARZ STARTÓW:\n';
    for (const r of races) {
      const daysTo = Math.ceil(
        (new Date(r.date).getTime() - Date.now()) / 86400000
      );
      layer2 += `- ${r.name} | ${r.date} | za ${daysTo} dni | priorytet ${r.priority}\n`;
    }
  }

  if (athlete?.weak_points?.length) {
    layer2 += `\nSŁABE PUNKTY: ${(athlete.weak_points as string[]).join(', ')}\n`;
  }
  if (athlete?.current_goals) {
    layer2 += `CEL SEZONU: ${athlete.current_goals}\n`;
  }

  if (checkin) {
    layer2 += '\nCHECK-IN TEGO TYGODNIA:\n';
    const parts: string[] = [];
    if (checkin.rhr_bpm) parts.push(`RHR: ${checkin.rhr_bpm} bpm`);
    if (checkin.sleep_hours) parts.push(`Sen: ${checkin.sleep_hours}h`);
    if (checkin.hrv) parts.push(`HRV: ${checkin.hrv}`);
    if (parts.length) layer2 += parts.join(' | ') + '\n';
    layer2 += `Zmęczenie: ${checkin.fatigue_score}/10 | Nogi: ${checkin.legs_feeling} | Motywacja: ${checkin.motivation}\n`;
    if (checkin.notes) layer2 += `Notatka: "${checkin.notes}"\n`;
  }

  // --- Warstwa 3: notatka trenera — faza 2, pomijamy w MVP ---

  return `${layer1}\n\n---\n\n${layer2}`;
}
