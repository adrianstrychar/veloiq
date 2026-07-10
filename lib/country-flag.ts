// Flagi krajów przy wyścigach (dodatek poza mockupem). Mała mapa frontendowa
// nazwa-PL → emoji: kraje sezonu + zapasowe kraje UCI. Brak w mapie / null → bez flagi.

const FLAGS: Record<string, string> = {
  'Niemcy': '🇩🇪',
  'Czechy': '🇨🇿',
  'Włochy': '🇮🇹',
  'Hiszpania': '🇪🇸',
  'Szwecja': '🇸🇪',
  'Australia': '🇦🇺',
  'Polska': '🇵🇱',
  'Francja': '🇫🇷',
  'Belgia': '🇧🇪',
  'Holandia': '🇳🇱',
  'Austria': '🇦🇹',
  'Szwajcaria': '🇨🇭',
  'USA': '🇺🇸',
};

// Osłona UI na brudne dane: string "null"/pusty → null (niezależnie od fixu SQL w bazie).
export function cleanLocation(loc: string | null | undefined): string | null {
  if (!loc) return null;
  const t = loc.trim();
  if (!t || t.toLowerCase() === 'null') return null;
  return t;
}

// Emoji flagi dla lokalizacji (dopasowanie po pełnej nazwie kraju PL). null → bez flagi.
export function countryFlag(loc: string | null | undefined): string | null {
  const t = cleanLocation(loc);
  return t ? FLAGS[t] ?? null : null;
}
