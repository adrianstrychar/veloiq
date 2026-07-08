import { C } from '@/lib/theme';
import { type DayStructure, isOU, ouBlockMin } from '@/lib/structure';

// Deterministyczny generator rozpiski treningu (ETAP 5.4) — port buildWorkout z mockupu.
// Dni ze `structure` (nowy kontrakt): rozpiska i profil budowane Z PARAMETRÓW (buildFromStructure)
// — label, tekst i rysunek z jednego źródła. Dni bez structure (stare tygodnie): fallback do
// syntezy z labela ("Threshold 2×15min" → 2×15) + zaszytych defaultów, jak dotąd.

export interface WorkoutSegment {
  k: string;            // nazwa segmentu
  t: string;            // czas / struktura ("2×15 min")
  w: string;            // moc ("280–301W")
  hr: string;           // tętno
  c: string;            // kolor akcentu
  note?: string;
  reps?: boolean;       // czy to interwały (znacznik ●)
}

export interface Nutrition {
  drink: string;
  food: string;
  note: string;
  short?: boolean;
}

// Atomowy segment profilu wizualnego (ETAP 5.4b). Profil rysuje z `expanded`,
// lista tekstowa nadal z `segs`. `color` ustawia buildWorkout (zna typ).
export interface ExpandedSeg {
  kind: 'warmup' | 'cooldown' | 'rest' | 'work' | 'under' | 'over' | 'steady';
  min: number;      // czas → SZEROKOŚĆ
  pctFtp: number;   // średnia moc %FTP → WYSOKOŚĆ (całkowity % — do rysunku)
  color: string;
  label?: string;   // tylko dla zgrupowanego bloku, np. "10×1min"
  watts?: number;   // DOKŁADNE waty ze structure (bez round-tripu przez %). Ustawiane w buildFromStructure
                    // dla segmentów pracy; lista i profil pokazują je 1:1 z planem (fidelity co do wata).
}

export interface Workout {
  segs: WorkoutSegment[];
  goal: string;
  tips: string[];
  nutrition: Nutrition | null;
  expanded: ExpandedSeg[];
}

// Kolory profilu (lib/theme + strefowe). FTP_LINE używana też w WorkoutProfile.
const PC = {
  gray: '#3A4A5C',   // rozgrzewka / schłodzenie / przerwa
  z2: '#5B9B7E',     // endurance
  yellow: '#C99A4E', // SST / THR / OU under
  over: '#C68A4E',   // OU over
  vo2: '#C76B6B',    // VO2max
};
export const FTP_LINE_COLOR = '#4A8FC7';

// Powyżej tylu powtórzeń w JEDNEJ serii → zwiń w zgrupowany blok z etykietą.
const REPS_GROUP_THRESHOLD = 8;

// Profil ze `structure` (nowy kontrakt): segmenty budowane Z PARAMETRÓW, moc = %FTP z realnych
// watów. Zero założeń o proporcji under/over czy długości przerw — wszystko przychodzi w danych.
function buildFromStructure(d: WorkoutInput, s: DayStructure, ftp: number): ExpandedSeg[] {
  const ss = sessionStructure(d.type);
  const wUsed = d.warmup ?? ss.warmupDefault;
  const cUsed = d.cooldown ?? ss.cooldownDefault;
  const pct = (watts: number) => Math.round((watts / ftp) * 100);
  const segs: ExpandedSeg[] = [];
  segs.push({ kind: 'warmup', min: wUsed, pctFtp: 58, color: PC.gray });

  if (isOU(s)) {
    for (let b = 0; b < s.reps; b++) {
      if (s.cycles > REPS_GROUP_THRESHOLD) {
        segs.push({ kind: 'over', min: ouBlockMin(s), pctFtp: pct(s.over_w), watts: s.over_w, color: PC.over, label: `${s.cycles}×${s.under_min}/${s.over_min}` });
      } else {
        for (let j = 0; j < s.cycles; j++) {
          segs.push({ kind: 'under', min: s.under_min, pctFtp: pct(s.under_w), watts: s.under_w, color: PC.yellow });
          segs.push({ kind: 'over', min: s.over_min, pctFtp: pct(s.over_w), watts: s.over_w, color: PC.over });
        }
      }
      if (b < s.reps - 1) segs.push({ kind: 'rest', min: s.rest_min, pctFtp: 50, color: PC.gray });
    }
  } else {
    const workColor = d.type === 'VO2' ? PC.vo2 : PC.yellow;
    if (s.reps > REPS_GROUP_THRESHOLD) {
      const totalWork = s.reps * s.work_min + (s.reps - 1) * s.rest_min;
      segs.push({ kind: 'work', min: totalWork, pctFtp: pct(s.work_w), watts: s.work_w, color: workColor, label: `${s.reps}×${s.work_min}min` });
    } else {
      for (let i = 0; i < s.reps; i++) {
        segs.push({ kind: 'work', min: s.work_min, pctFtp: pct(s.work_w), watts: s.work_w, color: workColor });
        if (i < s.reps - 1) segs.push({ kind: 'rest', min: s.rest_min, pctFtp: 50, color: PC.gray });
      }
    }
  }

  segs.push({ kind: 'cooldown', min: cUsed, pctFtp: 50, color: PC.gray });
  return segs;
}

// Buduje atomową listę segmentów profilu per typ.
function buildExpanded(d: WorkoutInput, struct: { reps: number; minutes: number } | null): ExpandedSeg[] {
  const T = d.type;
  const dur = d.dur_min;
  const ss = sessionStructure(T);
  const wUsed = d.warmup ?? ss.warmupDefault;
  const cUsed = d.cooldown ?? ss.cooldownDefault;
  const segs: ExpandedSeg[] = [];
  const warmup = (min: number, pct: number) => segs.push({ kind: 'warmup', min, pctFtp: pct, color: PC.gray });
  const cooldown = () => segs.push({ kind: 'cooldown', min: cUsed, pctFtp: 50, color: PC.gray });
  const rest = (min: number) => segs.push({ kind: 'rest', min, pctFtp: 50, color: PC.gray });

  if (T === 'OFF') return [];
  if (T === 'Z1') {
    segs.push({ kind: 'steady', min: dur, pctFtp: 50, color: PC.gray });
    return segs;
  }
  if (T === 'Z2') {
    warmup(wUsed, 55);
    segs.push({ kind: 'steady', min: Math.max(10, dur - wUsed - cUsed), pctFtp: 65, color: PC.z2 });
    cooldown();
    return segs;
  }
  if (T === 'LONG') {
    warmup(wUsed, 52);
    segs.push({ kind: 'steady', min: Math.max(20, dur - wUsed - cUsed - 20), pctFtp: 64, color: PC.z2 });
    segs.push({ kind: 'steady', min: 20, pctFtp: 80, color: PC.yellow }); // opcjonalny akcent Z3
    cooldown();
    return segs;
  }

  // Typy interwałowe — fallback struktury gdy label bez N×M
  const s = struct ?? { reps: 3, minutes: T === 'VO2' ? 4 : 12 };
  warmup(wUsed, 58);

  if (T === 'OU') {
    // ZAŁOŻENIE: 1 cykl OU = 3 min under + 1 min over (4 min), więc P = round(M/4).
    // To jest zaszyte na sztywno (zgodne z obecnym generatorem 3×(3+1)). Gdyby
    // generator kiedyś dał inny stosunek under/over, trzeba go parsować z labela.
    const UNDER_MIN = 3, OVER_MIN = 1, CELL = UNDER_MIN + OVER_MIN;
    for (let b = 0; b < s.reps; b++) {
      const P = Math.max(1, Math.round(s.minutes / CELL));
      if (P > REPS_GROUP_THRESHOLD) {
        segs.push({ kind: 'over', min: s.minutes, pctFtp: 103, color: PC.over, label: `${P}×${UNDER_MIN}/${OVER_MIN}` });
      } else {
        for (let j = 0; j < P; j++) {
          segs.push({ kind: 'under', min: UNDER_MIN, pctFtp: 95, color: PC.yellow });
          segs.push({ kind: 'over', min: OVER_MIN, pctFtp: 110, color: PC.over });
        }
      }
      if (b < s.reps - 1) rest(5);
    }
    cooldown();
    return segs;
  }

  // THR / SST / VO2 — jedna seria N powtórzeń.
  // THR=100% (próg = na linii FTP), SST=91% (wyraźnie pod), VO2=115% (wysoko nad).
  const workPct = T === 'SST' ? 91 : T === 'VO2' ? 115 : 100;
  const workColor = T === 'VO2' ? PC.vo2 : PC.yellow;
  const restMin = T === 'SST' ? 5 : T === 'VO2' ? s.minutes : 6; // VO2 przerwy 1:1
  if (s.reps > REPS_GROUP_THRESHOLD) {
    const totalWork = s.reps * s.minutes + (s.reps - 1) * restMin;
    segs.push({ kind: 'work', min: totalWork, pctFtp: workPct, color: workColor, label: `${s.reps}×${s.minutes}min` });
  } else {
    for (let i = 0; i < s.reps; i++) {
      segs.push({ kind: 'work', min: s.minutes, pctFtp: workPct, color: workColor });
      if (i < s.reps - 1) rest(restMin);
    }
  }
  cooldown();
  return segs;
}

export interface WorkoutInput {
  type: string;
  label: string;
  dur_min: number;
  warmup?: number;   // nadpisanie rozgrzewki (min) — z suwaka godzin (scaleWeek)
  cooldown?: number; // nadpisanie schłodzenia (min)
  structure?: DayStructure | null; // parametry substruktury z plan_json (brak = stary plan → fallback)
}

// Zakresy i domyślne rozgrzewki/schłodzenia per typ (minuty). Domyślne = obecne
// stałe z buildWorkout/buildExpanded, więc bez suwaka nic się nie zmienia.
export interface SessionStructure {
  warmupMin: number; warmupMax: number; warmupDefault: number;
  cooldownMin: number; cooldownMax: number; cooldownDefault: number;
}
const SESSION_STRUCT: Record<string, SessionStructure> = {
  OFF:  { warmupMin: 0,  warmupMax: 0,  warmupDefault: 0,  cooldownMin: 0,  cooldownMax: 0,  cooldownDefault: 0 },
  Z1:   { warmupMin: 0,  warmupMax: 0,  warmupDefault: 0,  cooldownMin: 0,  cooldownMax: 0,  cooldownDefault: 0 },
  Z2:   { warmupMin: 10, warmupMax: 25, warmupDefault: 15, cooldownMin: 5,  cooldownMax: 15, cooldownDefault: 10 },
  SST:  { warmupMin: 10, warmupMax: 25, warmupDefault: 20, cooldownMin: 5,  cooldownMax: 15, cooldownDefault: 10 },
  THR:  { warmupMin: 15, warmupMax: 30, warmupDefault: 25, cooldownMin: 5,  cooldownMax: 15, cooldownDefault: 10 },
  OU:   { warmupMin: 15, warmupMax: 30, warmupDefault: 25, cooldownMin: 5,  cooldownMax: 15, cooldownDefault: 10 },
  VO2:  { warmupMin: 15, warmupMax: 30, warmupDefault: 25, cooldownMin: 5,  cooldownMax: 15, cooldownDefault: 10 },
  LONG: { warmupMin: 15, warmupMax: 30, warmupDefault: 20, cooldownMin: 10, cooldownMax: 20, cooldownDefault: 10 },
};
const DEFAULT_SESSION_STRUCT: SessionStructure =
  { warmupMin: 15, warmupMax: 30, warmupDefault: 20, cooldownMin: 5, cooldownMax: 15, cooldownDefault: 10 };

export function sessionStructure(type: string): SessionStructure {
  return SESSION_STRUCT[type] ?? DEFAULT_SESSION_STRUCT;
}

// Wyciąga "N×Mmin" z labela → { reps, minutes }. Null gdy brak struktury.
export function parseStructure(label: string): { reps: number; minutes: number } | null {
  const m = label.match(/(\d+)\s*[×x]\s*(\d+)\s*min/i);
  if (!m) return null;
  return { reps: parseInt(m[1], 10), minutes: parseInt(m[2], 10) };
}

const DEFAULT_STRUCT: Record<string, { reps: number; minutes: number }> = {
  SST: { reps: 3, minutes: 12 },
  THR: { reps: 3, minutes: 15 },
  OU: { reps: 3, minutes: 12 },
  VO2: { reps: 5, minutes: 4 },
};

export function buildWorkout(d: WorkoutInput, ftp: number): Workout {
  const w = (pct: number) => Math.round((ftp * pct) / 100);
  const wr = (a: number, b: number) => `${w(a)}–${w(b)}W`;
  const T = d.type;
  const dur = d.dur_min;
  const ss = sessionStructure(T);
  const wUsed = d.warmup ?? ss.warmupDefault;     // rozgrzewka (z suwaka lub domyślna)
  const cUsed = d.cooldown ?? ss.cooldownDefault; // schłodzenie
  // Substruktura: parametry z plan_json (jedno źródło prawdy) albo fallback z labela/defaultów.
  const sOU = d.structure && isOU(d.structure) ? d.structure : null;
  const sWork = d.structure && !isOU(d.structure) ? d.structure : null;
  const struct = d.structure
    ? { reps: d.structure.reps, minutes: sOU ? ouBlockMin(sOU) : sWork!.work_min }
    : parseStructure(d.label) ?? DEFAULT_STRUCT[T] ?? null;
  const ivT = struct ? `${struct.reps}×${struct.minutes} min` : '';

  const segs: WorkoutSegment[] = [];
  let goal = '';
  let tips: string[] = [];

  if (T === 'Z1') {
    segs.push({ k: 'Cała jazda', t: `${dur} min`, w: wr(45, 55), hr: '<125', c: C.muted, note: 'luźna kadencja 85–95' });
    goal = 'Regeneracja aktywna — rozruszanie nóg, przepływ krwi. Zero pracy na mocy.';
    tips = ['Jeśli czujesz pokusę „docisnąć" — nie rób tego, dziś chodzi o odbudowę.', 'Płaski teren, równe tempo.'];
  } else if (T === 'Z2') {
    const main = Math.max(10, dur - wUsed - cUsed);
    segs.push({ k: 'Rozgrzewka', t: `${wUsed} min`, w: wr(50, 60), hr: '120–135', c: C.green, note: 'narastająco' });
    segs.push({ k: 'Część główna', t: `${main} min`, w: wr(56, 75), hr: '128–145', c: C.cyan, note: 'stałe tempo, kadencja 90+' });
    segs.push({ k: 'Schłodzenie', t: `${cUsed} min`, w: wr(45, 55), hr: '<125', c: C.muted });
    goal = 'Baza tlenowa i ekonomia. Trzymaj równe Z2 — nie wpadaj w Z3.';
    tips = ['Oddech swobodny, powinieneś móc rozmawiać.', 'Trzymaj równe tempo — to nie wyścig, buduj bazę.'];
  } else if (T === 'SST') {
    segs.push({ k: 'Rozgrzewka', t: `${wUsed} min`, w: wr(50, 65), hr: '120–140', c: C.green, note: '+ 3×30s narastająco' });
    segs.push({ k: 'Interwały', t: ivT, w: sWork ? `${sWork.work_w}W` : wr(88, 94), hr: '155–168', c: C.yellow, note: `sweet spot · przerwy ${sWork ? sWork.rest_min : 5} min Z1`, reps: true });
    segs.push({ k: 'Schłodzenie', t: `${cUsed} min`, w: wr(45, 55), hr: '<125', c: C.muted });
    goal = 'Próg bez nadmiernego zmęczenia — najlepszy stosunek bodziec/koszt.';
    tips = ['Kadencja 85–90.', 'Moc równa przez cały interwał, nie zaczynaj za mocno.'];
  } else if (T === 'THR') {
    segs.push({ k: 'Rozgrzewka', t: `${wUsed} min`, w: wr(50, 65), hr: '120–145', c: C.green, note: '+ 3×(10s @110% openery)' });
    segs.push({ k: 'Interwały', t: ivT, w: sWork ? `${sWork.work_w}W` : wr(95, 102), hr: '162–174', c: C.yellow, note: `próg · przerwy ${sWork ? sWork.rest_min : 6} min Z1`, reps: true });
    segs.push({ k: 'Schłodzenie', t: `${cUsed} min`, w: wr(45, 55), hr: '<125', c: C.muted });
    goal = 'Podniesienie FTP — to Twoja luka. Trzymaj moc równo aż do końca każdego bloku.';
    tips = ['Ostatnie 3 min są najważniejsze — nie odpuszczaj.', 'Jeśli moc spada >5% w 2. bloku, skróć ostatni interwał.'];
  } else if (T === 'OU') {
    segs.push({ k: 'Rozgrzewka', t: `${wUsed} min`, w: wr(50, 65), hr: '120–145', c: C.green, note: '+ 3×(10s @110% openery)' });
    segs.push({
      k: 'Interwały', t: ivT,
      w: sOU ? `${sOU.under_w}/${sOU.over_w}W` : `${w(95)}/${w(110)}W`,
      hr: '155–177', c: '#C68A4E',
      note: sOU
        ? `${sOU.cycles}× (${sOU.under_min}min @${sOU.under_w}W + ${sOU.over_min}min @${sOU.over_w}W) · przerwy ${sOU.rest_min} min Z1`
        : 'under 95% / over 110% · przerwy 5 min Z1',
      reps: true,
    });
    segs.push({ k: 'Schłodzenie', t: `${cUsed} min`, w: wr(45, 55), hr: '<125', c: C.muted });
    goal = 'Tolerancja mleczanu i moc progowa. „Over" boli, ale „under" to Twój aktywny odpoczynek.';
    tips = ['Nie zwalniaj na under — to ma być wciąż 95% FTP.', 'Jeśli over przestaje być osiągalny, zakończ blok wcześniej.'];
  } else if (T === 'VO2') {
    segs.push({ k: 'Rozgrzewka', t: `${wUsed} min`, w: wr(50, 65), hr: '120–150', c: C.green, note: '+ 3×(15s @120% openery)' });
    segs.push({ k: 'Interwały', t: ivT, w: sWork ? `${sWork.work_w}W` : wr(110, 120), hr: '175–186', c: C.red, note: `VO2max · przerwy ${sWork ? `${sWork.rest_min} min` : 'równe (1:1)'} Z1`, reps: true });
    segs.push({ k: 'Schłodzenie', t: `${cUsed} min`, w: wr(45, 55), hr: '<125', c: C.muted });
    goal = 'Pułap tlenowy. Pierwsze 2 powtórzenia mają wydawać się „za łatwe".';
    tips = ['Buduj moc przez pierwsze 30s, potem trzymaj.', 'Jeśli ostatnie powtórzenie się sypie, zrób jedno mniej — jakość > ilość.'];
  } else if (T === 'LONG') {
    const main = Math.max(20, dur - wUsed - cUsed - 20);
    segs.push({ k: 'Rozgrzewka', t: `${wUsed} min`, w: wr(45, 60), hr: '115–135', c: C.green, note: 'Z1→Z2' });
    segs.push({ k: 'Część główna', t: `${main} min`, w: wr(56, 72), hr: '130–148', c: C.cyan, note: 'Z2 z naturalnymi podjazdami' });
    segs.push({ k: 'Opcja (jeśli świeży)', t: '2×20 min', w: wr(76, 85), hr: '148–160', c: C.yellow, note: 'Z3 w środku jazdy' });
    segs.push({ k: 'Schłodzenie', t: `${cUsed} min`, w: wr(45, 55), hr: '<125', c: C.muted });
    goal = 'Wytrzymałość i ekonomia tłuszczowa. Długo i równo, kontrolowane tempo.';
    tips = ['Ostatnia godzina ma być tak samo mocna jak pierwsza.', 'Nie zaczynaj za szybko — rozłóż siły na cały dystans.'];
  }

  // ── Odżywianie: picie + jedzenie wg czasu i intensywności ──
  const h = dur / 60;
  const intense = ['THR', 'OU', 'VO2', 'SST'].includes(T);
  let nutrition: Nutrition | null;
  if (dur === 0) {
    nutrition = null; // OFF
  } else if (dur < 75 && T !== 'LONG') {
    const bidony = Math.max(1, Math.round(dur / 45));
    nutrition = {
      drink: `${bidony} bidon${bidony > 1 ? 'y' : ''} · woda lub izotonik`,
      food: 'Nie trzeba — za krótko',
      note: 'Najedz się 2h przed wyjazdem. Na rowerze wystarczy woda.',
      short: true,
    };
  } else {
    const carbPerH = intense ? 60 : h < 2.5 ? 50 : 70;
    const totalCarb = Math.round(carbPerH * h);
    const gele = Math.round(totalCarb / 25);
    const mlPerH = intense ? 700 : 600;
    const totalMl = Math.round(mlPerH * h);
    const bidony = Math.max(1, Math.round(totalMl / 600));
    nutrition = {
      drink: `${bidony} bidony · ~${(totalMl / 1000).toFixed(1)}l izotonik + woda`,
      food: `~${totalCarb}g węgli · ${gele} żele (lub żel + baton)`,
      note: `Jedz ${carbPerH}g na godzinę, zacznij po ~45 min. Pij łyk co 10–15 min.`,
    };
  }

  // Profil: ze structure gdy jest (te same parametry co tekst wyżej), inaczej dotychczasowa synteza.
  const expanded = d.structure ? buildFromStructure(d, d.structure, ftp) : buildExpanded(d, struct);
  return { segs, goal, tips, nutrition, expanded };
}
