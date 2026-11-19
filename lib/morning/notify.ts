// Powiadomienie o raporcie porannym. Na razie raport żyje w aplikacji (karta na pulpicie) –
// push z serwera na iPhone'a wymaga płatnego konta Apple Developer (APNs). Gdy będzie:
//   1) natywnie: UNUserNotificationCenter.requestAuthorization + registerForRemoteNotifications,
//      token urządzenia → tabela push_devices (athlete_id, token),
//   2) tu: wysyłka przez APNs HTTP/2 (klucz .p8: APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY) z
//      tytułem `row.title` i treścią `row.push`; zwrócić true po 200.
// Zwraca true, gdy powiadomienie faktycznie wyszło (wtedy run.ts zapisuje notified_at).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MorningReportRow } from '@/lib/morning/run';

export async function notifyMorning(supabase: SupabaseClient, row: MorningReportRow): Promise<boolean> {
  void supabase; void row; // kanał push jeszcze nie skonfigurowany
  return false;
}
