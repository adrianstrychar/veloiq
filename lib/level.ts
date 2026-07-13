// JEDNO źródło progów poziomu z W/kg — jako DANE (tablica), nie tylko gałęzie if. Czyta to
// kafel FTP, wykres FtpHero ORAZ milestone'y poziomowe prognozy (user bez startów → następny próg).
// Tabela progów amatorskich (weryfikowalna klasyfikacja, nie percentyl populacyjny).

export interface WkgLevel { wkg: number; name: string }

// Progi (dolna granica przedziału włącznie). floor 0 = "poniżej rekreacyjnego".
export const WKG_LEVELS: WkgLevel[] = [
  { wkg: 0, name: 'początkujący' },
  { wkg: 2.5, name: 'rekreacyjny' },
  { wkg: 3.5, name: 'zaawansowany amator' },
  { wkg: 4.0, name: 'mocny amator' },
  { wkg: 4.5, name: 'poziom wyścigowy' },
  { wkg: 5.0, name: 'elita amatorska' },
];

// Kategoria dla danego W/kg — z tablicy (ostatni próg ≤ wkg).
export function wkgCategory(wkg: number): string {
  let cat = WKG_LEVELS[0].name;
  for (const l of WKG_LEVELS) if (wkg >= l.wkg) cat = l.name;
  return cat;
}

// Następny próg POWYŻEJ danego W/kg (do milestone'a poziomowego). null = już elita.
export function nextWkgLevel(wkg: number): WkgLevel | null {
  return WKG_LEVELS.find((l) => l.wkg > wkg) ?? null;
}

// Pełny podpis "4.6 W/kg · poziom wyścigowy" — identyczny w kaflu i na wykresie.
export function wkgLabel(wkg: number): string {
  return `${wkg.toFixed(1)} W/kg · ${wkgCategory(wkg)}`;
}

// Kategoria z wielkiej litery (badge): "Poziom wyścigowy".
export function wkgCategoryTitle(wkg: number): string {
  const c = wkgCategory(wkg);
  return c.charAt(0).toUpperCase() + c.slice(1);
}
