// Test komend głosowych w jeździe (RideEnginePlugin.voiceCommand) – uruchamiany w CI iOS:
// workflow wycina funkcję z RideEnginePlugin.swift do `enum V { … }` i dokleja ten plik (swift <plik>).
// Tekst składamy tak samo jak localAnswer: małe litery, bez polskich znaków, „ł” → „l”.

func fold(_ q: String) -> String {
    q.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pl_PL"))
        .replacingOccurrences(of: "ł", with: "l")
}

var failed = 0
func expect(_ said: String, _ action: String?) {
    let got = V.voiceCommand(fold(said), original: said)?.action
    let ok = got == action
    if !ok { failed += 1 }
    print("\(ok ? "ok  " : "FAIL") „\(said)” → \(got ?? "nil")\(ok ? "" : "   (oczekiwane: \(action ?? "nil"))")")
}

// nawigacja
expect("Prowadź do Szklarskiej Poręby", "route:place:Szklarskiej Poręby")
expect("jedź do Jeleniej Góry.", "route:place:Jeleniej Góry")
expect("Zabierz mnie do najbliższej kawiarni", "route:poi:cafe")
expect("Gdzie jest najbliższa woda?", "route:poi:water")
expect("prowadź do najbliższego serwisu rowerowego", "route:poi:bike")
expect("znajdź stację paliw", "route:poi:fuel")
expect("Prowadź do Wodospadu Szklarki", "route:place:Wodospadu Szklarki")
expect("zabierz mnie do domu", "route:start")
expect("prowadź do startu", "route:start")
expect("Wróć na trasę", "route:rejoin")
expect("zgubiłem się", "route:rejoin")
// plan treningu
expect("dodaj dwie minuty", "extend:120")
expect("skróć przerwę o 30 sekund", "extend:-30")
expect("przedłuż interwał o minutę", "extend:60")
expect("mocniej o 5 procent", "bias:+5")
expect("lżej", "bias:-5")
expect("cele jak w planie", "bias:0")
expect("jeszcze jeden interwał", "repeat")
// ekrany licznika
expect("pokaż paliwo", "page:paliwo")
expect("pokaż mapę", "page:mapa")
expect("pokaż wysiłek", "page:wysilek")
// pytania idą do trenera AI, nie są poleceniami
expect("ile mam jeszcze do końca?", nil)
expect("czy dobrze jadę", nil)

print(failed == 0 ? "KOMENDY OK" : "KOMENDY FAIL: \(failed)")
if failed > 0 { exit(1) }
