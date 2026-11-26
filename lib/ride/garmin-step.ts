// Licznik Garmin Edge na ekranie „Jedź”: jeden stan → jedno zdanie i jedna czynność (components/ride/GarminPanel.tsx).
// Czysta funkcja bez Reacta – testowana w scripts/check-garmin.ts.
import type { GarminLinkStatus } from './ride-engine';

export type GarminAccount = { state: 'linking' | 'ok' | 'error'; text: string; at: number } | null;

type Tone = 'ok' | 'wait' | 'todo';
export interface GarminStep {
  key: 'web' | 'old' | 'setup' | 'choose' | 'offline' | 'install' | 'openApp' | 'account' | 'ready' | 'riding';
  tone: Tone;
  title: string;
  text: string;
  action?: { label: string; run: 'choose' | 'openApp' | 'pair' | 'code' };
}

/** Jeden stan licznika → zdanie i jedna czynność. */
export function garminStep(o: {
  native: boolean;
  link: GarminLinkStatus;
  devices: number;
  account: GarminAccount;
}): GarminStep {
  const { native, link, devices, account } = o;
  if (!native) {
    return devices
      ? { key: 'web', tone: 'ok', title: 'Licznik połączony z kontem', text: 'Plan dnia trafia na licznik, jazdy wracają do VeloIQ same. Dane na żywo i głos Enzo działają w aplikacji VeloIQ na iPhonie.' }
      : { key: 'web', tone: 'todo', title: 'Połącz licznik Garmin Edge', text: 'Najprościej z aplikacji VeloIQ na iPhonie – połączy się sama. Tutaj możesz wpisać kod z licznika (MENU → Połącz z kontem).', action: { label: 'Wpisz kod z licznika', run: 'code' } };
  }
  if (!link.available) {
    return { key: 'old', tone: 'wait', title: 'Zaktualizuj aplikację VeloIQ', text: 'Ta wersja aplikacji nie rozmawia jeszcze z licznikiem. Konto połączysz kodem z licznika.', action: { label: 'Wpisz kod z licznika', run: 'code' } };
  }
  if (!link.paired) {
    return devices
      ? { key: 'choose', tone: 'todo', title: 'Wybierz licznik w Garmin Connect', text: 'Raz. Potem START na liczniku pokaże jazdę tutaj, a Enzo będzie mówił w słuchawkach.', action: { label: 'Wybierz licznik', run: 'choose' } }
      : { key: 'setup', tone: 'todo', title: 'Połącz licznik Garmin Edge', text: 'Zainstaluj VeloIQ na liczniku (Connect IQ), wybierz go tutaj w Garmin Connect i otwórz na nim VeloIQ – resztę zrobię sam.', action: { label: 'Wybierz licznik', run: 'choose' } };
  }
  const name = link.name ?? 'Licznik';
  if (!link.connected) {
    return { key: 'offline', tone: 'wait', title: `${name} poza zasięgiem`, text: 'Włącz licznik i trzymaj telefon blisko (Bluetooth włączony). Połączę się sam.' };
  }
  if (!link.streaming) {
    if (link.appInstalled === false) {
      return { key: 'install', tone: 'todo', title: 'Zainstaluj VeloIQ na liczniku', text: 'W aplikacji Connect IQ w telefonie: VeloIQ → Instaluj. Wgrana kablem? Po prostu otwórz ją na liczniku.', action: { label: 'Otwórz VeloIQ na liczniku', run: 'openApp' } };
    }
    return { key: 'openApp', tone: 'todo', title: 'Otwórz VeloIQ na liczniku', text: `${name} jest połączony. Uruchom na nim aplikację VeloIQ – reszta połączy się sama.`, action: { label: 'Otwórz VeloIQ na liczniku', run: 'openApp' } };
  }
  if (link.recording) {
    return { key: 'riding', tone: 'ok', title: 'Jazda trwa na liczniku', text: 'Dane płyną na żywo, Enzo mówi w słuchawkach.' };
  }
  // konto na liczniku potwierdzone (hi acct:1) wygrywa ze starym kodem w stanie mostu
  const noAccount = link.edgeAccount === false || (!!link.pairCode && link.edgeAccount !== true);
  if (noAccount || account?.state === 'linking' || (account?.state === 'error' && link.edgeAccount !== true)) {
    if (account?.state === 'error') {
      return { key: 'account', tone: 'wait', title: 'Licznik bez konta VeloIQ', text: account.text, action: { label: 'Spróbuj ponownie', run: 'pair' } };
    }
    return { key: 'account', tone: 'wait', title: 'Łączę licznik z kontem…', text: 'Kilka sekund – licznik pobierze plan na dziś i będzie sam wysyłał jazdy.' };
  }
  if (!devices && link.edgeAccount == null) {
    // starsza aplikacja na liczniku (przed 0.4.0) nie łączy konta sama – kod z ekranu licznika
    return { key: 'account', tone: 'todo', title: 'Połącz licznik z kontem', text: 'Na liczniku: VeloIQ → MENU → „Połącz z kontem” i wpisz tutaj kod. Nowsza wersja na liczniku zrobi to sama.', action: { label: 'Wpisz kod z licznika', run: 'code' } };
  }
  return { key: 'ready', tone: 'ok', title: 'Gotowe – wciśnij START na liczniku', text: 'Telefon pokaże tę samą jazdę na żywo, a Enzo będzie mówił w słuchawkach.' };
}

