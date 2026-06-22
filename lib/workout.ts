import { C } from '@/lib/theme';

// Deterministyczny generator rozpiski treningu (ETAP 5.4) — port buildWorkout z mockupu.
// Struktura interwałów parsowana z labela ("Threshold 2×15min" → 2×15), żeby rozpiska
// ZGADZAŁA się z tym co mówi label. Moc liczona z FTP przekazanego z bazy (zero hardcode).

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

export interface Workout {
  segs: WorkoutSegment[];
  goal: string;
  tips: string[];
  nutrition: Nutrition | null;
}

export interface WorkoutInput {
  type: string;
  label: string;
  dur_min: number;
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
  const struct = parseStructure(d.label) ?? DEFAULT_STRUCT[T] ?? null;
  const ivT = struct ? `${struct.reps}×${struct.minutes} min` : '';

  const segs: WorkoutSegment[] = [];
  let goal = '';
  let tips: string[] = [];

  if (T === 'Z1') {
    segs.push({ k: 'Cała jazda', t: `${dur} min`, w: wr(45, 55), hr: '<125', c: C.muted, note: 'luźna kadencja 85–95' });
    goal = 'Regeneracja aktywna — rozruszanie nóg, przepływ krwi. Zero pracy na mocy.';
    tips = ['Jeśli czujesz pokusę „docisnąć" — nie rób tego, dziś chodzi o odbudowę.', 'Płaski teren, równe tempo.'];
  } else if (T === 'Z2') {
    const main = dur - 25;
    segs.push({ k: 'Rozgrzewka', t: '15 min', w: wr(50, 60), hr: '120–135', c: C.green, note: 'narastająco' });
    segs.push({ k: 'Część główna', t: `${main} min`, w: wr(56, 75), hr: '128–145', c: C.cyan, note: 'stałe tempo, kadencja 90+' });
    segs.push({ k: 'Schłodzenie', t: '10 min', w: wr(45, 55), hr: '<125', c: C.muted });
    goal = 'Baza tlenowa i ekonomia. Trzymaj równe Z2 — nie wpadaj w Z3.';
    tips = ['Oddech swobodny, powinieneś móc rozmawiać.', 'Trzymaj równe tempo — to nie wyścig, buduj bazę.'];
  } else if (T === 'SST') {
    segs.push({ k: 'Rozgrzewka', t: '20 min', w: wr(50, 65), hr: '120–140', c: C.green, note: '+ 3×30s narastająco' });
    segs.push({ k: 'Interwały', t: ivT, w: wr(88, 94), hr: '155–168', c: C.yellow, note: 'sweet spot · przerwy 5 min Z1', reps: true });
    segs.push({ k: 'Schłodzenie', t: '10 min', w: wr(45, 55), hr: '<125', c: C.muted });
    goal = 'Próg bez nadmiernego zmęczenia — najlepszy stosunek bodziec/koszt.';
    tips = ['Kadencja 85–90.', 'Moc równa przez cały interwał, nie zaczynaj za mocno.'];
  } else if (T === 'THR') {
    segs.push({ k: 'Rozgrzewka', t: '25 min', w: wr(50, 65), hr: '120–145', c: C.green, note: '+ 3×(10s @110% openery)' });
    segs.push({ k: 'Interwały', t: ivT, w: wr(95, 102), hr: '162–174', c: C.yellow, note: 'próg · przerwy 6 min Z1', reps: true });
    segs.push({ k: 'Schłodzenie', t: '10 min', w: wr(45, 55), hr: '<125', c: C.muted });
    goal = 'Podniesienie FTP — to Twoja luka. Trzymaj moc równo aż do końca każdego bloku.';
    tips = ['Ostatnie 3 min są najważniejsze — nie odpuszczaj.', 'Jeśli moc spada >5% w 2. bloku, skróć ostatni interwał.'];
  } else if (T === 'OU') {
    segs.push({ k: 'Rozgrzewka', t: '25 min', w: wr(50, 65), hr: '120–145', c: C.green, note: '+ 3×(10s @110% openery)' });
    segs.push({ k: 'Interwały', t: ivT, w: `${w(95)}/${w(110)}W`, hr: '155–177', c: '#C68A4E', note: 'under 95% / over 110% · przerwy 5 min Z1', reps: true });
    segs.push({ k: 'Schłodzenie', t: '10 min', w: wr(45, 55), hr: '<125', c: C.muted });
    goal = 'Tolerancja mleczanu i moc progowa. „Over" boli, ale „under" to Twój aktywny odpoczynek.';
    tips = ['Nie zwalniaj na under — to ma być wciąż 95% FTP.', 'Jeśli over przestaje być osiągalny, zakończ blok wcześniej.'];
  } else if (T === 'VO2') {
    segs.push({ k: 'Rozgrzewka', t: '25 min', w: wr(50, 65), hr: '120–150', c: C.green, note: '+ 3×(15s @120% openery)' });
    segs.push({ k: 'Interwały', t: ivT, w: wr(110, 120), hr: '175–186', c: C.red, note: 'VO2max · przerwy równe (1:1) Z1', reps: true });
    segs.push({ k: 'Schłodzenie', t: '10 min', w: wr(45, 55), hr: '<125', c: C.muted });
    goal = 'Pułap tlenowy. Pierwsze 2 powtórzenia mają wydawać się „za łatwe".';
    tips = ['Buduj moc przez pierwsze 30s, potem trzymaj.', 'Jeśli ostatnie powtórzenie się sypie, zrób jedno mniej — jakość > ilość.'];
  } else if (T === 'LONG') {
    const main = dur - 30;
    segs.push({ k: 'Rozgrzewka', t: '20 min', w: wr(45, 60), hr: '115–135', c: C.green, note: 'Z1→Z2' });
    segs.push({ k: 'Część główna', t: `${main} min`, w: wr(56, 72), hr: '130–148', c: C.cyan, note: 'Z2 z naturalnymi podjazdami' });
    segs.push({ k: 'Opcja (jeśli świeży)', t: '2×20 min', w: wr(76, 85), hr: '148–160', c: C.yellow, note: 'Z3 w środku jazdy' });
    segs.push({ k: 'Schłodzenie', t: '10 min', w: wr(45, 55), hr: '<125', c: C.muted });
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

  return { segs, goal, tips, nutrition };
}
