import type { Metadata } from "next";
import localFont from "next/font/local";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { SplashCloser } from "@/components/veloiq/SplashCloser";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

// ETAP 1 — tokeny typografii (redesign "Forma"). latin-ext = polskie znaki (ą ć ę ł ń ó ś ż ź).
// display: nagłówki + liczby; body: tekst; mono: etykiety kart (CardLabel).
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600"],
  variable: "--font-display",
  display: "swap",
});
const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-body",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "VeloIQ",
  description: "Twój AI trener. Zawsze gotowy.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} ${inter.variable} ${plexMono.variable} antialiased bg-background text-foreground`}
      >
        {/* SPLASH — statyczny SSR, widoczny od pierwszego paintu (przed hydratacją).
            Tło #0a0a0f = realne --background z globals.css → zero błysku przy zniknięciu.
            Znika: SplashCloser (po hydratacji) albo inline timeout 4000ms (bezpiecznik bez bundla). */}
        <div
          id="splash"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "#0a0a0f",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "opacity 200ms ease",
          }}
        >
          <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 34, fontWeight: 500, letterSpacing: "-0.5px" }}>
            <span style={{ color: "#FFFFFF" }}>VELO</span>
            <span style={{ color: "#00CFFF" }}>IQ</span>
          </span>
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var r=false;window.__closeSplash=function(){if(r)return;r=true;var e=document.getElementById('splash');if(!e)return;e.style.pointerEvents='none';e.style.opacity='0';setTimeout(function(){e&&e.parentNode&&e.parentNode.removeChild(e);},200);};setTimeout(window.__closeSplash,4000);})();",
          }}
        />
        {children}
        <SplashCloser />
      </body>
    </html>
  );
}
