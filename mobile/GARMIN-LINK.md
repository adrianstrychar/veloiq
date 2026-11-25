# Most iPhone ↔ Garmin Edge

Czujniki są sparowane tylko z licznikiem (ANT+). Aplikacja VeloIQ na Edge nadaje do aplikacji VeloIQ na iPhonie dane
i zdarzenia, a telefon mówi głosem Enzo i obsługuje rozmowę. Kanał: Connect IQ Mobile SDK (Bluetooth licznika,
ten sam co Garmin Connect) – na telefonie musi być zainstalowany Garmin Connect, a licznik z nim sparowany.

## Kto prowadzi trening

- **Trening uruchomiony na liczniku (tryb lustra, od 0.2.2)**: START na liczniku = ta sama sesja w telefonie.
  Telefon dostaje plan (kroki), godzinę startu i co sekundę próbkę – ekran „Jedź” sam się otwiera i pokazuje
  jazdę na żywo, Enzo mówi z komunikatów silnika licznika (te same klucze co w telefonie), działa „Zapytaj Enzo”
  (ekran, Flic, przycisk ENZO na liczniku). Pauza / Dalej / Falstart z telefonu idą do licznika. Telefon nie nagrywa –
  jazdę zapisuje licznik i wysyła do VeloIQ. Powiadomienia „na licznik” są wyłączone, gdy wybrano licznik.
- **Trening uruchomiony w telefonie**: licznik jest źródłem mocy / tętna / kadencji tam, gdzie telefon nie ma
  własnego czujnika Bluetooth; komunikaty licznika są pomijane (jeden głos naraz).

## Komendy głosowe w jeździe (od 0.3.0)

Rozpoznawane od razu w telefonie (bez serwera), resztę rozumie trener AI (`/api/ride/ask` → `action`):

| Powiedz | Akcja |
|---|---|
| „dodaj minutę”, „przedłuż przerwę o 2 minuty”, „skróć o 30 sekund” | `extend:±SEK` |
| „mocniej o 5 procent”, „lżej”, „cele jak w planie” | `bias:+N` / `bias:-N` / `bias:0` |
| „jeszcze jeden interwał” | `repeat` |
| „zjadłem żel / batona”, „wypiłem” | `eat:25` / `eat:40` / `drink` |
| „prowadź do startu / do domu”, „wróć na trasę” | `route:start` / `route:rejoin` (licznik pyta serwer o nową trasę profilem roweru) |
| „pokaż mapę / wykres / paliwo / podjazd / wysiłek” | `page:…` (strona licznika) |

## Protokół (słowniki z krótkimi kluczami)

| Kierunek | Wiadomość |
|---|---|
| Edge → telefon | `{t:"live", v:[s, moc, tętno, kadencja, prędkość×10, faza, krok, zostało, cel↓, cel↑, pauza, moc 3 s, średnia kroku, falstart, przeciąganie, dystans m, sekundy kroku]}` – co sekundę w trakcie jazdy (co 5 s, gdy telefon milczy), przed startem co 2 s (`s = -1`); `-1` = brak czujnika |
| | `{t:"state", s:"start", k, w, id, ftp, free, in, st:[[typ, czas, moc↓, moc↑, kad↓, kad↑, nazwa]…], el, p, sync?}` – plan dla trybu lustra |
| | `{t:"st", st:{stan jazdy}}` – co 30 s i na `cmd:"state"`; `{t:"hi", v, rec}` – odpowiedź na `hello` |
| | `{t:"cue", k, kind, x, v}` – komunikat silnika albo nawigacji (`kind:"nav"`) |
| | `{t:"talk", st:{stan jazdy}, q?, tk?, b?}` – przycisk ENZO; `q` = gotowe pytanie (raport), `tk`/`b` = token rozmowy i adres serwera |
| | `{t:"state", s:"start\|pause\|resume\|end", …}` |
| telefon → Edge | `{cmd:…}`: next, pause, resume, cancel, lap, eat, drink, talk, report, sync, state, resync, repeat, extend:N, bias:N, eat:G, route:start, route:rejoin, page:ID · `{say:"odpowiedź Enzo"}` · `{hello:1}` · `{hb:1}` (co 10 s – telefon słucha) |

`hello` włącza nadawanie na liczniku bez wchodzenia w ustawienia. Token rozmowy (`tk`) licznik dostaje z
`/api/garmin/sync` (ważny 36 h) – dzięki niemu pytania do trenera działają także wtedy, gdy jazda nie była
uruchamiana w telefonie.

## Kod

| Plik | Rola |
|---|---|
| `garmin/source/PhoneLink.mc`, `Ride.mc` | strona licznika: kolejka wysyłki, stan jazdy w formacie telefonu, polecenia |
| `mobile/ios-src/RideEngine/GarminLink.swift` | SDK Garmina: wybór licznika, stan połączenia, wiadomości |
| `mobile/ios-src/RideEngine/RideEnginePlugin.swift` (sekcja „Licznik Garmin Edge”) | głos, rozmowa, dane czujników, mikrofon |
| `mobile/setup-ios.sh` | pakiet Swift `connectiq-companion-app-sdk-ios`, schemat `veloiq://`, `gcm-ciq` w Info.plist |
| `components/ride/GarminCard.tsx` | ekran Czujniki: wybór licznika, stan mostu, podgląd odczytów |

## Pierwsze uruchomienie

1. Na liczniku: aplikacja VeloIQ wgrana i sparowana z kontem (kod z ekranu licznika).
2. W telefonie: **Jedź → Czujniki → Licznik Garmin Edge → Wybierz licznik w Garmin Connect** – otworzy się
   Garmin Connect, zaznacz Edge i wróć do VeloIQ. Przy okazji aplikacja zapyta o mikrofon i rozpoznawanie mowy.
3. Otwórz VeloIQ na liczniku. Karta w telefonie powinna pokazać „Licznik nadaje” i odczyty czujników.
4. **Mikrofon:** iOS nie pozwala włączyć mikrofonu, gdy aplikacja jest w tle. Dlatego telefon włącza go w chwili,
   gdy VeloIQ jest na ekranie, a licznik nadaje – i trzyma do końca jazdy na liczniku (albo 10 minut po utracie
   połączenia). W praktyce: przed jazdą otwórz VeloIQ w telefonie przy włączonej aplikacji na liczniku, potem
   możesz zablokować ekran. Bez tego przycisk ENZO na liczniku pokaże komunikat, a pytania z listy na ekranie
   licznika działają dalej.

## Stan weryfikacji

- Kompilacja aplikacji iOS z mostem: workflow **iOS (kompilacja)** (symulator, bez podpisu) – przechodzi.
- Strona licznika: buduje się na 9 modeli; kolejkowanie i polecenia są w testach w symulatorze Garmina,
  ale samo nadawanie (`Communications.transmit`) zatrzymuje symulator w kontenerze, więc **nie jest pokryte testem**.
- **Niesprawdzone na sprzęcie** (pierwsza jazda to zweryfikuje):
  - czy Mobile SDK widzi aplikację wgraną kablem (`.prg`) – w zgłoszeniach na forum Garmina takie aplikacje
    bywają niewidoczne i potrzebna jest wersja beta w sklepie Connect IQ;
  - opóźnienia i gubienie wiadomości przy 1 Hz, zachowanie w tle przy zablokowanym telefonie;
  - mikrofon trzymany od otwarcia aplikacji do końca jazdy (zużycie baterii, przełączanie tras audio).
