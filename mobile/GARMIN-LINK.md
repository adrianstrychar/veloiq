# Most iPhone ↔ Garmin Edge

Czujniki są sparowane tylko z licznikiem (ANT+). Aplikacja VeloIQ na Edge nadaje do aplikacji VeloIQ na iPhonie dane
i zdarzenia, a telefon mówi głosem Enzo i obsługuje rozmowę. Kanał: Connect IQ Mobile SDK (Bluetooth licznika,
ten sam co Garmin Connect) – na telefonie musi być zainstalowany Garmin Connect, a licznik z nim sparowany.

## Kto prowadzi trening

- **Trening uruchomiony na liczniku** (w telefonie nie ma aktywnej jazdy): licznik prowadzi, telefon mówi.
  Komunikaty silnika licznika mają te same klucze i zmienne co silnik telefonu, więc `DirectorVoice.compose`
  składa z nich te same nagrania Enzo – także skręty i podjazdy z nawigacji. Odliczanie 3-2-1 telefon robi sam
  po otrzymaniu „3” (radio ma za duże opóźnienia na komunikaty co sekundę).
- **Trening uruchomiony w telefonie**: licznik jest źródłem mocy / tętna / kadencji tam, gdzie telefon nie ma
  własnego czujnika Bluetooth; komunikaty licznika są pomijane (jeden głos naraz).

## Protokół (słowniki z krótkimi kluczami)

| Kierunek | Wiadomość |
|---|---|
| Edge → telefon | `{t:"live", v:[s, moc, tętno, kadencja, prędkość×10, faza, krok, zostało, cel↓, cel↑, 0]}` – co sekundę w trakcie jazdy, co 2 s przed startem (`s = -1`); `-1` = brak czujnika |
| | `{t:"cue", k, kind, x, v}` – komunikat silnika albo nawigacji (`kind:"nav"`) |
| | `{t:"talk", st:{stan jazdy}, q?, tk?, b?}` – przycisk ENZO; `q` = gotowe pytanie (raport), `tk`/`b` = token rozmowy i adres serwera |
| | `{t:"state", s:"start\|pause\|resume\|end", …}` |
| telefon → Edge | `{cmd:"next\|pause\|resume\|cancel\|lap\|eat\|drink\|talk\|report"}`, `{say:"odpowiedź Enzo"}`, `{hello:1}` |

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
