# Most iPhone ↔ Garmin Edge (szkic)

Cel: czujniki sparowane tylko z licznikiem (ANT+), a telefon dostaje z niego dane co sekundę i mówi głosem Enzo;
przycisk **ENZO** na liczniku włącza pytanie głosowe przez słuchawki (jak przycisk Flic), odpowiedź pojawia się też na liczniku.

Strona licznika jest gotowa i przetestowana na poziomie kolejkowania (`garmin/source/PhoneLink.mc`, ustawienie
„Most do telefonu (beta)”, domyślnie wyłączone). Strona iPhone'a to `GarminLink.swift` w tym katalogu –
**napisany pod nagłówki SDK, ale niekompilowany w Xcode i niewpięty w projekt** (celowo leży poza
`mobile/ios-src/RideEngine/`, żeby nie mógł zepsuć bieżącego builda).

## Wpięcie (do zrobienia na Macu)

1. Xcode → Package Dependencies → `https://github.com/garmin/connectiq-companion-app-sdk-ios` (ConnectIQ, binarny xcframework).
2. `Info.plist`: `CFBundleURLTypes` ze schematem `veloiq` (powrót z Garmin Connect po wyborze urządzenia),
   `LSApplicationQueriesSchemes` → `gcm-ciq`. Tryb tła `bluetooth-central` już jest. Wymagane jest też
   `CFBundleDisplayName` (bez niego Garmin Connect nie wraca do aplikacji – znany problem SDK).
3. Skopiować `GarminLink.swift` do `mobile/ios-src/RideEngine/` (`setup-ios.sh` doda go do targetu).
4. `SceneDelegate.scene(_:openURLContexts:)` → `GarminLink.shared.handle(url:)`.
5. `RideEnginePlugin.load()`:
   - `GarminLink.shared.configure()`;
   - `onLive` → na `engineQueue`: `engine.ingestPower / ingestHr / ingestCadence` + `advance()` – tylko gdy nie ma
     połączonych czujników Bluetooth (jedno źródło danych naraz);
   - `onTalk` → to samo co `talk()` (pytanie do Enzo przez mikrofon słuchawek);
   - odpowiedź Enzo (zdarzenie `coach` „answer”) → `GarminLink.shared.sendEnzoAnswer(text)`;
   - `onStatus` → zdarzenie `garmin` do JS + karta w „Czujnikach” (wybór licznika: `chooseDevice()`).
6. Metody pluginu `garminStatus / garminChoose / garminForget` + typy w `lib/ride/ride-engine.ts`.

## Decyzja do podjęcia: kto prowadzi trening

Licznik ma własny silnik (ten sam co telefon, zgodność sprawdzana testami). Gdy telefon dostaje dane z licznika, są dwie drogi:

- **Licznik prowadzi, telefon mówi** – telefon nie uruchamia swojego silnika, tylko zamienia zdarzenia `cue`
  (klucz + zmienne, te same co w `FLEX_PHRASES`) na klipy Enzo przez `DirectorVoice.compose`. Jeden stan treningu,
  zero rozjazdów. Zalecane.
- **Telefon prowadzi** – licznik jest tylko źródłem czujników i ekranem. Mniej zmian w iOS, ale dwa silniki
  mogą różnić się o sekundy (dane po Bluetooth przychodzą z opóźnieniem i bywają gubione).

## Do sprawdzenia na sprzęcie

- Czy Mobile SDK na iOS widzi aplikację wgraną kablem (`.prg`), czy wymaga instalacji ze sklepu Connect IQ
  (wersja beta) – w zgłoszeniach na forum Garmina wgrane ręcznie aplikacje bywają niewidoczne dla SDK.
- Przepustowość: licznik wysyła najwyżej jedną wiadomość naraz; próbka „live” czekająca na wysłanie jest zastępowana nowszą.
- W symulatorze Connect IQ w kontenerze `Communications.transmit` zatrzymuje aplikację, więc ta ścieżka nie jest
  pokryta testami automatycznymi – stąd domyślne wyłączenie.
