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
        Cfg.put("autoPause", false); Cfg.put("tones", false); Cfg.put("phoneLink", false);
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

    function shot(name as String) as Void {
        System.println("SHOT " + name);
        wait = 3;
    }

    function tick(r) as Void {
        if (wait > 0) { wait--; return; }
        var s = stage;
        stage++;
        if (s == 0) { r.hub.power = 0; r.hub.hr = 68; shot("01-start"); }
        else if (s == 1) { r.plan = plan(); r.startRide(false); ff(r, 95, 176, 121, 88); r.uiPage = 0; shot("02-rozgrzewka"); }
        else if (s == 2) { ff(r, 146, 180, 124, 88); shot("03-zapowiedz"); }
        else if (s == 3) { ff(r, 66, 182, 126, 88); ff(r, 9, 306, 139, 93); shot("04-start-interwalu"); }
        else if (s == 4) { ff(r, 200, 305, 164, 93); shot("05-interwal"); }
        else if (s == 5) { ff(r, 20, 338, 168, 96); r.uiPage = 1; shot("06-pola-1"); }
        else if (s == 6) { r.uiPage = 2; shot("07-pola-2"); }
        else if (s == 7) { ff(r, 252, 304, 167, 92); r.uiPage = 0; shot("08-koniec-serii"); }
        else if (s == 8) { ff(r, 150, 150, 140, 84); r.uiPage = 3; shot("09-okrazenia"); }
        else if (s == 9) { r.uiPage = 4; shot("10-enzo"); }
        else if (s == 10) { r.uiPage = 0; r.showEnzo("Bravissimo! Pierwsza seria 305 watów, idealnie w celu. Tętno 140 i spada. Zjedz teraz żel, za 90 sekund ruszamy drugą."); shot("11-enzo-odpowiedz"); }
        else if (s == 11) { r.dismissEnzo(); r.pause(); shot("12-pauza"); }
        // dłuższe odcinki dzielimy na etapy – jedno wywołanie zegara ma limit czasu wykonania
        else if (s == 12) { r.resume(); ff(r, 95, 150, 138, 84); ff(r, 200, 318, 170, 93); wait = 0; }
        else if (s == 13) { ff(r, 278, 318, 172, 93); wait = 0; }
        else if (s == 14) { ff(r, 60, 150, 150, 80); r.uiPage = 3; shot("13-serie"); }
        else if (s == 15) { r.finish(true); shot("14-podsumowanie"); }
        else if (s == 16) {
            r.reset();
            Cfg.put("theme", 1); Cfg.put("ftp", 305); Cfg.load(); Th.apply(1);
            r.plan = null; r.startRide(true);
            ff(r, 300, 185, 128, 86);
            wait = 0;
        }
        else if (s == 17) { ff(r, 150, 318, 165, 94); r.uiPage = 0; shot("15-swobodna-jasny"); }
        else if (s == 18) { r.uiPage = 3; shot("16-swobodna-okrazenia"); }
        else if (s == 19) {
            // na koniec kilkanaście sekund PRAWDZIWEJ ścieżki: zegar 1 Hz, czujniki symulatora, auto-pauza, dane z Activity.Info
            r.finish(false); r.reset(); Th.apply(0);
            Cfg.put("theme", 0); Cfg.put("autoPause", true); Cfg.load();
            r.plan = plan(); r.startRide(false);
            wait = 14;
        }
        else if (s == 20) {
            System.println("REAL s=" + (r.eng == null ? -1 : r.eng.s) + " state=" + r.state + " simulated=" + r.hub.simulated);
            r.uiPage = 0; shot("17-prawdziwe-czujniki");
        }
        else if (s == 21) { r.finish(false); r.reset(); System.println("SHOT END"); }
    }
}
