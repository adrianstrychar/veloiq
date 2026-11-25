import Toybox.Application;
import Toybox.Lang;
import Toybox.System;

// Tryb demonstracyjny do zrzutów ekranu w symulatorze (CI: garmin/ci/screens.sh, monkey.demo.jungle).
// W zwykłym buildzie moduł jest pusty – adnotacja (:demo) jest wykluczona w monkey.jungle.

(:nodemo)
module Demo {
    function boot(r) as Void {}
    function tick(r) as Void {}
}

(:demo)
module Demo {
    var stage as Number = 0;
    var wait as Number = 3;
    var t as Number = 0;

    function plan() {
        var d = {
            "id" => "plan-demo", "name" => "Threshold 2x8 min", "type" => "THR", "date" => "", "tss" => 71,
            "steps" => [["Rozgrzewka", 0, 300, 155, 200, 0, 0, 0, 0, 142], ["Interwał 1", 1, 480, 296, 314, 85, 100, 0, 0, 0],
                ["Przerwa", 2, 240, 120, 185, 0, 0, 0, 0, 132], ["Interwał 2", 1, 480, 296, 314, 85, 100, 0, 0, 0],
                ["Schłodzenie", 4, 300, 135, 170, 0, 0, 0, 0, 0]]
        };
        var w = Workout.fromDict(d, 305, 67);
        w.date = getRide().todayIso();
        return w;
    }

    function boot(r) as Void {
        Application.Storage.clearValues();
        Cfg.put("token", "demo"); Cfg.put("athlete", "Adrian"); Cfg.put("ftp", 305); Cfg.put("hrmax", 189);
        Cfg.put("autoPause", false); Cfg.put("tones", false); Cfg.put("link", false);
        Cfg.put("apiBase", "https://localhost");     // demo nie rozmawia z prawdziwym serwerem
        Cfg.load();
        r.plan = plan();
    }

    //! n sekund jazdy z zadaną mocą (lekki, powtarzalny szum).
    function ff(r, n as Number, pw as Number, hr as Number, cad as Number) as Void {
        for (var i = 0; i < n; i++) {
            t++;
            var p = pw > 0 ? pw + ((t * 7919) % 11) - 5 : 0;
            r.simTick(p, hr, cad, pw > 0 ? 8.6 : 0.0);
        }
    }

    var track = null;
    var ti as Number = 0;

    //! n sekund jazdy po trasie demonstracyjnej (10 m na sekundę) z zadaną mocą.
    function drive(r, n as Number, pw as Number, hr as Number, cad as Number) as Void {
        if (track == null) { track = DemoCourse.drive(); }
        for (var i = 0; i < n && ti * 2 + 1 < track.size(); i++) {
            t++;
            r.simPos(track[ti * 2], track[ti * 2 + 1]);
            ti++;
            r.simTick(pw + ((t * 7919) % 11) - 5, hr, cad, 10.0);
        }
    }

    function shot(name as String) as Void {
        System.println("SHOT " + name);
        wait = 3;
    }

    function tick(r) as Void {
        if (wait > 0) { wait--; return; }
        var s = stage;
        stage++;
        if (s == 0) { r.hub.power = 0; r.hub.hr = 68; shot("01-start"); }
        else if (s == 1) { r.plan = plan(); r.startRide(false); ff(r, 95, 176, 121, 88); r.uiPage = Pg.MAIN; shot("02-rozgrzewka"); }
        else if (s == 2) { ff(r, 146, 180, 124, 88); shot("03-zapowiedz"); }
        else if (s == 3) { ff(r, 66, 182, 126, 88); ff(r, 9, 306, 139, 93); shot("04-start-interwalu"); }
        else if (s == 4) { ff(r, 200, 305, 164, 93); shot("05-interwal"); }
        else if (s == 5) { ff(r, 20, 338, 168, 96); r.uiPage = Pg.F1; shot("06-pola-1"); }
        else if (s == 6) { r.uiPage = Pg.F2; shot("07-pola-2"); }
        else if (s == 7) { ff(r, 252, 304, 167, 92); r.uiPage = Pg.MAIN; shot("08-koniec-serii"); }
        else if (s == 8) { ff(r, 150, 150, 140, 84); r.uiPage = Pg.LAPS; shot("09-okrazenia"); }
        else if (s == 9) { r.uiPage = Pg.ENZO; shot("10-enzo"); }
        else if (s == 10) { r.uiPage = Pg.MAIN; r.showEnzo("Bravissimo! Pierwsza seria 305 watów, idealnie w celu. Tętno 140 i spada. Zjedz teraz żel, za 90 sekund ruszamy drugą."); shot("11-enzo-odpowiedz"); }
        else if (s == 11) { r.dismissEnzo(); r.pause(); shot("12-pauza"); }
        // dłuższe odcinki dzielimy na etapy – jedno wywołanie zegara ma limit czasu wykonania
        else if (s == 12) { r.resume(); ff(r, 95, 150, 138, 84); ff(r, 200, 318, 170, 93); wait = 0; }
        else if (s == 13) { ff(r, 278, 318, 172, 93); wait = 0; }
        else if (s == 14) { ff(r, 60, 150, 150, 80); r.uiPage = Pg.LAPS; shot("13-serie"); }
        else if (s == 15) { r.uiPage = Pg.CHART; shot("13a-wykres"); }
        else if (s == 16) { r.uiPage = Pg.EFFORT; shot("13b-wysilek"); }
        else if (s == 17) { r.fuel(25); r.fuel(25); r.fuel(0); r.banner = null; r.uiPage = Pg.FUEL; shot("13c-paliwo"); }
        else if (s == 18) { r.finish(true); shot("14-podsumowanie"); }
        else if (s == 19) { r.up.doneKey = r.startEpoch; r.up.status = "Jazda w VeloIQ 20:24"; shot("14a-wyslane"); }
        else if (s == 20) {
            r.reset();
            Cfg.put("theme", 1); Cfg.put("ftp", 305); Cfg.load(); Th.apply(1);
            r.plan = null; r.startRide(true);
            ff(r, 300, 185, 128, 86);
            wait = 0;
        }
        else if (s == 21) { ff(r, 150, 318, 165, 94); r.uiPage = Pg.MAIN; shot("15-swobodna-jasny"); }
        else if (s == 22) { r.uiPage = Pg.LAPS; shot("16-swobodna-okrazenia"); }
        else if (s == 23) {
            // na koniec kilkanaście sekund PRAWDZIWEJ ścieżki: zegar 1 Hz, czujniki symulatora, auto-pauza, dane z Activity.Info
            r.finish(false); r.reset(); Th.apply(0);
            Cfg.put("theme", 0); Cfg.put("autoPause", true); Cfg.load();
            wait = 2;       // nowa sesja FIT dopiero w następnym wywołaniu zegara
        }
        else if (s == 24) { r.plan = plan(); r.startRide(false); wait = 14; }
        else if (s == 25) {
            System.println("REAL s=" + (r.eng == null ? -1 : r.eng.s) + " state=" + r.state + " simulated=" + r.hub.simulated);
            r.uiPage = Pg.MAIN; shot("17-prawdziwe-czujniki");
        }
        // --- nawigacja po trasie GPX: jazda swobodna po pętli demonstracyjnej z podjazdem i celem mocy ze strategii
        else if (s == 26) {
            r.finish(false); r.reset();
            Cfg.put("autoPause", false); Cfg.put("autoLapMode", 0); Cfg.load();
            DemoCourse.install();
            r.course = Course.load();
            r.plan = null;
            r.hub.power = 0; r.hub.hr = 71;
            shot("18-start-z-trasa");
        }
        else if (s == 27) { r.startRide(true); drive(r, 100, 205, 134, 89); wait = 1; }     // strona ustawiana po starcie (start wraca na TRENING)
        else if (s == 28) { r.banner = null; r.uiPage = Pg.NAV; r.uiZoom = 1; shot("19-trasa-skret"); }
        else if (s == 29) { drive(r, 18, 240, 141, 88); r.uiPage = Pg.MAIN; shot("20-teraz-w-prawo"); }
        else if (s == 30) { drive(r, 72, 291, 158, 84); r.banner = null; shot("21-podjazd-cel"); }
        else if (s == 31) { r.banner = null; r.uiPage = Pg.CLIMB; shot("21a-podjazd"); }
        else if (s == 32) { r.uiPage = Pg.NAV; r.uiZoom = 4; shot("22-trasa-cala"); }
        else if (s == 33) { drive(r, 76, 289, 163, 83); r.uiZoom = 0; shot("23-trasa-w-lewo"); }
        else if (s == 34) { r.finish(false); r.reset(); System.println("SHOT END"); }
    }
}
