import type { Metadata } from 'next';

// Polityka prywatności VeloIQ – strona publiczna (bez logowania, wyjątek w middleware.ts).
// Link podawany m.in. w sklepie Garmin Connect IQ (aplikacja VeloIQ na licznik Edge).

export const metadata: Metadata = {
  title: 'Polityka prywatności – VeloIQ',
  description: 'Jakie dane zbiera VeloIQ, po co i jak z nich korzysta.',
};

const UPDATED = '24 listopada 2026';
const CONTACT = 'adrianstrychar@gmail.com';

const section: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#FFFFFF', margin: '8px 0 0' };
const p: React.CSSProperties = { margin: 0, lineHeight: 1.6 };

export default function PrivacyPage() {
  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#06080A', color: '#C9D1D9', padding: '48px 20px' }}>
      <article style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24, fontSize: 16 }}>
        <header style={section}>
          <span style={{ color: '#00CFFF', fontWeight: 700, letterSpacing: 1 }}>VeloIQ</span>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: '#FFFFFF', margin: 0 }}>Polityka prywatności</h1>
          <p style={{ ...p, color: '#93A1AD' }}>Ostatnia aktualizacja: {UPDATED}</p>
        </header>

        <section style={section}>
          <h2 style={h2}>Kto odpowiada za dane</h2>
          <p style={p}>
            Administratorem danych w VeloIQ (aplikacja internetowa, aplikacja na iPhone&apos;a i aplikacja VeloIQ na liczniki Garmin Edge)
            jest Adrian Strychar. Kontakt w sprawie danych: <a href={`mailto:${CONTACT}`} style={{ color: '#00CFFF' }}>{CONTACT}</a>.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>Jakie dane zbieramy</h2>
          <ul style={{ ...p, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li><strong>Konto:</strong> adres e-mail i dane profilu, które podajesz (imię, FTP, tętno maksymalne, waga, cele i kalendarz startów).</li>
            <li><strong>Treningi i jazdy:</strong> moc, tętno, kadencja, prędkość, czas, dystans, przewyższenie oraz ślad GPS jazdy – z aplikacji VeloIQ na telefonie, z licznika Garmin Edge albo z połączonych serwisów.</li>
            <li><strong>Połączone serwisy:</strong> gdy je połączysz – aktywności ze Stravy oraz dane regeneracji i snu z WHOOP.</li>
            <li><strong>Trasy:</strong> pliki GPX, które wgrywasz do nawigacji lub strategii wyścigu.</li>
            <li><strong>Rozmowy z trenerem:</strong> pytania do trenera AI (także zadane głosem) i stan jazdy w chwili pytania.</li>
            <li><strong>Licznik Garmin:</strong> identyfikator sparowanego urządzenia (model i wersja aplikacji) oraz token, którym licznik łączy się z VeloIQ.</li>
          </ul>
        </section>

        <section style={section}>
          <h2 style={h2}>Po co</h2>
          <p style={p}>
            Wyłącznie do działania VeloIQ: układania i dopasowywania planu treningowego, prowadzenia treningu na żywo (głos trenera,
            komunikaty na liczniku), nawigacji po trasie, analizy jazd i odpowiedzi trenera AI. Nie sprzedajemy danych i nie
            wykorzystujemy ich do reklam.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>Komu przekazujemy dane</h2>
          <p style={p}>Tylko dostawcom, bez których aplikacja nie działa, w zakresie potrzebnym do ich usługi:</p>
          <ul style={{ ...p, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>Supabase – baza danych, logowanie i przechowywanie plików z jazdami;</li>
            <li>Vercel – hosting aplikacji;</li>
            <li>Anthropic – model AI odpowiadający jako trener (otrzymuje treść pytania i dane potrzebne do odpowiedzi);</li>
            <li>Strava i WHOOP – tylko gdy sam połączysz konto, na zasadach tych serwisów;</li>
            <li>Garmin – przesyłanie danych między licznikiem a telefonem i internetem odbywa się przez Garmin Connect, na zasadach Garmina.</li>
          </ul>
        </section>

        <section style={section}>
          <h2 style={h2}>Aplikacja VeloIQ na licznik Garmin Edge</h2>
          <p style={p}>
            Aplikacja na liczniku korzysta z czujników sparowanych z licznikiem (moc, tętno, kadencja, prędkość) i z GPS.
            Po zakończeniu jazdy wysyła do Twojego konta VeloIQ podsumowanie, próbki co 5 sekund i ślad GPS. Pobiera z VeloIQ plan
            treningowy, trasę i odpowiedzi trenera. Gdy włączysz most do telefonu, licznik przesyła dane jazdy na bieżąco do aplikacji
            VeloIQ na Twoim telefonie. Bez sparowania z kontem aplikacja niczego nie wysyła.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>Jak długo i Twoje prawa</h2>
          <p style={p}>
            Dane przechowujemy, dopóki masz konto. Możesz w każdej chwili poprosić o wgląd w dane, ich poprawienie, przeniesienie
            albo usunięcie konta wraz z danymi – napisz na {CONTACT}. Licznik możesz odłączyć w aplikacji (Jedź → Czujniki → Licznik Garmin Edge → Odłącz),
            a połączenia ze Stravą i WHOOP – w ustawieniach. Masz też prawo złożyć skargę do Prezesa Urzędu Ochrony Danych Osobowych.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>English summary</h2>
          <p style={p}>
            VeloIQ (web app, iPhone app and the VeloIQ app for Garmin Edge) collects your account and profile data, ride data
            (power, heart rate, cadence, speed, GPS track), connected-service data (Strava, WHOOP) and questions you ask the AI coach,
            solely to provide training plans, live coaching, navigation and ride analysis. Data is processed by Supabase, Vercel and
            Anthropic as service providers, is never sold or used for advertising, and can be exported or deleted on request
            at {CONTACT}.
          </p>
        </section>
      </article>
    </main>
  );
}
