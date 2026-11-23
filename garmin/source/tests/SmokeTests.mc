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
        for (var p = 0; p < 5; p++) {
            scr.page = p;
            scr.draw(g);
        }
    }

    function cleanup() as Void {
        Application.Storage.clearValues();
        Cfg.load();
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
    Cfg.put("autoPause", false); Cfg.put("indoor", true); Cfg.put("tones", false); Cfg.load();
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
        if (i % 7 == 0 || r.banner != null) { Smoke.drawAll(scr, g); }
        if (i == 140) { Menus.ride(scr); }
        if (i == 200) { r.showEnzo("Bravissimo! Trzymasz 302 waty, dokładnie w celu. Jeszcze dwie minuty, forca!"); Smoke.drawAll(scr, g); r.dismissEnzo(); }
        if (i == 300) { r.pause(); Smoke.drawAll(scr, g); scr.tap(100, 300); r.resume(); }
    }
    logger.debug("series=" + e.series.size() + " laps=" + e.laps.size() + " fitLaps=" + r.rec.laps + " cues=" + r.cues.size() + " phase=" + e.phase + " fs=" + sawFs);
    var st = r.coachState();
    var ok = e.series.size() == 2 && e.phase == Phase.FREE && st.hasKey("np") && sawFs && phases.hasKey(Phase.ARMED) && phases.hasKey(Phase.AUTOPAUSED);
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
    Cfg.put("autoPause", true); Cfg.put("indoor", false); Cfg.put("autoLapMode", 3); Cfg.put("ftp", 300); Cfg.put("tones", false); Cfg.load();
    r.plan = null;
    if (!r.startRide(true)) { logger.debug("startRide failed"); return false; }
    var e = r.eng;
    for (var i = 0; i < 700; i++) {
        var p = 180;
        if (i >= 100 && i < 300) { p = 310; }          // wysiłek 200 s
        if (i >= 420 && i < 450) { p = 0; }            // postój
        var spd = p == 0 ? 0.0 : 8.5;
        r.simTick(p, 140, p == 0 ? 0 : 90, spd);
        if (i % 9 == 0) { Smoke.drawAll(scr, g); }
    }
    logger.debug("efforts=" + e.efforts.size() + " laps=" + r.lapNo + " fitLaps=" + r.rec.laps + " n=" + e.m.n + " np=" + e.m.np() + " dist=" + r.dist);
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
