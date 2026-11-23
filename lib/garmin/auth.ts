// VeloIQ na Garmin Edge – uwierzytelnianie licznika.
// Licznik nie ma jak się zalogować, więc paruje się kodem: pokazuje 6 cyfr, zawodnik wpisuje je w aplikacji
// (zalogowany), a licznik odbiera długi losowy token. W bazie trzymamy tylko jego skrót SHA-256.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const PAIR_TTL_SEC = 600;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => `vqg_${randomBytes(32).toString('base64url')}`;
export const newSecret = () => randomBytes(18).toString('base64url');
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export interface DeviceAuth { userId: string; deviceId: string }

/** Token z nagłówka Authorization → użytkownik i urządzenie; null = brak / zły / odłączony. */
export async function verifyDevice(admin: SupabaseClient, authorization: string | null | undefined): Promise<DeviceAuth | null> {
  const token = authorization?.replace(/^Bearer\s+/i, '').trim();
  if (!token || !token.startsWith('vqg_') || token.length > 200) return null;
  const { data } = await admin.from('garmin_devices')
    .select('id, user_id, revoked_at, last_seen_at')
    .eq('token_hash', sha256(token)).maybeSingle();
  if (!data || data.revoked_at) return null;
  // „ostatnio widziany” najwyżej raz na 10 minut – bez zapisu przy każdym zapytaniu
  const seen = data.last_seen_at ? Date.parse(data.last_seen_at as string) : 0;
  if (Date.now() - seen > 600_000) {
    void admin.from('garmin_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id).then(() => undefined, () => undefined);
  }
  return { userId: data.user_id as string, deviceId: data.id as string };
}

/** Nazwa modelu z numeru części Garmina (to, co licznik sam o sobie wie). */
export function deviceName(partNumber: string | null | undefined): string {
  const map: Record<string, string> = {
    '006-B2713-00': 'Edge 1030', '006-B2924-00': 'Edge 1030', '006-B3570-00': 'Edge 1030 Plus', '006-B3812-00': 'Edge 1030 Plus',
    '006-B3095-00': 'Edge 1030 Bontrager', '006-B3122-00': 'Edge 830', '006-B3350-00': 'Edge 830', '006-B3121-00': 'Edge 530',
    '006-B3349-00': 'Edge 530', '006-B3843-00': 'Edge 1040', '006-B4305-00': 'Edge 1040', '006-B4062-00': 'Edge 840',
    '006-B4061-00': 'Edge 540', '006-B4440-00': 'Edge 1050',
  };
  return (partNumber && map[partNumber]) || 'Garmin Edge';
}
