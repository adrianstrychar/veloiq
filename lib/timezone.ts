// Strefa czasowa użytkownika — WSZYSTKO przez Intl.DateTimeFormat (DST-safe, bez ręcznych offsetów,
// bez zależności). Osobne od localTodayISO() w lib/plan.ts, które liczy datę w strefie SERWERA
// (na Vercelu = UTC) — świadomie NIE ruszane, bo używane przez SSR/plan (granice tygodnia).
//
// TODO: pobierać strefę z profilu użytkownika (athletes.timezone), gdy dodamy kolumnę + UI wyboru.
// Do tego czasu wszyscy = Europe/Warsaw.
export const USER_TIMEZONE = 'Europe/Warsaw';

// getUTCDay(): 0=niedziela … 6=sobota.
const DAY_NAMES_PL = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

// YYYY-MM-DD w strefie tz dla momentu `at` (domyślnie teraz). en-CA formatuje jako YYYY-MM-DD.
export function userTodayISO(at: Date = new Date(), tz: string = USER_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

// Nazwa dnia (po polsku, małą literą) dla daty kalendarzowej ISO. Liczona z UTC-noon — bezpieczne,
// bo ISO to już data lokalna (dzień tygodnia jednoznaczny, niezależny od strefy).
export function dayNamePl(iso: string): string {
  return DAY_NAMES_PL[new Date(iso + 'T12:00:00Z').getUTCDay()];
}

// Przesunięcie daty kalendarzowej ISO o n dni. UTC-noon → arytmetyka odporna na DST.
export function shiftISO(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Godzina HH:mm w strefie tz.
export function userTimeHM(at: Date = new Date(), tz: string = USER_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

// Godzina lokalna 0–23 w strefie tz (do reguły 00:00–04:00 w bloku czasowym).
export function userHour(at: Date = new Date(), tz: string = USER_TIMEZONE): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(at));
}

// Skrót strefy (CEST/CET…). Intl 'short' bywa "GMT+2" — wtedy mapujemy z realnego offsetu
// (DST-safe) dla stref CET/CEST. Dla innej strefy zwracamy to, co daje Intl.
export function userTzAbbr(at: Date = new Date(), tz: string = USER_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(at);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  if (/^[A-Za-z]{2,5}$/.test(name)) return name; // Intl dał już skrót (np. CEST/CET)
  if (tz === 'Europe/Warsaw') return name.includes('+2') ? 'CEST' : name.includes('+1') ? 'CET' : name;
  return name;
}

// Blok KONTEKST CZASOWY do system promptu — generowany PER REQUEST (nie cache'owany).
export function buildTimeContext(at: Date = new Date(), tz: string = USER_TIMEZONE): string {
  const today = userTodayISO(at, tz);
  const yesterday = shiftISO(today, -1);
  const dayBefore = shiftISO(today, -2);
  const tomorrow = shiftISO(today, 1);

  return `KONTEKST CZASOWY (obowiązujący, nadrzędny wobec wszystkiego innego):
Aktualny czas użytkownika: ${today} ${userTimeHM(at, tz)} ${userTzAbbr(at, tz)} (${tz})
DZIŚ: ${today} (${dayNamePl(today)})
WCZORAJ: ${yesterday} (${dayNamePl(yesterday)})
PRZEDWCZORAJ: ${dayBefore} (${dayNamePl(dayBefore)})
JUTRO: ${tomorrow} (${dayNamePl(tomorrow)})

Zasady interpretacji czasu:
- "dziś", "wczoraj", "przedwczoraj", "jutro" ZAWSZE mapujesz na powyższe daty kalendarzowe. Nigdy nie licz ich z UTC ani z daty serwera.
- Nazwy dni tygodnia ("w poniedziałek") mapuj na najbliższy MINIONY dzień o tej nazwie, chyba że kontekst wskazuje na przyszłość.
- Jeśli w danym dniu NIE MA aktywności — powiedz to wprost. NIGDY nie podstawiaj aktywności z sąsiedniego dnia i nie udawaj, że to ta, o którą pytano.
- Jeśli aktualna godzina jest między 00:00 a 04:00 i użytkownik używa słowa "wczoraj", w odpowiedzi potwierdź konkretną datę (np. "poniedziałek 14.07"), bo o tej porze intencja bywa niejednoznaczna.`;
}
