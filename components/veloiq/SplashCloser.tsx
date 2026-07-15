'use client';

import { useEffect } from 'react';

// Szybka ścieżka: po hydratacji (mount) usuwa splash przez wspólną, idempotentną
// window.__closeSplash (zdefiniowaną inline w layout). Bezpiecznik (twardy timeout 4s)
// żyje w inline script — działa nawet gdy bundle się nie załaduje i ten komponent nie zamontuje.
export function SplashCloser() {
  useEffect(() => {
    (window as unknown as { __closeSplash?: () => void }).__closeSplash?.();
  }, []);
  return null;
}
