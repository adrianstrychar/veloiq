export const C = {
  bg: '#14161B',
  card: '#1A1D23',
  card2: '#1E222A',
  border: '#262A31',
  cyan: '#4A8FC7',
  green: '#5B9B7E',
  yellow: '#C99A4E',
  red: '#C76B6B',
  purple: '#8C7BC0',
  text: '#EDEFF2',
  muted: '#9AA0AB',
  dim: '#21252C',
  panelHi: '#1E222A', // panel podniesiony (dymek użytkownika w czacie) — jaśniejszy niż card
  faint: '#5B616B',   // szary słabszy niż muted — separatory dni, przekreślenia (ETAP CHAT)
};

// Tokeny typografii (ETAP 1). Wartości CSS var wstrzykuje next/font w app/layout.tsx.
// display = Space Grotesk (nagłówki, liczby), body = Inter (tekst), mono = IBM Plex Mono (etykiety).
export const F = {
  display: 'var(--font-display), "Space Grotesk", system-ui, sans-serif',
  body: 'var(--font-body), Inter, system-ui, sans-serif',
  mono: 'var(--font-mono), "IBM Plex Mono", ui-monospace, monospace',
} as const;

// Tokeny geometrii (ETAP 1). card = jednolity promień kart, obrys 1px w C.border.
export const RADIUS = { card: 16, pill: 20, inner: 8 } as const;
