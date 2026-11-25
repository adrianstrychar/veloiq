import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Test;
import Toybox.WatchUi;

// Testy dymne w symulatorze: cała ścieżka jazdy (start → kroki → pauza → zapis → kolejka wysyłki) i rysowanie
// każdego ekranu w każdym stanie na ekranie pozaekranowym. Wyjątek w dowolnym miejscu = błąd testu ze stosem.

(:test)
module Smoke {

    var bmp = null;

    function dc() as Graphics.Dc {
        bmp = new Graphics.BufferedBitmap({ :width => 282, :height => 470 });
        return bmp.getDc();
    }

    function plan() as Workout {
        var d = {
            "id" => "plan-test", "name" => "Threshold 2x8 min", "type" => "THR", "date" => "2026-11-23", "tss" => 62,
            "steps" => [["Rozgrzewka", 0, 120, 150, 195, 0, 0, 0, 0, 142], ["Interwał 1", 1, 120, 290, 310, 85, 95, 0, 0, 0],
                ["Przerwa", 2, 90, 120, 180, 0, 0, 0, 0, 132], ["Interwał 2", 1, 120, 290, 310, 0, 0, 0, 0, 0],
                ["Schłodzenie", 4, 60, 135, 165, 0, 0, 0, 0, 0]]
        };
        var w = Workout.fromDict(d, 300, 67);
        w.applyBrief({ "readiness" => 72, "state" => "Dobra gotowość", "hrA" => 70.0, "hrB" => 0.3 });
        return w;
    }

    function drawAll(scr as RideScreen, g as Graphics.Dc) as Void {
        for (var p = 0; p < scr.pageCount(); p++) {
            scr.page = p;
            scr.draw(g);
        }
    }

    function cleanup() as Void {
        Application.Storage.clearValues();
        Cfg.load();
        getRide().interrupted = null;
    }
}

(:test)
function testSmokeHome(logger as Test.Logger) as Boolean {
    Smoke.cleanup();
    var r = getRide();
    var g = Smoke.dc();
    var home = new HomeScreen();
    r.plan = null;
    home.draw(g);                       // nie sparowano, bez planu
    Cfg.put("token", "t"); Cfg.put("athlete", "Adrian"); Cfg.load();
    r.plan = Smoke.plan();
    home.flash("Pobrano: Threshold");
    home.draw(g);                       // sparowany, z planem
    Th.apply(1);
    home.draw(g);                       // jasny motyw
    Th.apply(0);
    // menu budują się bez błędów
    Menus.home(); Menus.settings(); Menus.pause(); Menus.questions(); Menus.workouts(); Menus.fields(0); Menus.fields(1); Menus.fieldChoice();
    var pv = new PairView(home);
    pv.onUpdate(g);
    pv.code = "482913";
    pv.onUpdate(g);
    var fv = new FtpView();
    fv.change(5);
    fv.onUpdate(g);
    Smoke.cleanup();
    return home.hits.size() >= 2;
}

(:test)
function testSmokePlanRide(logger as Test.Logger) as Boolean {
    Smoke.cleanup();
    var r = getRide();
    var g = Smoke.dc();
    var scr = new RideScreen();
    Cfg.put("autoPause", false); Cfg.put("indoor", true); Cfg.put("tones", false); Cfg.put("link", false); Cfg.load();
    r.plan = Smoke.plan();
    r.finish(false);
    r.reset();
    r.plan = Smoke.plan();
    if (!r.startRide(false)) { logger.debug("startRide failed"); return false; }
    var e = r.eng;
    var phases = {};
    var sawFs = false;
    // rozgrzewka → spóźniony start interwału → interwał z postojem → przerwa → drugi interwał (za mocno) → schłodzenie
    for (var i = 0; i < 560; i++) {
        var p = 170;
        if (i >= 130 && i < 250) { p = 302; }
        if (i >= 180 && i < 190) { p = 0; }
        if (i >= 250 && i < 330) { p = 140; }
        if (i >= 330 && i < 455) { p = 345; }
        if (i >= 455) { p = 150; }
        r.simTick(p, 120 + (p / 10), p == 0 ? 0 : 88, 8.0);
        phases.put(e.phase, true);
        if (e.falseStartLeft() > 0) { sawFs = true; }
        // wszystkie strony co kilka sekund; z banerem częściej, ale tylko stronę główną (symulator rysuje wolno)
        if (i % 10 == 0) { Smoke.drawAll(scr, g); }
        else if (r.banner != null && i % 3 == 0) { scr.page = (i / 3) % scr.pageCount(); scr.draw(g); }
        if (i == 140) { Menus.ride(scr); Menus.enzo(); }
        if (i == 200) { r.showEnzo("Bravissimo! Trzymasz 302 waty, dokładnie w celu. Jeszcze dwie minuty, forca!"); Smoke.drawAll(scr, g); r.dismissEnzo(); }
        if (i == 300) { r.pause(); Smoke.drawAll(scr, g); scr.tap(100, 300); r.resume(); }
    }
    logger.debug("fitFields=" + r.rec.fieldCount());
    logger.debug("series=" + e.series.size() + " laps=" + e.laps.size() + " fitLaps=" + r.rec.laps + " cues=" + r.cues.size() + " phase=" + e.phase + " fs=" + sawFs);
    var st = r.coachState();
    var ok = r.rec.fieldCount() == 8 && e.series.size() == 2 && e.phase == Phase.FREE && st.hasKey("np") && sawFs && phases.hasKey(Phase.ARMED) && phases.hasKey(Phase.AUTOPAUSED);
    // dotyk i przyciski nie wywracają aplikacji
    scr.page = 0; scr.draw(g);
    for (var h = 0; h < scr.hits.size(); h++) {
        var id = scr.hits[h][0];
        if (id.equals("lap")) { scr.tap(scr.hits[h][1] + 2, scr.hits[h][2] + 2); }
    }
    scr.turn(1); scr.turn(-1);
    scr.key(WatchUi.KEY_LAP);
    r.onPhoneCommand("eat"); r.onPhoneCommand("lap"); r.onPhoneSay("Test");
    r.finish(true);
    var sum = new SummaryScreen();
    sum.draw(g);
    var q = Application.Storage.getValue("upq");
    logger.debug("saved=" + r.saved + " state=" + r.state + " upq=" + (q == null ? "null" : q.size()) + " pending=" + r.up.pending());
    ok = ok && r.state == RideState.DONE && r.result != null && r.up.pending() == 1;
    var meta = Application.Storage.getValue("up_" + r.startEpoch.format("%d")) as Dictionary?;
    if (meta == null) { logger.debug("no upload meta"); ok = false; }
    else {
        var b = Application.Storage.getValue("up_" + r.startEpoch.format("%d") + "_s0");
        logger.debug("ns=" + meta["ns"] + " ng=" + meta["ng"] + " b64len=" + (b == null ? -1 : b.toString().length()) + " sumKeys=" + meta["sum"].size());
        ok = ok && meta["ns"] == 1 && b != null && b.toString().length() == 600;    // 560 s → 112 próbek × 4 B = 448 B → 600 znaków base64
    }
    sum.done();
    Smoke.cleanup();
    return ok;
}

(:test)
function testSmokeFreeRide(logger as Test.Logger) as Boolean {
    Smoke.cleanup();
    var r = getRide();
    var g = Smoke.dc();
    var scr = new RideScreen();
    Cfg.put("autoPause", true); Cfg.put("indoor", false); Cfg.put("autoLapMode", 3); Cfg.put("ftp", 300); Cfg.put("tones", false); Cfg.put("link", false); Cfg.load();
    r.plan = null;
    r.recordFit = false;      // nagrywanie FIT sprawdza test jazdy z planu (jedna sesja na przebieg symulatora)
    if (!r.startRide(true)) { logger.debug("startRide failed"); r.recordFit = true; return false; }
    var e = r.eng;
    for (var i = 0; i < 700; i++) {
        var p = 180;
        if (i >= 100 && i < 300) { p = 310; }          // wysiłek 200 s
        if (i >= 420 && i < 450) { p = 0; }            // postój
        var spd = p == 0 ? 0.0 : 8.5;
        r.simTick(p, 140, p == 0 ? 0 : 90, spd);
        if (i % 14 == 0) { Smoke.drawAll(scr, g); }
    }
    logger.debug("efforts=" + e.efforts.size() + " laps=" + r.lapNo + " fitLaps=" + r.rec.laps + " n=" + e.m.n + " np=" + e.m.np() + " dist=" + r.dist);
    r.recordFit = true;
    var ok = e.efforts.size() == 1 && r.lapNo == 3 && e.m.n == 700;
    r.lapButton();
    ok = ok && r.lapNo == 4;
    Cfg.put("autoLapMode", 2); Cfg.put("autoLapMin", 1); Cfg.load();
    for (var j = 0; j < 130; j++) { r.simTick(150, 130, 85, 7.0); }
    logger.debug("after time laps=" + r.lapNo);
    ok = ok && r.lapNo == 6;
    Smoke.drawAll(scr, g);
    r.finish(false);
    ok = ok && r.state == RideState.IDLE && r.up.pending() == 0;
    Smoke.cleanup();
    return ok;
}

(:test)
function testSyncAndEnzo(logger as Test.Logger) as Boolean {
    Smoke.cleanup();
    var r = getRide();
    Cfg.put("token", "t"); Cfg.put("tones", false); Cfg.put("link", false); Cfg.load();
    var today = r.todayIso();
    // odpowiedź /api/garmin/sync w formacie serwera (lib/garmin/sync.ts)
    r.onSync(200, {
        "ok" => true, "t" => 1763850000, "today" => today,
        "athlete" => { "name" => "Adrian", "ftp" => 305, "hrmax" => 189, "kg" => 67 },
        "workouts" => [
            { "id" => "plan-" + today, "date" => today, "name" => "Threshold 2x20 min", "type" => "THR", "dur" => 5400, "tss" => 95, "ftp" => 305,
              "steps" => [["Rozgrzewka", 0, 900, 155, 200, 0, 0, 0, 0, 142], ["Interwał 1", 1, 1200, 291, 309, 0, 0, 0, 0, 0],
                  ["Przerwa", 2, 300, 120, 185, 0, 0, 0, 0, 132], ["Interwał 2", 1, 1200, 291, 309, 0, 0, 0, 0, 0], ["Schłodzenie", 4, 600, 135, 170, 0, 0, 0, 0, 136]] },
            { "id" => "plan-jutro", "date" => "2099-01-01", "name" => "Endurance", "type" => "Z2", "dur" => 3600, "tss" => 50, "ftp" => 305,
              "steps" => [["Jazda", 3, 3600, 170, 230, 0, 0, 2, 129, 149]] }
        ],
        "brief" => { "readiness" => 72, "state" => "Dobra gotowość", "yTss" => 60, "hrA" => 71.5, "hrB" => 0.31 }
    });
    var ok = Cfg.ftp == 305 && Cfg.hrmax == 189 && Cfg.weightKg == 67 && Cfg.athlete.equals("Adrian");
    ok = ok && r.plan != null && r.plan.steps.size() == 5 && r.plan.totalSec() == 4200 && r.plan.readiness != null && r.workoutList().size() == 2;
    logger.debug("ftp=" + Cfg.ftp + " plan=" + (r.plan == null ? "null" : r.plan.name) + " list=" + r.workoutList().size());
    // wybór innego treningu z listy i powrót do dzisiejszego po kolejnej synchronizacji
    Cfg.save("pick", "plan-jutro");
    r.loadPlan();
    ok = ok && r.plan != null && r.plan.name.equals("Endurance") && r.plan.steps[0].start == 2 && r.plan.steps[0].hrHi == 149;
    // błąd serwera nie kasuje planu
    r.onSync(500, null);
    ok = ok && r.plan != null;
    // Enzo: odpowiedź + polecenie
    r.recordFit = false;
    Application.Storage.deleteValue("pick");
    r.loadPlan();
    if (!r.startRide(false)) { r.recordFit = true; return false; }
    r.recordFit = true;
    for (var i = 0; i < 30; i++) { r.simTick(180, 120, 85, 8.0); }
    r.onEnzo(200, { "say" => "Trzymasz 180 W, spokojnie. Forza!", "action" => "next" });
    logger.debug("enzo=" + r.enzoText + " step=" + r.eng.stepIdx + " cues=" + r.cues.size());
    ok = ok && r.enzoText != null && r.eng.stepIdx == 1 && !r.enzoBusy;
    r.onEnzo(502, null);
    ok = ok && r.banner != null;
    r.finish(false);
    r.reset();
    Smoke.cleanup();
    return ok;
}

(:test)
function testStores(logger as Test.Logger) as Boolean {
    var hst = new Hist();
    for (var i = 0; i < 4000; i++) { hst.push(i % 500, 100 + (i % 50), i % 3 == 0 ? null : 90); }
    var ok = hst.p(3999) == 3999 % 500 && hst.p(100) == 0 && hst.valid(3999 - 3699) && !hst.valid(3999 - 3700) && hst.cad(3999) == -1 && hst.hr(3998) == 148;
    var bs = new BlockStore(4, 2248);
    for (var k = 0; k < 600; k++) { bs.add([k & 0xFF, (k >> 8) & 0xFF, 120, 90]b); }
    logger.debug("blocks=" + bs.blockCount() + " b0=" + bs.block(0).size() + " b1=" + bs.block(1).size() + " b64=" + Util.b64(bs.block(0)).length());
    ok = ok && bs.blockCount() == 2 && bs.block(0).size() == 2248 && bs.block(1).size() == 152 && Util.b64(bs.block(0)).length() == 3000;
    ok = ok && Util.durationPl(150).equals("2 minuty 30 sekund") && Util.clock(3725).equals("1:02:05") && Util.r5(12.4) == 10
        && Util.render("a {x} b {y}", { "x" => 5, "y" => "z" }).equals("a 5 b z") && Util.round(-2.5) == -3;
    return ok;
}

//! Most do telefonu (tryb lustra): start jazdy niesie cały plan, próbka live ma 17 pól, „sync” w trakcie jazdy
//! odsyła start z sync=1, pauza przechodzi do wektora live.
(:test)
function testPhoneMirrorProtocol(logger as Test.Logger) as Boolean {
    Smoke.cleanup();
    var r = getRide();
    Cfg.put("autoPause", false); Cfg.put("indoor", true); Cfg.put("tones", false); Cfg.put("link", false); Cfg.put("ftp", 300); Cfg.load();
    var w = new Workout();
    w.ftp = 300; w.name = "Test 2x1";
    w.add("Rozgrzewka", StepType.WARMUP, 60, 150, 200);
    w.add("Interwał 1", StepType.INTERVAL, 60, 280, 300);
    w.add("Przerwa", StepType.RECOVERY, 60, 100, 160);
    r.plan = w;
    r.recordFit = false;
    if (!r.startRide(false)) { r.recordFit = true; return false; }
    r.recordFit = true;
    for (var i = 0; i < 20; i++) { r.simTick(180, 120, 88, 9.0); }
    var sm = r.startMsg(true);
    var st = sm.get("st") as Array;
    var ok = "start".equals(sm.get("s")) && st.size() == 3 && (st[1] as Array)[0] == StepType.INTERVAL && (st[1] as Array)[3] == 300
        && sm.get("sync") == 1 && sm.get("el") == 20 && sm.get("k") == r.startEpoch && "Test 2x1".equals(sm.get("w"));
    var v = r.liveVec(0);
    logger.debug("live=" + v.toString() + " el=" + sm.get("el"));
    ok = ok && v.size() == 17 && v[0] == 19 && v[1] == 180 && v[11] == 180 && v[10] == 0 && v[16] >= 19 && v[16] <= 20;
    r.pause();
    ok = ok && r.startMsg(false).get("p") == 1 && r.liveVec(1)[10] == 1;
    r.resume();
    // polecenia z telefonu: „następny krok” i „sync” nie wywracają jazdy (most wyłączony – bez wysyłki w symulatorze)
    r.onPhoneCommand("next");
    r.onPhoneCommand("sync");
    r.onPhoneCommand("state");
    ok = ok && r.eng.stepIdx == 1 && r.active();
    r.finish(false);
    Smoke.cleanup();
    return ok;
}

//! Zmiany planu w trakcie jazdy (głos / menu „Zmień plan”): dłuższy krok, cele +5%, jeszcze jeden interwał,
//! paliwo; do tego pamięć urządzenia przy treningu z trasą (zapas na nowe strony).
(:test)
function testPlanEditsAndFuel(logger as Test.Logger) as Boolean {
    Smoke.cleanup();
    var r = getRide();
    Cfg.put("autoPause", false); Cfg.put("indoor", true); Cfg.put("tones", false); Cfg.put("link", false); Cfg.put("ftp", 300); Cfg.load();
    var w = new Workout();
    w.ftp = 300; w.name = "Edycja";
    w.add("Rozgrzewka", StepType.WARMUP, 120, 150, 200);
    w.add("Interwał 1", StepType.INTERVAL, 120, 280, 300);
    w.add("Przerwa", StepType.RECOVERY, 60, 100, 160);
    w.add("Schłodzenie", StepType.COOLDOWN, 120, 120, 160);
    r.plan = w;
    r.recordFit = false;
    if (!r.startRide(false)) { r.recordFit = true; return false; }
    r.recordFit = true;
    var e = r.eng;
    for (var i = 0; i < 30; i++) { r.simTick(180, 120, 88, 9.0); }
    var rem0 = e.stepRemaining();
    r.planEdit("extend:60");
    var ok = e.stepRemaining() == rem0 + 60 && e.wk.steps[0].dur == 180;
    r.planEdit("extend:-600");                       // nie da się skrócić poniżej przejechanego czasu
    ok = ok && e.stepRemaining() >= 4 && e.stepRemaining() <= 6;
    r.planEdit("bias:+5");
    ok = ok && e.bias == 5 && e.wk.steps[1].lo == 294 && e.wk.steps[1].hi == 315 && e.wk.steps[2].hi == 160;
    r.planEdit("bias:+5");
    ok = ok && e.bias == 10 && e.wk.steps[1].hi == 330;
    r.planEdit("bias:0");
    ok = ok && e.bias == 0 && e.wk.steps[1].hi == 300;
    r.planEdit("repeat");                             // w rozgrzewce: [interwał, przerwa] zaraz po niej
    logger.debug("kroki=" + e.wk.steps.size() + " interwały=" + e.intervalCount + " nazwa=" + e.wk.steps[1].name);
    ok = ok && e.wk.steps.size() == 6 && e.intervalCount == 2 && e.wk.steps[1].type == StepType.INTERVAL && e.wk.steps[2].type == StepType.RECOVERY;
    ok = ok && e.wk.steps[1].name.equals("Dodatkowy interwał") && e.intervalNo(3) == 2;
    // paliwo: dwa żele, picie; spalanie rośnie z mocą
    r.fuel(25); r.fuel(25); r.fuel(0);
    for (var j = 0; j < 60; j++) { r.simTick(300, 150, 90, 9.0); }
    logger.debug("cho spalone=" + r.choBurn + " zjedzone=" + r.choEat + " picie=" + r.drinks + " ślad=" + r.pTrace.size());
    ok = ok && r.choEat == 50 && r.drinks == 1 && r.choBurn > 3.0 && r.choBurn < 25.0 && r.pTrace.size() == 9;
    var st = r.coachState();
    ok = ok && st.get("carbsEatenG") == 50;
    // menu ENZO wysyła te same komendy co głos: baton, picie, ekran
    Menus.enzo();
    r.onPhoneCommand("eat:40"); r.onPhoneCommand("drink"); r.onPhoneCommand("page:paliwo");
    ok = ok && r.choEat == 90 && r.drinks == 2 && r.uiPage == Pg.FUEL;
    // „prowadź do kawiarni”, a kawiarnia jest na trasie: serwer odpowiada keep – trasa zostaje, jest tylko komunikat
    var crs = r.course;
    r.onReroute(200, { "keep" => true, "say" => "Schronisko – na trasie za 1.2 kilometra." });
    ok = ok && r.course == crs && r.banner != null && (r.banner as String).find("Schronisko") != null;
    // odmowa serwera: komunikat błędu, trasa bez zmian
    r.onReroute(404, { "message" => "W pobliżu nic takiego nie znalazłem." });
    ok = ok && r.course == crs && r.banner != null && (r.banner as String).find("nic takiego") != null;
    var stats = System.getSystemStats();
    logger.debug("pamięć: użyta " + stats.usedMemory + " z " + stats.totalMemory + " B, wolne " + stats.freeMemory + " B");
    r.finish(false);
    Smoke.cleanup();
    return ok;
}
