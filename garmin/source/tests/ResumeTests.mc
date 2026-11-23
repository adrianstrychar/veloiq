import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Test;
import Toybox.WatchUi;

// Przerwana jazda (wyłączenie licznika, awaria): punkt kontrolny w pamięci licznika, wznowienie przez
// odtworzenie zapisanych próbek w silniku, domknięcie bez dalszej jazdy. Oraz auto-lap na podjeździe.

(:test)
function testResumeInterrupted(logger as Test.Logger) as Boolean {
    Smoke.cleanup();
    var r = getRide();
    var g = Smoke.dc();
    var home = new HomeScreen();
    Cfg.put("autoPause", false); Cfg.put("indoor", true); Cfg.put("ftp", 300); Cfg.put("tones", false); Cfg.put("phoneLink", false); Cfg.load();
    r.plan = Smoke.plan();
    r.recordFit = false;
    r.replayAuto = false;
    if (!r.startRide(false)) { logger.debug("startRide failed"); r.recordFit = true; r.replayAuto = true; return false; }
    // rozgrzewka 120 s, interwał 1 (120 s), 90 s przerwy = 330 s; przerwa trwa, gdy „pada zasilanie”
    for (var i = 0; i < 330; i++) {
        var p = i < 120 ? 175 : (i < 240 ? 300 : 150);
        r.simTick(p, 140, 90, 8.0);
    }
    r.checkpoint();
    var e = r.eng;
    var s0 = e.s; var step0 = e.stepIdx; var np0 = e.m.np(); var ser0 = e.series.size(); var lap0 = r.lapNo; var kj0 = e.m.kJ(); var d0 = r.dist;
    var ck = Application.Storage.getValue("ck") as Dictionary?;
    logger.debug("przed: s=" + s0 + " step=" + step0 + " np=" + np0 + " serie=" + ser0 + " lap=" + lap0 + " kJ=" + kj0 + " ck=" + ck);
    var ok = ck != null && ck["ns"] == 66 && Application.Storage.getValue("ck_s0") != null && Application.Storage.getValue("ck_wk") != null;

    // awaria: stan z pamięci RAM znika, punkt kontrolny zostaje
    r.dropForTest();
    r.detectInterrupted();
    ok = ok && r.interrupted != null && !r.startRide(true);          // nowej jazdy nie da się zacząć przed decyzją
    home.draw(g);                                                    // karta „PRZERWANA JAZDA”
    ok = ok && r.resumeInterrupted(false) && r.resumePct == 0;
    home.draw(g);                                                    // „ODTWARZAM…”
    var guard = 0;
    while (r.resumePct >= 0 && guard < 200) { r.onReplay(); guard++; }
    e = r.eng;
    if (e == null) { logger.debug("brak silnika po odtworzeniu"); r.recordFit = true; r.replayAuto = true; return false; }
    logger.debug("po:    s=" + e.s + " step=" + e.stepIdx + " np=" + e.m.np() + " serie=" + e.series.size() + " lap=" + r.lapNo + " kJ=" + e.m.kJ()
        + " state=" + r.state + " partie=" + guard + " dist=" + r.dist);
    ok = ok && r.state == RideState.PAUSED && r.interrupted == null && e.s == s0 && e.stepIdx == step0 && e.series.size() == ser0
        && r.lapNo == lap0 && Util.abs(e.m.np() - np0) <= 2 && Util.abs(e.m.kJ() - kj0) <= 1 && Util.abs(r.dist - d0) < 1;
    // jazda toczy się dalej w tej samej aktywności
    var scr = new RideScreen();
    scr.draw(g);
    r.resume();
    for (var j = 0; j < 60; j++) { r.simTick(150, 132, 85, 7.5); }
    ok = ok && r.state == RideState.RECORDING && r.eng.s == s0 + 60;
    r.finish(true);
    var meta = Application.Storage.getValue("up_" + r.startEpoch.format("%d")) as Dictionary?;
    var b = Application.Storage.getValue("up_" + r.startEpoch.format("%d") + "_s0");
    logger.debug("wysyłka: pending=" + r.up.pending() + " b64=" + (b == null ? -1 : b.toString().length()) + " ck=" + Application.Storage.getValue("ck"));
    // 390 s → 78 próbek × 4 B = 312 B → 416 znaków base64; punkt kontrolny skasowany
    ok = ok && r.state == RideState.DONE && r.up.pending() == 1 && meta != null && b != null && b.toString().length() == 416
        && Application.Storage.getValue("ck") == null && Application.Storage.getValue("ck_s0") == null;
    r.reset();
    r.recordFit = true;
    r.replayAuto = true;
    Smoke.cleanup();
    return ok;
}

(:test)
function testFinalizeInterrupted(logger as Test.Logger) as Boolean {
    Smoke.cleanup();
    var r = getRide();
    var g = Smoke.dc();
    Cfg.put("autoPause", false); Cfg.put("indoor", true); Cfg.put("autoLapMode", 0); Cfg.put("ftp", 300); Cfg.put("tones", false); Cfg.put("phoneLink", false); Cfg.load();
    r.plan = null;
    r.recordFit = false;
    r.replayAuto = false;
    if (!r.startRide(true)) { logger.debug("startRide failed"); r.recordFit = true; r.replayAuto = true; return false; }
    for (var i = 0; i < 185; i++) { r.simTick(210, 138, 88, 8.0); }      // punkt kontrolny sam z siebie w 60., 120. i 180. sekundzie
    var np0 = r.eng.m.np();
    r.dropForTest();
    r.detectInterrupted();
    var ok = r.interrupted != null && r.interrupted["ns"] == 36 && r.interrupted["free"] == 1;
    ok = ok && r.resumeInterrupted(true);
    var guard = 0;
    while (r.resumePct >= 0 && guard < 200) { r.onReplay(); guard++; }
    logger.debug("state=" + r.state + " pending=" + r.up.pending() + " n=" + (r.eng == null ? -1 : r.eng.m.n) + " np=" + (r.eng == null ? -1 : r.eng.m.np()) + " np0=" + np0);
    ok = ok && r.state == RideState.DONE && r.up.pending() == 1 && r.result != null && r.eng.m.n == 180 && Util.abs(r.eng.m.np() - np0) <= 2
        && Application.Storage.getValue("ck") == null;
    var sum = new SummaryScreen();
    sum.draw(g);
    // odrzucenie przerwanej jazdy z menu
    r.reset();
    r.startRide(true);
    for (var k = 0; k < 125; k++) { r.simTick(180, 130, 85, 7.0); }
    r.dropForTest();
    r.detectInterrupted();
    ok = ok && r.interrupted != null;
    r.clearCheckpoint();
    ok = ok && r.interrupted == null && Application.Storage.getValue("ck") == null && r.startRide(true);
    r.finish(false);
    r.reset();
    r.recordFit = true;
    r.replayAuto = true;
    Smoke.cleanup();
    return ok;
}

(:test)
function testClimbAutoLap(logger as Test.Logger) as Boolean {
    Smoke.cleanup();
    var r = getRide();
    var g = Smoke.dc();
    var scr = new RideScreen();
    Cfg.put("autoPause", false); Cfg.put("indoor", false); Cfg.put("autoLapMode", 3); Cfg.put("ftp", 300); Cfg.put("tones", false); Cfg.put("phoneLink", false); Cfg.load();
    r.plan = null;
    r.course = null;
    r.recordFit = false;
    if (!r.startRide(true)) { logger.debug("startRide failed"); r.recordFit = true; return false; }
    // spokojna moc (bez „wysiłku”): 200 s płasko, 300 s pod górę 6% przy 5 m/s (+90 m), 200 s płasko
    var startAt = -1;
    var topAt = -1;
    var texts = "";
    for (var i = 0; i < 700; i++) {
        var alt = 400.0;
        if (i >= 200 && i < 500) { alt = 400.0 + (i - 200) * 0.3; }
        else if (i >= 500) { alt = 490.0; }
        r.hub.alt = alt;
        var before = r.lapNo;
        r.simTick(200, 140, 85, 5.0);
        if (r.lapNo != before) {
            texts = texts + "[" + i + ": " + r.banner + "] ";
            if (startAt < 0) { startAt = i; } else if (topAt < 0) { topAt = i; }
        }
        if (i % 50 == 0) { Smoke.drawAll(scr, g); }
    }
    logger.debug("laps=" + r.lapNo + " start=" + startAt + " top=" + topAt + " " + texts);
    // start wykryty po kilkunastu metrach w pionie, szczyt – gdy droga się wypłaszcza
    var ok = r.lapNo == 3 && startAt >= 235 && startAt <= 290 && topAt >= 500 && topAt <= 590 && !r.climbing;
    ok = ok && r.prevLap != null && r.prevLap["sec"] > 200;
    r.finish(false);
    r.reset();
    r.recordFit = true;
    r.hub.alt = null;
    Smoke.cleanup();
    return ok;
}
