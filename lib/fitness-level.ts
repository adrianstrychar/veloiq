// Poziom formy z W/kg — JEDNO ŹRÓDŁO PRAWDY dla kafla FTP i wykresu FtpHero.
// Zastępuje wkgPercentile (zmyśloną krzywą percentylową) kategorią z WERYFIKOWALNEJ tabeli
// progów W/kg dla amatorów. To nie jest percentyl populacyjny (którego nie mamy) — to jawna,
// sprawdzalna klasyfikacja: "4.6 W/kg = poziom wyścigowy". Żadnego "top X%", żadnej fałszywej bazy.
//
// Progi (W/kg, dolne włącznie): <2.5 początkujący · 2.5–3.5 rekreacyjny · 3.5–4.0 zaawansowany
// amator · 4.0–4.5 mocny amator · 4.5–5.0 poziom wyścigowy · 5.0+ elita amatorska.
// Granice: 4.49 → mocny amator, 4.5 → poziom wyścigowy (dolna granica przedziału włącznie).

export function wkgCategory(wkg: number): string {
  if (wkg < 2.5) return 'początkujący';
  if (wkg < 3.5) return 'rekreacyjny';
  if (wkg < 4.0) return 'zaawansowany amator';
  if (wkg < 4.5) return 'mocny amator';
  if (wkg < 5.0) return 'poziom wyścigowy';
  return 'elita amatorska';
}

// Pełny podpis "4.6 W/kg · poziom wyścigowy" — identyczny w kaflu i na wykresie (koniec rozjazdu 4% vs 3%).
export function wkgLabel(wkg: number): string {
  return `${wkg.toFixed(1)} W/kg · ${wkgCategory(wkg)}`;
}

// Kategoria z wielkiej litery (do badge'a): "Poziom wyścigowy".
export function wkgCategoryTitle(wkg: number): string {
  const c = wkgCategory(wkg);
  return c.charAt(0).toUpperCase() + c.slice(1);
}
