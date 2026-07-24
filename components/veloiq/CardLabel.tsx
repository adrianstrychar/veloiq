import type { CSSProperties, ReactNode } from 'react';
import { C, F } from '@/lib/theme';

// Jednolita etykieta karty (ETAP 1): mono, 10px, UPPERCASE, letter-spacing 0.14em.
// Kolor domyślnie C.muted; akcent (np. C.cyan dla AI Insight) przez prop `color`.
export function CardLabel({
  children,
  color = C.muted,
  style,
}: {
  children: ReactNode;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontFamily: F.mono,
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
