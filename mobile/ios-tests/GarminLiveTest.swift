// Test parsowania próbki „live” z licznika (GarminLive) – uruchamiany w CI iOS: workflow wycina strukturę
// z GarminLink.swift i dokleja ten plik. Liczby z Connect IQ przychodzą jako NSNumber (Int, Int64, Double).

var failed = 0
func check(_ name: String, _ ok: Bool) {
    if !ok { failed += 1 }
    print("\(ok ? "ok  " : "FAIL") \(name)")
}

// jazda (17 pól, wersja ≥ 0.2.2): moc 245, tętno 150, kadencja 90, 32,4 km/h, krok 1, cel 230–250
let ride: [Any] = [NSNumber(value: 61), NSNumber(value: 245), NSNumber(value: 150), NSNumber(value: 90), NSNumber(value: 324),
                   NSNumber(value: 0), NSNumber(value: 1), NSNumber(value: 239), NSNumber(value: 230), NSNumber(value: 250), NSNumber(value: 0),
                   NSNumber(value: 243), NSNumber(value: 241), NSNumber(value: 0), NSNumber(value: 0), NSNumber(value: Int64(1834)), NSNumber(value: 61)]
if let l = GarminLive(ride) {
    check("jazda: moc, tętno, kadencja", l.power == 245 && l.hr == 150 && l.cadence == 90)
    check("jazda: prędkość 32,4 km/h", abs((l.speedKmh ?? 0) - 32.4) < 0.01)
    check("jazda: krok, cel, dystans, sekundy kroku", l.stepIndex == 1 && l.targetLow == 230 && l.targetHigh == 250 && l.distanceM == 1834 && l.stepElapsed == 61)
} else { check("jazda: próbka odczytana", false) }

// liczby zmiennoprzecinkowe (Double) też muszą przejść
let dbl: [Any] = ride.enumerated().map { i, x in i == 4 ? NSNumber(value: 324.0) : x }
check("Double w próbce", GarminLive(dbl)?.speedKmh != nil)

// podgląd czujników przed startem (11 pól): bez czujników → nil
let idle: [Any] = [-1, -1, 0, -1, -1, 4, 0, 0, 0, 0, 0].map { NSNumber(value: $0) }
if let l = GarminLive(idle) {
    check("podgląd: bez czujników", l.second == -1 && l.power == nil && l.hr == nil && l.cadence == nil && l.speedKmh == nil)
} else { check("podgląd: próbka odczytana", false) }

// stara wersja aplikacji (10 pól) i uszkodzona próbka
check("10 pól (stara wersja)", GarminLive(Array(idle.prefix(10))) != nil)
check("za krótka próbka odrzucona", GarminLive(Array(idle.prefix(5))) == nil)
check("null w próbce odrzucony", GarminLive(idle.enumerated().map { i, x in i == 2 ? NSNull() : x }) == nil)

print(failed == 0 ? "PRÓBKI OK" : "PRÓBKI FAIL: \(failed)")
if failed > 0 { exit(1) }
