// capacitor.config.ts – w katalogu głównym repo VeloIQ.
// Aplikacja na iPhonie ładuje Twój Next.js (z API, Supabase auth itd.), a natywny RideEngine
// jest dostępny w tej stronie przez most Capacitora. Nie potrzeba `output: 'export'`.
import type { CapacitorConfig } from '@capacitor/cli';

// Domyślnie: produkcja (aplikacja działa bez Maca, każdy deploy na Vercel = aktualizacja).
// Praca nad kodem z Maca w tej samej sieci Wi-Fi:
//   VELOIQ_APP_URL=http://$(ipconfig getifaddr en0):3000 npx cap sync ios   (+ npm run dev -- -H 0.0.0.0)
const url = process.env.VELOIQ_APP_URL ?? 'https://veloiq-three.vercel.app';

const config: CapacitorConfig = {
  appId: 'app.veloiq',
  appName: 'VeloIQ',
  webDir: 'cap-shell',           // pusty folder z index.html (wymagany przez Capacitor, strona i tak idzie z `url`)
  server: {
    url,
    cleartext: url.startsWith('http://'), // tylko dla dev po Wi-Fi
  },
  ios: {
    contentInset: 'never',       // safe-area obsługuje CSS (env(safe-area-inset-*))
    backgroundColor: '#0A0A0F',
  },
};

export default config;
