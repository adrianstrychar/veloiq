// Profil mocy: krzywa najlepszych mocy (ostatnie 12 miesięcy vs ostatnie 4 tygodnie), W/kg,
// typ kolarza (na czym zyskujesz w wyścigu), słabsza strona oraz CP / W′ (moc krytyczna i rezerwa
// beztlenowa z 5 i 20 min). Wszystko z best_efforts, które już liczymy dla każdej jazdy.

export const PROFILE_DURS = [
  { key: '5s', sec: 5, label: '5 s' },
  { key: '15s', sec: 15, label: '15 s' },
  { key: '1min', sec: 60, label: '1 min' },
  { key: '5min', sec: 300, label: '5 min' },
  { key: '10min', sec: 600, label: '10 min' },
  { key: '20min', sec: 1200, label: '20 min' },
  { key: '1h', sec: 3600, label: '60 min' },
] as const;

// Punkt odniesienia: wartości z górnego końca tabel profilu mocy (W/kg, mężczyźni, poziom światowy).
// Liczy się PROPORCJA między czasami, nie wynik bezwzględny – stąd typ kolarza.
const REF_WKG: Record<string, number> = { '5s': 24.0, '1min': 11.5, '5min': 7.6, '20min': 6.7 };

export interface ProfileRow { date: string; best_efforts: Record<string, number | null> | null }

export interface PowerProfile {
  curve: { key: string; label: string; sec: number; year: number | null; recent: number | null; pctOfYear: number | null; wkg: number | null }[];
  type: { name: string; desc: string } | null;
  weakness: string | null;
  cp: number | null;      // W
  wPrime: number | null;  // kJ
  hasRecent: boolean;
}

const TYPES: Record<string, { name: string; desc: string }> = {
  '5s': { name: 'Sprinter', desc: 'Najmocniejszy w krótkich zrywach – finisz z grupy, skok na premię.' },
  '1min': { name: 'Puncher', desc: 'Mocny w atakach do 1–2 min – krótkie podjazdy i odskoki.' },
  '5min': { name: 'Atakujący', desc: 'Najlepszy w 3–8-minutowych wysiłkach – ścianki, odjazdy, pogoń.' },
  '20min': { name: 'Wytrzymały', desc: 'Najmocniejszy w długich wysiłkach – długie podjazdy i jazda w tempie.' },
};
const WEAK: Record<string, string> = {
  '5s': 'sprint (5 s) – krótkie, maksymalne zrywy',
  '1min': 'ataki do 1 min – interwały 30 s–1 min',
  '5min': 'wysiłki 3–8 min (VO2max)',
  '20min': 'długa moc progowa – interwały 10–20 min w okolicy FTP',
};

export function computePowerProfile(rows: ProfileRow[], today: string, weightKg: number | null): PowerProfile {
  const t = new Date(today + 'T12:00:00Z').getTime();
  const yearFrom = new Date(t - 365 * 86400_000).toISOString().slice(0, 10);
  const recentFrom = new Date(t - 28 * 86400_000).toISOString().slice(0, 10);
  const best = (from: string, key: string) => {
    let b: number | null = null;
    for (const r of rows) {
      if (!r.best_efforts || r.date < from || r.date > today) continue;
      const v = r.best_efforts[key];
      if (v != null && v > 0 && (b == null || v > b)) b = v;
    }
    return b;
  };
  const curve = PROFILE_DURS.map((d) => {
    const year = best(yearFrom, d.key), recent = best(recentFrom, d.key);
    return {
      key: d.key, label: d.label, sec: d.sec, year, recent,
      pctOfYear: year && recent ? Math.round((recent / year) * 100) : null,
      wkg: year && weightKg ? Math.round((year / weightKg) * 100) / 100 : null,
    };
  });
  const val = (k: string) => curve.find((c) => c.key === k)?.year ?? null;

  // typ kolarza: która moc jest najbliżej poziomu światowego (proporcjonalnie), słabsza strona: najdalej
  let type: PowerProfile['type'] = null, weakness: string | null = null;
  if (weightKg) {
    const scores = Object.keys(REF_WKG)
      .map((k) => ({ k, s: val(k) != null ? (val(k)! / weightKg) / REF_WKG[k] : null }))
      .filter((x): x is { k: string; s: number } => x.s != null);
    if (scores.length >= 3) {
      const hi = scores.reduce((a, b) => (b.s > a.s ? b : a));
      const lo = scores.reduce((a, b) => (b.s < a.s ? b : a));
      if (hi.s - lo.s < 0.05) type = { name: 'Wszechstronny', desc: 'Równy profil – dobrze sobie radzisz w każdym typie wysiłku.' };
      else {
        type = TYPES[hi.k];
        if (hi.k === '20min' && weightKg < 68) type = { name: 'Góral', desc: 'Długa moc przy niskiej wadze – długie podjazdy to Twój teren.' };
        weakness = WEAK[lo.k];
      }
    }
  }

  // CP i W′ z modelu 2-parametrowego na 5 i 20 min (praca = CP·t + W′)
  const p5 = val('5min'), p20 = val('20min');
  let cp: number | null = null, wPrime: number | null = null;
  if (p5 && p20 && p5 > p20) {
    cp = Math.round((p20 * 1200 - p5 * 300) / 900);
    wPrime = Math.round(((p5 - cp) * 300) / 100) / 10;
  }

  return { curve, type, weakness, cp, wPrime, hasRecent: curve.some((c) => c.recent != null) };
}
