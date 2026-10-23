'use client';
// Jeden silnik i jeden stan treningu dla całej aplikacji – dzięki temu mini-pasek
// działa na każdej zakładce, a powrót do „Jedź” pokazuje trwającą jazdę.
// Użycie: owiń layout zakładek w <RideProvider> (app/(app)/layout.tsx).

import { createContext, useContext, type ReactNode } from 'react';
import { useRide, type Ride } from './useRide';

const RideContext = createContext<Ride | null>(null);

export function RideProvider({ children }: { children: ReactNode }) {
  const ride = useRide();
  return <RideContext.Provider value={ride}>{children}</RideContext.Provider>;
}

export function useRideContext(): Ride {
  const ride = useContext(RideContext);
  if (!ride) throw new Error('useRideContext: brak <RideProvider> w drzewie (owiń layout aplikacji).');
  return ride;
}
