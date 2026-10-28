// Krótki token jazdy dla natywnej rozmowy z Enzo: telefon pyta /api/ride/ask także przy zgaszonym
// ekranie (WebView uśpiony, brak ciasteczek sesji). HMAC na sekrecie serwera, ważny 8 h.
import { createHmac, timingSafeEqual } from 'node:crypto';

const key = () => `veloiq-ride:${process.env.RIDE_TOKEN_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`;
const sign = (payload: string) => createHmac('sha256', key()).update(payload).digest('base64url');

export function signRideToken(userId: string, ttlSec = 8 * 3600): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** userId albo null (zły podpis / wygasły). */
export function verifyRideToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { u, e } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { u?: string; e?: number };
    return u && e && e > Date.now() / 1000 ? u : null;
  } catch { return null; }
}
