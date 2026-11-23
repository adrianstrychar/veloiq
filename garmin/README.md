# VeloIQ na Garmin Edge

Aplikacja urządzenia Connect IQ (`watch-app`), która na liczniku Garmin zastępuje natywny ekran jazdy i treningu:
prowadzi trening z planu VeloIQ tym samym silnikiem co telefon, nagrywa jazdę do FIT, pokazuje własne pola danych,
ma przycisk Enzo i sama wysyła jazdę do VeloIQ – bez Stravy po drodze.

Urządzenia: **Edge 1030** (główny cel), 1030 Plus, 1030 Bontrager, 830, 530, 1040, 840, 540, 1050.
Układ ekranów jest liczony z rozmiaru ekranu i wysokości czcionek, więc ten sam kod działa na 282×470, 246×322 i 480×800.

## Co robi

| Obszar | Jak |
|---|---|
| **Czujniki** | Moc, tętno, kadencja, prędkość, temperatura i GPS z czujników sparowanych z licznikiem (ANT+ / BLE) – aplikacja niczego nie paruje sama. Czujnik, który zamilknie, po 5 s pokazuje `--` zamiast zamrożonej liczby. |
| **Trening z planu** | Po synchronizacji licznik ma treningi na dziś i 6 kolejnych dni (te same waty co w zakładce „Jedź”). Działa bez telefonu – plan leży w pamięci licznika. |
| **Silnik elastyczny** | Port `lib/ride/flex-engine.ts`: interwał rusza, gdy zawodnik faktycznie przyspieszy (start cofany do pierwszej sekundy wzrostu), **falstart** (automatyczny i przyciskiem), auto-pauza w interwale, wcześniejsze przerwanie, interwały łańcuchowe (over-under), korekty „za mocno / za słabo” liczone na średniej, tętno ponad strefą, podsumowanie serii z oceną, przypomnienia o jedzeniu i piciu, odprawa (gotowość, kondycja dnia). |
| **Jazda swobodna** | Automatyczne wykrywanie wysiłków ≥ 2 min (jak w telefonie), kolor mocy według strefy, pasek stref Z1–Z7. |
| **Auto-lapy** | W planie: lap na każdej zmianie kroku (start interwału, koniec, przerwa). Poza planem do wyboru: wysiłki i podjazdy (lap na początku i końcu mocnego odcinka oraz na początku i na szczycie podjazdu – z trasy GPX albo z wysokościomierza), co 5/10 km, co 10 min, wyłączone. Przycisk Lap: w planie następny krok („start teraz”, gdy silnik czeka), poza planem zwykłe okrążenie. |
| **Auto-pauza jazdy** | Jak w telefonie: zero mocy i kadencji, a na zewnątrz dodatkowo < 3 km/h przez 3 s; wznowienie po 2 s ruchu. |
| **Własne pola danych** | 38 pól (moc 3/10/30 s, NP, IF, TSS, kJ, W'bal, moc i czas okrążenia, cel kroku, do końca kroku / planu, zgodność z planem, % FTP, W/kg, strefa, do mety, do skrętu, do szczytu, cel podjazdu…). Dwie strony po 4–10 pól, ustawiane na liczniku (MENU → Ustawienia → Pola danych albo MENU w trakcie jazdy). |
| **Ekrany jazdy** | TRENING (moc dużymi cyframi z własnej czcionki, w kolorze względem celu; pasek celu, odliczanie, przycisk FALSTART, tętno / kadencja / prędkość / średnia lapa, profil treningu), DANE 1, DANE 2, OKRĄŻENIA / SERIE, ENZO (historia komunikatów) i – gdy jest trasa – TRASA. Komunikaty silnika jako baner + sygnał dźwiękowy, 3-2-1 dużą cyfrą. |
| **Enzo** | Przycisk ENZO → lista pytań („Jak mi idzie?”, „Co dalej?”, „Jeść albo pić?”…) → odpowiedź trenera na ekranie (`/api/garmin/ask`, ten sam Enzo i te same dane co w rozmowie głosowej). Enzo może też wykonać polecenie (następny krok, pauza, falstart). |
| **Plik FIT** | Zwykła aktywność kolarska w historii licznika (→ Garmin Connect → Strava) + pola VeloIQ: cel mocy i W'bal w każdej sekundzie, cel i rodzaj kroku na lapach, NP / TSS / IF / zgodność w podsumowaniu. |
| **Wysyłka do VeloIQ** | Po zapisie licznik wysyła podsumowanie, serie, lapy, wysiłki, próbki co 5 s i ślad GPS co 10 s. Jazda trafia do `rides` i na listę aktywności tą samą drogą co jazda z telefonu; gdy ta sama jazda przyjdzie potem ze Stravy, kopie same się scalają. Bez telefonu w chwili zapisu jazda czeka w pamięci licznika. |
| **Nawigacja po trasie GPX** | Trasa wybrana w „Jedź” (przycisk „Wyślij tę trasę na licznik”) trafia na licznik przy synchronizacji: uproszczony ślad (do 1496 punktów), skręty wyliczone z geometrii, podjazdy z wysokości. Strona TRASA: strzałka i dystans do skrętu, mapa śladu (kierunkiem jazdy do góry; dotknięcie zmienia skalę 400 m → 1 km → 3 km → 10 km → cała trasa), profil wysokości przed nami, najbliższy podjazd, moc / prędkość / do mety. Komunikaty: skręt (500 lub 300 m wcześniej i „teraz”), podjazd za kilometr, start podjazdu, szczyt, kilometry do mety, zjechanie z trasy i powrót. Bez mapy drogowej i bez wyznaczania trasy – to prowadzenie po śladzie. |
| **Podjazdy z celem mocy** | W trybie startowym (strategia wyścigu) podjazdy trasy mają cel mocy i taktykę. W jeździe swobodnej ekran TRENING na takim podjeździe zachowuje się jak krok planu: „PODJAZD 2/5”, cel, pasek celu, kolor mocy względem celu, „DO SZCZYTU”. |
| **Przerwana jazda** | Co minutę (i przy pauzie) licznik zapisuje punkt kontrolny: próbki, ślad GPS, liczniki. Po wyłączeniu licznika albo awarii ekran startowy proponuje WZNÓW (silnik odtwarza zapisane próbki – krok planu, serie, NP i TSS wracają – i jazda toczy się dalej w tej samej aktywności VeloIQ) albo ZAKOŃCZ (zapis i wysyłka tego, co było). Punkt starszy niż 12 h jest domykany i wysyłany sam. Plik FIT w historii licznika ma wtedy dwie części: przed przerwą i po niej. |
| **Most do telefonu** | Czujniki sparowane tylko z licznikiem (ANT+), a aplikacja VeloIQ na iPhonie dostaje z niego co sekundę moc, tętno i kadencję oraz komunikaty silnika i nawigacji – i mówi je głosem Enzo. Przycisk ENZO na liczniku uruchamia pytanie głosowe w telefonie, odpowiedź wraca też na ekran licznika; polecenia głosowe (następny lap, pauza, falstart, zjadłem) sterują licznikiem. Włącza się sam, gdy telefon się przedstawi (albo MENU → Ustawienia → Most do telefonu). Szczegóły i ograniczenia: `mobile/GARMIN-LINK.md`. |

## Sterowanie

| | Ekran startowy | W trakcie jazdy |
|---|---|---|
| **Start/Stop** | start treningu z planu (albo jazdy swobodnej) | pauza + menu: Wznów / Zapisz / Odrzuć |
| **Lap** | menu | następny krok / okrążenie |
| **Przesunięcie w bok** (albo góra/dół) | – | zmiana strony |
| **Menu** (☰ albo przycisk menu) | synchronizacja, wybór treningu, parowanie, ustawienia | Enzo, falstart, następny krok, zjadłem / wypiłem, pola danych, zakończ |
| **Wstecz** | wyjście z aplikacji | menu jazdy (nie zamyka aplikacji w trakcie nagrywania) |

## Instalacja na liczniku (wersja testowa)

1. Pobierz `veloiq-edge1030.prg` z artefaktów ostatniego przebiegu **Garmin Connect IQ** (zakładka Actions w GitHubie → `veloiq-garmin`). Ten sam plik jest też w logu przebiegu (linie `PRGB64`, suma kontrolna w `PRGSHA`).
2. Podłącz Edge kablem USB do komputera i skopiuj plik do katalogu `GARMIN/APPS` na liczniku.
3. Odłącz licznik. Aplikacja jest w **IQ → VeloIQ** (na Edge 1030: ekran główny → ikona Connect IQ).
4. W VeloIQ na liczniku: **MENU → Sparuj z VeloIQ**. Licznik pokaże 6 cyfr.
5. W aplikacji VeloIQ (telefon albo przeglądarka): **Jedź → Czujniki → Licznik Garmin Edge → Połącz licznik Garmin** i wpisz kod.
6. Licznik pokaże „Sparowano!” i pobierze plan. Od tej chwili synchronizuje się przy każdym uruchomieniu aplikacji.

Parowanie i synchronizacja idą przez internet telefonu (Garmin Connect musi być połączony z licznikiem) albo przez Wi-Fi licznika.
Wersję do sklepu Connect IQ trzeba podpisać własnym kluczem dewelopera Garmin (`DEVELOPER_KEY=… ci/build.sh`).

## Serwer

| Endpoint | Kto | Co |
|---|---|---|
| `POST /api/garmin/pair` | licznik | prośba o kod parowania |
| `GET /api/garmin/pair?device=&secret=` | licznik | czy kod został wpisany → token urządzenia |
| `POST /api/garmin/pair/confirm` | zalogowany zawodnik | wpisanie kodu z licznika |
| `GET / DELETE /api/garmin/devices` | zalogowany zawodnik | lista i odłączanie liczników |
| `GET /api/garmin/sync` | licznik (token) | zawodnik, treningi na 7 dni, odprawa, identyfikator trasy, token rozmowy z trenerem dla mostu |
| `GET / POST / DELETE /api/garmin/course` | zalogowany zawodnik | trasa GPX dla licznika: podgląd, wysyłka (RideRoute z „Jedź”), usunięcie |
| `GET /api/garmin/course/part?i=meta|N` | licznik (token) | nagłówek trasy (skręty, podjazdy) i kolejne części punktów |
| `POST /api/garmin/ride` | licznik (token) | wysyłka jazdy: `begin` → `chunk`… → `finish` |
| `POST /api/garmin/ask` | licznik (token) | pytanie do Enzo, odpowiedź na ekran |

Token urządzenia jest w bazie tylko jako skrót SHA-256; odłączenie licznika w aplikacji unieważnia go natychmiast.
Tabele i kolumna `rides.extra`: **`supabase/migrations/026_garmin.sql`** (uruchomić ręcznie w Supabase Studio – bez tego parowanie zwraca błąd, a karta w Czujnikach to pokazuje).

## Kod

```
garmin/
  manifest.xml, monkey.jungle        aplikacja i lista urządzeń
  source/Engine.mc                   silnik treningu (port flex-engine.ts)
  source/Metrics.mc, Stores.mc       NP/TSS/IF, krzywa mocy, W'bal; historia 1 Hz w pierścieniu bajtów
  source/Ride.mc                     kontroler jazdy: czujniki + silnik + FIT + lapy + komunikaty + wysyłka
  source/SensorHub.mc, Recorder.mc   czujniki licznika, nagrywanie FIT z polami VeloIQ
  source/Api.mc, PhoneLink.mc        API VeloIQ i kolejka wysyłki; most do telefonu
  source/RideScreen.mc, HomeScreen.mc, OtherViews.mc, Menus.mc, Ui.mc   ekrany, menu, pola danych
  source/tests/                      testy zgodności silnika i testy dymne (uruchamiane w symulatorze)
  source/Demo.mc, monkey.demo.jungle tryb demo do zrzutów ekranu (poza zwykłym buildem)
  ci/build.sh, ci/screens.sh         build wszystkich urządzeń + testy; zrzuty ekranu z symulatora
  ci/parity/gen.ts                   generator testów zgodności z silnika referencyjnego
lib/garmin/, app/api/garmin/         strona serwera
components/ride/GarminCard.tsx       karta parowania w „Czujnikach”
mobile/GARMIN-LINK.md               most do telefonu: protokół, kod po stronie iPhone'a, co sprawdzić na sprzęcie
```

## Budowanie i testy

CI (`.github/workflows/garmin.yml`) przy każdej zmianie w `garmin/`: build dla 9 urządzeń, testy w symulatorze Connect IQ,
zrzuty ekranu z trybu demo; pliki `.prg` i zrzuty są w artefaktach przebiegu.

Lokalnie (Connect IQ SDK w `PATH`, pliki urządzeń pobrane w SDK Managerze):

```bash
cd garmin
ci/build.sh                          # wszystko
DEVICES=edge1030 SKIP_TESTS=1 ci/build.sh
DEVICE=edge1030 ci/screens.sh        # zrzuty do bin/shots/
npx -y tsx --tsconfig ../tsconfig.json ci/parity/gen.ts > source/tests/ParityData.mc   # po zmianie flex-engine.ts
npm run check:garmin                 # logika serwera (z katalogu repo)
```

**Testy zgodności silnika**: 7 scenariuszy jazdy (start spóźniony i przedwczesny, falstart, auto-pauza, przerwanie,
over-under, tętno ponad strefą, sprinty, jazda swobodna, brak czujników) przechodzi przez silnik referencyjny z telefonu
(`flex-engine.ts`) i przez silnik na Garmina; porównywane są co do sekundy: każdy komunikat, każda seria (moc, zgodność,
ocena), wysiłki, lapy i podsumowanie (NP, kJ, tętno). Zmiana logiki w telefonie → przegenerować `ParityData.mc`, a test
pokaże, co trzeba przenieść na licznik.

## Symulator w przeglądarce

`garmin/sim/build.sh` składa jedną stronę HTML: ekran Edge 1030 odwzorowany na płótnie, napędzany silnikiem referencyjnym
(`lib/ride/flex-engine.ts`), z suwakiem mocy, autopilotem i przyspieszaniem czasu. Służy do sprawdzania zachowania treningu
(start po mocy, falstart, auto-pauza, korekty, serie, lapy) bez licznika. To odwzorowanie ekranów, nie aplikacja Garmina –
prawdziwą aplikację uruchamia symulator Connect IQ (`ci/screens.sh`).

## Znane ograniczenia

- Nie testowane na fizycznym liczniku – tylko w symulatorze Connect IQ (patrz opis PR: co zweryfikowano i jak).
- Po awaryjnym zamknięciu aplikacji jazda jest zapisywana do FIT, ale silnika nie da się wznowić w środku treningu.
- Lapów FIT nie da się cofnąć: start interwału wykryty po mocy trafia do FIT kilka sekund po faktycznym starcie,
  a odwołany falstart zostaje jako krótki lap. Dokładne czasy serii są w danych wysyłanych do VeloIQ.
- Wysyłane próbki mają rozdzielczość 5 s (krzywa mocy na liczniku jest liczona z 1 Hz i idzie w podsumowaniu).
  Pełne 1 Hz dociera przez Stravę, jeśli jest połączona.
- Komunikaty są po polsku; nawigacja po trasie GPX, tryb startowy (cele na podjazdy) i trenażer smart – jeszcze nie.
- Enzo na liczniku odpowiada tekstem. Głos w słuchawkach wymaga mostu do telefonu (następny krok).
