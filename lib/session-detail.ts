// Rozpiska sesji "minuta po minucie" (feat/workout-detail-expand).
// Czysty moduł: bierze ExpandedSeg[] (to samo źródło, które karmi WorkoutProfile — spójność
// profil↔lista z konstrukcji) i grupuje w czytelne kroki + deterministyczne odczucia wg strefy.
// Odczucia NIE są generowane przez AI — mapa strefa→odczucie zaszyta w kodzie, więc ta sama
// strefa zawsze daje ten sam opis (amator uczy się mapować waty na odczucia, cenne bez miernika).
import type { ExpandedSeg } from '@/lib/workout';

// Progi stref (5-strefowy model wyświetlania, spójny z prompt.ts i ZoneBar):
// Z1 <56% | Z2 56–75% | Z3 76–90% | Z4 91–104% | Z5 ≥105% FTP.
export function zoneOf(pctFtp: number): 1 | 2 | 3 | 4 | 5 {
  if (pctFtp < 56) return 1;
  if (pctFtp < 76) return 2;
  if (pctFtp < 91) return 3;
  if (pctFtp < 105) return 4;
  return 5;
}

// Deterministyczna mapa strefa→odczucie (SST≈Z3, THR≈Z4, VO2≈Z5). Jedno źródło, zero AI.
export const ZONE_FEELING: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'bardzo lekko, swobodna rozmowa',
  2: 'spokojnie, pełne zdania bez zadyszki',
  3: 'stabilny wysiłek, krótkie zdania',
  4: 'mocno, na granicy komfortu, oddech ciężki',
  5: 'bardzo mocno, ostatnie sekundy bolą — o to chodzi',
};

export function feelingOf(pctFtp: number): string {
  return ZONE_FEELING[zoneOf(pctFtp)];
}

// Pojedynczy odcinek wewnątrz jednostki serii (under/over/work).
export interface CycleSeg {
  role: 'under' | 'over' | 'work';
  min: number;
  watts: number;
  zone: 1 | 2 | 3 | 4 | 5;
  feeling: string;
  label?: string; // dla zgrupowanego bloku (reps/cycles > próg), gdy segment jest zwinięty
}

export type SessionStep =
  // Prosty odcinek ciągły: rozgrzewka / część główna / schłodzenie / samotna przerwa.
  | { kind: 'simple'; title: string; min: number; watts: number; zone: 1 | 2 | 3 | 4 | 5; feeling: string }
  // Seria powtarzalnych jednostek (interwały THR/VO2/SST albo bloki OU), z przerwą między nimi.
  | {
      kind: 'series';
      unitLabel: 'blok' | 'interwał';
      count: number;          // ile jednostek (bloków/interwałów)
      restMin: number | null; // przerwa Z1 między jednostkami
      cycleCount: number;     // ile cykli w JEDNEJ jednostce (OU: cykli w bloku; interwał: 1)
      cycles: CycleSeg[];     // wzorzec JEDNEJ jednostki (OU: [under, over]; interwał: [work])
    };

const WORK_KINDS = new Set(['under', 'over', 'work']);
const TITLE: Record<string, string> = { warmup: 'Rozgrzewka', cooldown: 'Schłodzenie', steady: 'Część główna', rest: 'Przerwa' };

function toCycle(s: ExpandedSeg, ftp: number): CycleSeg {
  // Dokładne waty ze structure gdy są (bez round-tripu przez %); fallback = z %FTP (stare plany).
  const watts = s.watts ?? Math.round((ftp * s.pctFtp) / 100);
  return {
    role: (s.kind === 'under' || s.kind === 'over') ? s.kind : 'work',
    min: s.min,
    watts,
    zone: zoneOf(s.pctFtp),
    feeling: feelingOf(s.pctFtp),
    ...(s.label ? { label: s.label } : {}),
  };
}

// Grupuje ExpandedSeg[] w kroki. Prosty odcinek → simple; ciąg under/over/work rozdzielony
// przerwami → series (jednostki = grupy pracy między przerwami, przerwa = restMin).
export function buildSessionSteps(expanded: ExpandedSeg[], ftp: number): SessionStep[] {
  const steps: SessionStep[] = [];
  let i = 0;
  while (i < expanded.length) {
    const seg = expanded[i];

    if (!WORK_KINDS.has(seg.kind)) {
      // warmup / cooldown / steady / samotny rest
      steps.push({ kind: 'simple', title: TITLE[seg.kind] ?? seg.kind, min: seg.min, watts: Math.round((ftp * seg.pctFtp) / 100), zone: zoneOf(seg.pctFtp), feeling: feelingOf(seg.pctFtp) });
      i++;
      continue;
    }

    // Zbierz ciąg pracy (under/over/work + przeplatane rest) w jednostki rozdzielone przerwami.
    const units: ExpandedSeg[][] = [];
    const restMins: number[] = [];
    let cur: ExpandedSeg[] = [];
    let j = i;
    while (j < expanded.length && (WORK_KINDS.has(expanded[j].kind) || expanded[j].kind === 'rest')) {
      if (expanded[j].kind === 'rest') {
        if (cur.length) { units.push(cur); cur = []; }
        restMins.push(expanded[j].min);
      } else {
        cur.push(expanded[j]);
      }
      j++;
    }
    if (cur.length) units.push(cur);

    const unit = units[0] ?? [];
    const hasOu = unit.some((u) => u.kind === 'under' || u.kind === 'over');
    // OU: jednostka = blok, cykl = para under+over → cycleCount = liczba under w bloku.
    // THR/VO2/SST: jednostka = interwał, cykl = pojedyncza praca → cycleCount = 1.
    const cycleCount = hasOu ? unit.filter((u) => u.kind === 'under').length || 1 : 1;
    const cycles: CycleSeg[] = hasOu
      ? [unit.find((u) => u.kind === 'under'), unit.find((u) => u.kind === 'over')].filter(Boolean).map((u) => toCycle(u as ExpandedSeg, ftp))
      : unit.map((u) => toCycle(u, ftp));

    steps.push({
      kind: 'series',
      unitLabel: hasOu ? 'blok' : 'interwał',
      count: units.length,
      restMin: restMins.length ? restMins[0] : null,
      cycleCount,
      cycles,
    });
    i = j;
  }
  return steps;
}
