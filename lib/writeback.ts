// Treść opisu write-back do Stravy (feat/strava-writeback) — czysty, testowalny.
// Zasada: NIGDY nie nadpisuj tekstu usera. Pusty opis → wpisz naszą linię. Opis z tekstem →
// DOPISZ naszą linię na końcu (tekst usera zostaje na górze). Idempotencja: nasza linia raz.

export const VELOIQ_PREFIX = 'VeloIQ · ';

// Linia dopisywana do opisu, np. "VeloIQ · Over-Under 3×12min".
export function veloiqLine(label: string): string {
  return `${VELOIQ_PREFIX}${label.trim()}`;
}

// Czy opis już zawiera JAKĄKOLWIEK naszą linię (prefiks) — idempotencja: nie dopisuj drugi raz,
// nawet jeśli label się zmienił (jedna linia VeloIQ na opis, nie mnożymy przy każdym kliknięciu).
export function hasVeloiqLine(description: string | null | undefined): boolean {
  if (!description) return false;
  return description.split('\n').some((l) => l.trim().startsWith(VELOIQ_PREFIX));
}

export interface DescriptionBuild {
  text: string;             // finalny opis do zapisu (albo obecny, gdy alreadyPresent)
  alreadyPresent: boolean;  // nasza linia już była → nie zmieniamy, UI pokazuje "już opisano"
  line: string;             // dopisywana linia (do podglądu)
}

// Buduje finalny opis. Pusty → sama linia. Niepusty → istniejący + pusta linia + nasza linia.
// Jeśli nasza linia już jest → alreadyPresent=true, text = obecny (bez zmian).
export function buildDescription(existing: string | null | undefined, label: string): DescriptionBuild {
  const line = veloiqLine(label);
  const cur = (existing ?? '').replace(/\s+$/, ''); // utnij trailing whitespace, ale zachowaj treść
  if (hasVeloiqLine(cur)) {
    return { text: cur, alreadyPresent: true, line };
  }
  const text = cur.length === 0 ? line : `${cur}\n\n${line}`;
  return { text, alreadyPresent: false, line };
}
