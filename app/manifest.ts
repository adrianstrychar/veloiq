import type { MetadataRoute } from 'next';

// PWA manifest (ETAP 2). Kolory z tokenów C: bg/theme = C.bg (#14161B). Ikony ze znaku "Ring"
// (bez wordmarku), wygenerowane z app/icon.svg do public/icons.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'VeloIQ',
    short_name: 'VeloIQ',
    description: 'Twój AI trener. Zawsze gotowy.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#14161B',
    theme_color: '#14161B',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
