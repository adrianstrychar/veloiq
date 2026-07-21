import { C, F } from '@/lib/theme';

// Znak "Ring" — V wpisane w niedomknięty pierścień. Geometria wg zatwierdzonego mockupu v3.
// Kolory WYŁĄCZNIE z tokenów C: pierścień = linia (C.border), łuk akcentu = C.cyan, V = C.text.
// Wordmark "veloIQ" w Space Grotesk 600 (token display), "IQ" w akcencie.
export function LogoVeloIQ({ height = 30 }: { height?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
      <svg
        viewBox="0 0 80 80"
        height={height}
        width={height}
        fill="none"
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="40" cy="40" r="26" stroke={C.border} strokeWidth="5" fill="none" />
        <path d="M40 14 A26 26 0 0 1 62.5 53" stroke={C.cyan} strokeWidth="5" strokeLinecap="round" fill="none" />
        <path d="M28 28 L40 54 L52 28" stroke={C.text} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      <span
        style={{
          fontFamily: F.display,
          fontWeight: 600,
          fontSize: Math.round(height * 0.62),
          letterSpacing: '-0.01em',
          color: C.text,
          lineHeight: 1,
        }}
      >
        velo<span style={{ color: C.cyan }}>IQ</span>
      </span>
    </span>
  );
}
