import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient } from '@/lib/supabase';
import { isAiOutage, AI_UNAVAILABLE_MSG, AI_TOO_LONG_MSG } from '@/lib/ai/ai-error';
import { assertNotTruncated, MaxTokensError } from '@/lib/ai/parse-json-response';
import {
  buildTwoWeekPrompt,
  validateTwoWeekPlan,
  tssBand,
  mondayOf,
  nextWeekStart,
  type GeneratorInputs,
  type PlanDay,
  type RaceContext,
  type RaceMeta,
} from '@/lib/ai/plan-generate';
import { estimateRaceDay, taperDaysFor, taperVolumeFactor, taperLast48hViolation, outlineTaperPlaceholders, type RacePriority } from '@/lib/race-taper';
import { buildRecentLoad, recoveryViolation, RECOVERY_CONFIG, type RecentActivity, type PastRace } from '@/lib/recent-load';

// dow (1=Pn..7=Nd) daty w tygodniu zaczynającym się od weekStart (Mon), albo null gdy poza tygodniem.
function dowInWeek(weekStart: string, dateIso: string): number | null {
  const ws = new Date(weekStart + 'T00:00:00Z').getTime();
  const d = new Date(dateIso + 'T00:00:00Z').getTime();
  const diff = Math.round((d - ws) / 86400000);
  return diff >= 0 && diff <= 6 ? diff + 1 : null;
}

// Buduje RaceMeta dla dnia startu (szacunek deterministyczny; braki danych → zera, UI pokaże "—").
function raceMetaOf(r: { name: string; priority: RacePriority; distance_km: number | null; elevation_m: number | null; discipline: string | null }): RaceMeta {
  const est = estimateRaceDay(r.distance_km, r.elevation_m, r.discipline, r.priority);
  return {
    name: r.name, priority: r.priority,
    distanceKm: r.distance_km, elevationM: r.elevation_m, discipline: r.discipline,
    estTimeMin: est?.estTimeMin ?? 0, estTss: est?.estTss ?? 0,
  };
}

// Wstawia dzień RACE w miejsce dow (1-based) — zastępuje to, co AI dało na ten dzień.
function injectRaceDay(days: PlanDay[], dow: number, meta: RaceMeta, dateIso: string): void {
  const i = dow - 1;
  if (i < 0 || i >= days.length) return;
  days[i] = {
    ...days[i], dow, date: dateIso, type: 'RACE', label: meta.name,
    tss: meta.estTss, dur_min: meta.estTimeMin, watt: '–', hr: '–',
    zones: [0, 0, 0, 0, 0], structure: null, race: meta,
  };
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  // Opcje generowania (legalne funkcje, działają za sesją): dry_run = podgląd bez
  // zapisu, intensity/target_tss = nadpisanie celu tygodniowego (pod 5.6/5.7).
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = (body as Record<string, unknown>)?.dry_run === true;
  const overrideTarget = Number((body as Record<string, unknown>)?.target_tss) > 0
    ? Math.round(Number((body as Record<string, unknown>).target_tss)) : null;
  const intensityMul = Number((body as Record<string, unknown>)?.intensity) > 0
    ? Number((body as Record<string, unknown>).intensity) : 1.1;

  // ── Dane wejściowe z bazy ──
  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, ftp_watts, weight_kg, vo2max, training_mode')
    .eq('user_id', authUser.id)
    .single();

  if (!athlete) return NextResponse.json({ error: 'athlete_not_found' }, { status: 404 });
  const athleteId = athlete.id as string;

  const todayIso = new Date().toISOString().slice(0, 10);

  // Anchor: week_start z body (przycisk "Wygeneruj" dla konkretnego tygodnia) albo bieżący tydzień.
  // PODNIESIONE PRZED fetch: okno historii (poniżej) liczy się względem planowanego tygodnia.
  const weekStartParam = typeof (body as Record<string, unknown>)?.week_start === 'string'
    ? String((body as Record<string, unknown>).week_start)
    : null;
  const weekStart = weekStartParam ? mondayOf(new Date(weekStartParam)) : mondayOf(new Date());

  // Okno historii: 14 dni wstecz od PIERWSZEGO planowanego dnia (max(weekStart, dziś)) + zapas na
  // wykrycie startu tuż sprzed okna. Bez tego generator nie miał ŻADNEGO kanału na fakt "dwa dni
  // temu był pięciogodzinny wyścig" — patrz lib/recent-load.ts.
  const planFromIso = todayIso > weekStart ? todayIso : weekStart;
  const histStartIso = new Date(Date.parse(`${planFromIso}T00:00:00Z`) - RECOVERY_CONFIG.windowDays * 86400000)
    .toISOString().slice(0, 10);

  const [{ data: fm }, { data: races }, { data: recentActs }, { data: pastRaceRows }] = await Promise.all([
    supabase
      .from('fitness_metrics')
      .select('ctl, atl, tsb')
      .eq('athlete_id', athleteId)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Pełne pola startów (ranga steruje głębokością taperu, dystans/przewyższenie → szacunek TSS).
    supabase
      .from('race_calendar')
      .select('name, date, priority, distance_km, elevation_m, discipline')
      .eq('athlete_id', athleteId)
      .gte('date', todayIso)
      .order('date', { ascending: true }),
    // Zrealizowane jazdy w oknie historii — źródło prawdy o tym, co się NAPRAWDĘ wydarzyło.
    supabase
      .from('strava_activities')
      .select('activity_date, name, type, tss, duration_seconds')
      .eq('athlete_id', athleteId)
      .gte('activity_date', histStartIso)
      .lt('activity_date', planFromIso)
      .order('activity_date', { ascending: true }),
    // Starty, które JUŻ SIĘ ODBYŁY w oknie. OSOBNE zapytanie (nie rozszerzenie zakresu tego wyżej):
    // `races` steruje wyborem najbliższego startu przez raceRows[0] — wpuszczenie tam przeszłości
    // wskazałoby jako "najbliższy" wyścig, który już był.
    supabase
      .from('race_calendar')
      .select('name, date, priority')
      .eq('athlete_id', athleteId)
      .gte('date', histStartIso)
      .lt('date', planFromIso)
      .order('date', { ascending: true }),
  ]);

  // IDEMPOTENTNY RE-CHECK (anti-double-gen dla lazy promocji szkicu). Jeśli kotwiczny tydzień ma
  // już PEŁNY plan (żaden dzień nie jest outline), ktoś go zdążył wygenerować/awansować —
  // refresh po zakończeniu albo równoległe żądanie. Nie wołaj AI drugi raz. Pusty wiersz/szkic
  // (są dni outline) → przechodzimy dalej i generujemy. Rzadkie równoległe żądania w oknie przed
  // pierwszym zapisem dadzą co najwyżej podwójny koszt AI, bez korupcji (upsert nadpisuje spójnie).
  if (!dryRun) {
    const { data: anchorRow } = await supabase
      .from('weekly_plans')
      .select('plan_json')
      .eq('athlete_id', athleteId)
      .eq('week_start', weekStart)
      .maybeSingle();
    const anchorDays = ((anchorRow?.plan_json as { days?: { outline?: boolean }[] } | null)?.days) ?? [];
    if (anchorDays.length > 0 && anchorDays.every((d) => !d.outline)) {
      return NextResponse.json({ ok: true, already_promoted: true });
    }
  }
  const ctl = fm?.ctl != null ? Number(fm.ctl) : null;
  const nextWeek = nextWeekStart(weekStart);

  // ── Wybór wyścigu dla okna planu (bieżący + next tydzień) ──
  // Preferuj wyścig, którego data wypada w oknie [weekStart, nextWeek+6]. Jeśli w oknie jest kilka —
  // najwcześniejszy. Brak w oknie → najbliższy przyszły (kontekst budowania, bez taperu/wstrzyknięcia).
  type RaceRow = { name: string; date: string; priority: RacePriority; distance_km: number | null; elevation_m: number | null; discipline: string | null };
  const raceRows = (races ?? []) as RaceRow[];
  const nextWeekEnd = (() => { const d = new Date(nextWeek + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10); })();
  const raceInWindow = raceRows.find((r) => r.date >= weekStart && r.date <= nextWeekEnd) ?? null;
  const nearestRace = raceRows[0] ?? null;
  const selRace = raceInWindow ?? nearestRace;

  const raceDowCurrent = raceInWindow ? dowInWeek(weekStart, raceInWindow.date) : null;
  const raceDowNext = raceInWindow ? dowInWeek(nextWeek, raceInWindow.date) : null;
  // Taper aktywny w bieżącym (szczegółowym) tygodniu, gdy zawiera on start rangi z taperem (A/B).
  const taperInCurrent = raceDowCurrent != null && raceInWindow != null && taperDaysFor(raceInWindow.priority) > 0;
  // Wyścig A w tygodniu ZARYSU (next) — minimum ochronne −1/−2 przez post-processing (nie taper/retry).
  // Tylko A: B (mini-taper) nie wymaga głębokiej ochrony w zarysie, dopina się w bieżącym.
  const taperInNext = raceDowNext != null && raceInWindow != null && raceInWindow.priority === 'A';

  const raceCtx: RaceContext | null = selRace
    ? {
        name: selRace.name, date: selRace.date, priority: selRace.priority,
        distanceKm: selRace.distance_km, elevationM: selRace.elevation_m, discipline: selRace.discipline,
        daysToRace: Math.round((new Date(selRace.date).getTime() - new Date(todayIso).getTime()) / 86400000),
        raceDowCurrent, taperInCurrent,
      }
    : null;

  // ── Kontekst obciążenia z PRZESZŁOŚCI (ciągłość między tygodniami) ──
  // Liczony po raceDowCurrent, bo dzień startu jest wykluczany z okna regeneracji.
  const recentLoad = buildRecentLoad({
    weekStart,
    today: todayIso,
    activities: ((recentActs ?? []) as Array<{ activity_date: string; name: string | null; type: string | null; tss: number | null; duration_seconds: number | null }>)
      .map<RecentActivity>((a) => ({
        date: a.activity_date,
        name: a.name,
        type: a.type,
        tss: a.tss != null ? Number(a.tss) : 0,
        durationSeconds: a.duration_seconds,
      })),
    pastRaces: ((pastRaceRows ?? []) as Array<{ name: string; date: string; priority: RacePriority }>)
      .map<PastRace>((r) => ({ name: r.name, date: r.date, priority: r.priority })),
    raceDowCurrent,
  });

  // Cel tygodniowy: override z body albo CTL*7*intensity (domyślnie 1.1); fallback gdy brak CTL.
  // Tydzień startowy: redukcja objętości treningowej wg rangi (dzień RACE liczony osobno, wstrzykiwany).
  // Post-race (start w bieżącym → next = regeneracja): next celuje niżej, nie w progresję +5%.
  const baseTarget = ctl != null ? Math.round(ctl * 7 * intensityMul) : 350;
  const taperFactor = taperInCurrent && raceInWindow ? taperVolumeFactor(raceInWindow.priority) : 1;
  // GŁĘBSZY z dwóch współczynników, NIE ich iloczyn. Taper (0.85) × regeneracja (0.76) = 0.65 —
  // tydzień, w którym nie ma już czego zaplanować, a model i tak musi trafić w pasmo TSS.
  // min() daje tę redukcję, która wynika z mocniejszego powodu, i zostaje sterowalny.
  const loadFactor = Math.min(taperFactor, recentLoad.tssFactor);
  // Regeneracja obniża cel TAKŻE gdy user ustawił godziny suwakiem (overrideTarget). Dni bez
  // intensywności fizycznie zabierają pojemność tygodnia — trzymanie pełnego celu zmusiłoby model
  // do upchnięcia obciążenia w pozostałe dni, czyli dokładnie tego, czemu reguła ma zapobiec.
  // Wybór usera zostaje uszanowany co do KIERUNKU (skalujemy jego liczbę, nie ignorujemy jej).
  const weeklyTssTarget = overrideTarget != null
    ? Math.round(overrideTarget * recentLoad.tssFactor)
    : Math.round(baseTarget * loadFactor);
  const nextWeeklyTssTarget = raceDowCurrent != null
    ? Math.round(baseTarget * 0.7) // start w tym tygodniu → następny tydzień regeneracyjny
    : Math.round((overrideTarget ?? baseTarget) * 1.05);

  const inputs: GeneratorInputs = {
    weekStart,
    ftp: (athlete.ftp_watts as number) ?? 250,
    mass: (athlete.weight_kg as number | null) ?? null,
    vo2max: (athlete.vo2max as number | null) ?? null,
    ctl,
    atl: fm?.atl != null ? Number(fm.atl) : null,
    tsb: fm?.tsb != null ? Number(fm.tsb) : null,
    race: raceCtx,
    weeklyTssTarget,
    nextWeeklyTssTarget,
    recentLoad,
  };

  const { system, user } = buildTwoWeekPrompt(inputs);

  // ── Wywołanie AI (jedno, zwraca oba tygodnie) z 1 retry przy błędzie walidacji ──
  let current: { days: PlanDay[]; insight: string } | undefined;
  let next: { days: PlanDay[]; insight: string } | undefined;
  let lastErr = '';
  let tokensUsed = 0;
  let aiModel = 'claude-sonnet-4-6';

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 16000, // pułap bezpieczny dla non-streaming (SDK blokuje >~16k jako "może trwać >10 min"). Rozumowanie trzymane w ryzach nudge'em o zwięzłość, inaczej proza ucina JSON — patrz KRYTYCZNE w prompt. Walidator wycina sam JSON (kotwica "current")
        system,
        messages: [{ role: 'user', content: user }],
      });
      aiModel = response.model;
      tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
      // stop_reason PRZED walidacją: ucięcie → MaxTokensError (nie ślepe parsowanie ogryzka JSON).
      assertNotTruncated(response, 16000);
      const txt = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const v = validateTwoWeekPlan(txt, weekStart, nextWeek);
      if (!v.ok || !v.current || !v.next) {
        lastErr = v.error ?? 'walidacja nieudana';
        continue;
      }
      // Walidacja przedziału TSS — bezpieczny bufor ±10/+15% (szerszy niż prompt),
      // ale blokuje rozjazd typu +36%. Poza przedziałem → retry jak błąd struktury.
      // Dzień startu WYKLUCZONY z sumy (jego TSS jest wstrzykiwany osobno, nie z celu treningowego).
      const sumCur = v.current.days.reduce((a, d) => a + (d.dow === raceDowCurrent ? 0 : d.tss), 0);
      const sumNext = v.next.days.reduce((a, d) => a + (d.dow === raceDowNext ? 0 : d.tss), 0);
      // Dolna granica rozluźniona w tygodniu z regeneracją (spójnie z pasmem w prompcie): plan
      // ZBYT LEKKI po ciężkim starcie jest bezpieczny, a odrzucanie go retry'em kończyło się 502.
      const [curLo, curHi] = tssBand(weeklyTssTarget, recentLoad.recoveryDows.length ? 0.75 : 0.90, 1.15);
      const [nxtLo, nxtHi] = tssBand(nextWeeklyTssTarget, 0.90, 1.15);
      if (sumCur < curLo || sumCur > curHi) {
        lastErr = `bieżący TSS ${sumCur} poza przedziałem ${curLo}–${curHi}`;
        continue;
      }
      if (sumNext < nxtLo || sumNext > nxtHi) {
        lastErr = `następny TSS ${sumNext} poza przedziałem ${nxtLo}–${nxtHi}`;
        continue;
      }
      // TWARDA OCHRONA OSTATNICH 48h przed startem A (dow −1/−2 tylko Z1/Z2/OFF). Nie ufamy,
      // że model posłucha promptu — intensywność na −1/−2 niszczy szczytowanie → retry jak przy TSS.
      // Sprawdzane na dniach AI PRZED wstrzyknięciem RACE (injection dotyka tylko dnia startu).
      if (taperInCurrent && raceInWindow && raceDowCurrent != null) {
        const viol = taperLast48hViolation(v.current.days, raceDowCurrent, raceInWindow.priority);
        if (viol) { lastErr = `tapering: ${viol}`; continue; }
      }
      // TWARDA OCHRONA REGENERACJI PO CIĘŻKIM WYSIŁKU — bliźniak ochrony 48h, ta sama zasada:
      // prompt to prośba, walidacja to gwarancja. Bez tego model potrafił wstawić Threshold 3×12
      // dwa dni po pięciogodzinnym starcie, bo pasmo TSS trzeba było czymś zapełnić.
      {
        const viol = recoveryViolation(v.current.days, recentLoad.recoveryDows);
        if (viol) { lastErr = `regeneracja: ${viol}`; continue; }
      }
      // Wstrzyknij dzień startu (deterministyczny szacunek) w miejsce dnia OFF, który AI zostawiło.
      if (raceInWindow) {
        const meta = raceMetaOf(raceInWindow);
        if (raceDowCurrent != null) injectRaceDay(v.current.days, raceDowCurrent, meta, raceInWindow.date);
        if (raceDowNext != null) injectRaceDay(v.next.days, raceDowNext, meta, raceInWindow.date);
      }
      // OCHRONA −1/−2 W ZARYSIE (wyścig A w tygodniu next/outline): pełny taper jeszcze się nie
      // odpalił (bramka taperInCurrent), więc model mógł dać LONG/OU/THR na −1/−2 zarysu. Nadpisujemy
      // je lekkim placeholderem (post-processing, NIE retry — zarys jest przybliżony). Whitelist
      // {OFF,Z1,Z2} respektowana z definicji. Pełny taper przyjdzie przy promocji next→current.
      if (taperInNext && raceDowNext != null) {
        for (const p of outlineTaperPlaceholders(raceDowNext, raceInWindow!.priority)) {
          const i = p.dow - 1;
          v.next.days[i] = {
            ...v.next.days[i], dow: p.dow, type: p.type as PlanDay['type'], label: p.label,
            tss: p.tss, dur_min: p.dur_min, watt: '–', hr: '–', zones: [0, 0, 0, 0, 0],
            structure: null, race: null, outline: true,
          };
        }
      }
      current = v.current;
      next = v.next;
      break;
    } catch (err: unknown) {
      // Ucięcie: 16k to sufit non-streaming SDK — ponowny 16k utnie znowu, więc BEZ retry (break),
      // czytelny błąd. (Prawdziwy fix docelowy = streaming; osobny PR.)
      if (err instanceof MaxTokensError) { lastErr = AI_TOO_LONG_MSG; break; }
      lastErr = isAiOutage(err) ? AI_UNAVAILABLE_MSG : err instanceof Error ? err.message : String(err);
    }
  }

  if (!current || !next) {
    const readable = lastErr === AI_UNAVAILABLE_MSG || lastErr === AI_TOO_LONG_MSG;
    return NextResponse.json(
      { error: readable ? lastErr : `generowanie nieudane: ${lastErr}` },
      { status: readable ? 503 : 502 }
    );
  }

  const summary = (w: { days: PlanDay[] }) => w.days.map((d) => ({
    dow: d.dow, date: d.date, type: d.type, tss: d.tss, dur_min: d.dur_min, outline: d.outline,
  }));
  const curPayload = { week_start: weekStart, total_tss: current.days.reduce((a, d) => a + d.tss, 0), insight: current.insight, days: summary(current) };
  const nextPayload = { week_start: nextWeek, total_tss: next.days.reduce((a, d) => a + d.tss, 0), insight: next.insight, days: summary(next) };

  // dry_run: zwróć wynik BEZ zapisu (test bez nadpisywania istniejącego planu)
  if (dryRun) {
    return NextResponse.json({
      ok: true, dry_run: true, target: weeklyTssTarget, next_target: nextWeeklyTssTarget,
      // Kontekst regeneracji w dry_run — bez tego nie da się sprawdzić, CZY reguła się odpaliła
      // (plan lekki „sam z siebie" wygląda identycznie jak plan lekki z wymuszenia).
      recovery: {
        dows: recentLoad.recoveryDows,
        tss_factor: recentLoad.tssFactor,
        load_factor: loadFactor,
        hard_effort: recentLoad.hardEffort,
        last7_tss: recentLoad.last7Tss,
        prev7_tss: recentLoad.prev7Tss,
      },
      current: curPayload, next: nextPayload,
    });
  }

  // ── Ręczny upsert tygodnia do weekly_plans (działa bez unique constraintu) ──
  async function upsertWeek(ws: string, days: PlanDay[], insight: string) {
    // UWAGA: `row` CELOWO nie zawiera `user_hours`. Przy promocji/regeneracji bieżący tydzień to
    // ten sam wiersz, który trzyma ręczny wybór godzin suwaka (weekly_plans.user_hours). Supabase
    // .update(row) generuje SET tylko dla podanych kluczy, więc pominięcie tej kolumny ZACHOWUJE
    // wybór usera. NIE dopisywać user_hours (ani nie zamieniać na upsert pełnego wiersza) — to po
    // cichu skasowałoby wybór godzin przy każdej regeneracji. Pominięcie jest zamierzone.
    const row = {
      athlete_id: athleteId,
      week_start: ws,
      plan_json: { days, insight },
      ctl_at_generation: inputs.ctl,
      atl_at_generation: inputs.atl,
      tsb_at_generation: inputs.tsb,
      weekly_tss_target: days.reduce((a, d) => a + d.tss, 0),
      generated_by: 'manual' as const,
      ai_model: aiModel,
      tokens_used: tokensUsed,
    };
    const { data: existing } = await supabase
      .from('weekly_plans')
      .select('id')
      .eq('athlete_id', athleteId)
      .eq('week_start', ws)
      .maybeSingle();
    if (existing) {
      return supabase.from('weekly_plans').update(row).eq('id', existing.id);
    }
    return supabase.from('weekly_plans').insert(row);
  }

  const [curRes, nextRes] = await Promise.all([
    upsertWeek(weekStart, current.days, current.insight),
    upsertWeek(nextWeek, next.days, next.insight),
  ]);
  const saveErr = curRes.error || nextRes.error;
  if (saveErr) {
    return NextResponse.json({ error: `zapis nieudany: ${saveErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, current: curPayload, next: nextPayload });
}
