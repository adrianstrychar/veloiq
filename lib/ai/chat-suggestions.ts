// Sugerowane pytania (chips) do czatu — DETERMINISTYCZNE (bez wywołań LLM: zero latencji/kosztu).
// ZASADA: pytania OTWARTE, wymagające interpretacji i syntezy danych użytkownika — NIE skróty do
// istniejących widoków (analiza jazdy, dzisiejszy trening, strategia startu są dwa tapnięcia dalej).
// Czat sugeruje to, czego NIE MA gdzie indziej w aplikacji: rozumowanie na danych, nie nawigację.
import type { SupabaseClient } from '@supabase/supabase-js';
import { userTodayISO } from '@/lib/timezone';

export interface Suggestion {
  label: string;  // krótki tekst chipa
  prompt: string; // pełne pytanie wysyłane do czatu
  topic: string;  // do deduplikacji (nie renderowane)
}

export async function buildSuggestions(supabase: SupabaseClient, athleteId: string): Promise<Suggestion[]> {
  const today = userTodayISO();

  // Jedyna personalizacja: nazwa najbliższego startu (do pytania "co poprawić do startu X").
  const { data: race } = await supabase
    .from('race_calendar')
    .select('name, date')
    .eq('athlete_id', athleteId)
    .gte('date', today)
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();
  const raceName = typeof race?.name === 'string' && race.name.trim() ? race.name.trim() : null;

  // Pytania otwarte — model odpowiada syntezą z danych (FTP, PMC, moc, waga, plan). Ostatnie
  // personalizowane nazwą startu, gdy jest w kalendarzu; inaczej wariant ogólny.
  return [
    { label: 'Próg czy VO2max?', prompt: 'Co bardziej ogranicza moją formę — próg czy VO2max?', topic: 'limiter-energy' },
    { label: 'Waga czy moc?', prompt: 'Co ogranicza mnie bardziej: waga czy moc?', topic: 'limiter-wkg' },
    { label: 'Koszt odpuszczenia tygodnia', prompt: 'Ile realnie stracę formy, jeśli odpuszczę tydzień?', topic: 'detraining' },
    { label: 'Forma vs objętość', prompt: 'Dlaczego moja forma zmienia się mimo stałej objętości treningu?', topic: 'ftp-volume' },
    { label: 'Na tle planu (8 tyg.)', prompt: 'Jak wypadam na tle planu z ostatnich 8 tygodni?', topic: 'plan-adherence' },
    raceName
      ? { label: `Co poprawić do ${raceName}?`, prompt: `Co powinienem poprawić do startu "${raceName}"?`, topic: 'race-improve' }
      : { label: 'Co poprawić do wyścigu?', prompt: 'Co powinienem poprawić do następnego wyścigu?', topic: 'race-improve' },
  ];
}
