import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Test;
import Toybox.WatchUi;

// Testy nawigacji po trasie w symulatorze. Trasa testowa (tests/NavData.mc) jest generowana tym samym kodem,
// który obsługuje prawdziwe pliki GPX w aplikacji i na serwerze (garmin/ci/parity/gen-course.ts).

(:test)
class NavLog {
    var keys;
    var vars;

    function initialize() {
        keys = [];
        vars = [];
    }

    function onNav(key, v) as Void {
        keys.add(key);
        vars.add(v);
    }

    function count(key as String) as Number {
        var n = 0;
        for (var i = 0; i < keys.size(); i++) { if (keys[i].equals(key)) { n++; } }
        return n;
    }

    //! Indeks pierwszego zdarzenia o kluczu (i opcjonalnie wartości zmiennej) albo -1.
    function find(key as String, name, value) as Number {
        for (var i = 0; i < keys.size(); i++) {
            if (!keys[i].equals(key)) { continue; }
            if (name == null || vars[i].get(name).toString().equals(value.toString())) { return i; }
        }
        return -1;
    }

    function dump() as String {
        var s = "";
        for (var i = 0; i < keys.size(); i++) {
            s = s + keys[i];
            if (keys[i].equals("navTurn")) { s = s + "(" + vars[i].get("m") + " " + vars[i].get("dir") + ")"; }
            if (keys[i].equals("navLeft")) { s = s + "(" + vars[i].get("km") + ")"; }
            s = s + " ";
        }
        return s;
    }
}

(:test)
function testCourseDecode(logger as Test.Logger) as Boolean {
    Smoke.cleanup();
    NavData.install();
    var c = Course.load();
    if (c == null) { logger.debug("Course.load() = null"); return false; }
    logger.debug("n=" + c.n + " total=" + c.total + " cum=" + c.cum[c.n - 1] + " first=" + c.lat(0) + "," + c.lon(0)
        + " last=" + c.lat(c.n - 1) + "," + c.lon(c.n - 1) + " ele=" + c.eleMin + ".." + c.eleMax + " cues=" + c.cues.size() + " climbs=" + c.climbs.size());
    var ok = c.n == NavData.N && c.total == NavData.TOTAL && c.cues.size() == NavData.CUES && c.climbs.size() == NavData.CLIMBS;
    ok = ok && c.lat(0) == NavData.FIRST[0] && c.lon(0) == NavData.FIRST[1];
    ok = ok && c.lat(c.n - 1) == NavData.LAST[0] && c.lon(c.n - 1) == NavData.LAST[1] && c.cum[c.n - 1] == NavData.LAST[2];
    // profil: płasko 600 m, szczyt ok. 720 m w 2700 m trasy, potem lekko w dół
    var e0 = c.eleAt(100);
    var eTop = c.eleAt(2700);
    var eMid = c.eleAt(1950);
    logger.debug("ele 100m=" + e0 + " 1950m=" + eMid + " 2700m=" + eTop);
    ok = ok && c.hasEle && Util.abs(e0 - 600) <= 2 && Util.abs(eTop - 720) <= 3 && Util.abs(eMid - 660) <= 6;
    ok = ok && c.segAt(0) == 0 && c.segAt(c.total + 500) == c.n - 2 && c.cum[c.segAt(1500)] <= 1500 && c.cum[c.segAt(1500) + 1] > 1500;
    // niepełne pobranie = brak trasy
    Application.Storage.deleteValue("crs_ok");
    ok = ok && Course.load() == null;
    Smoke.cleanup();
    return ok;
}

(:test)
function testNavDrive(logger as Test.Logger) as Boolean {
    Smoke.cleanup();
    NavData.install();
    var c = Course.load();
    var nav = new Nav(c);
    var log = new NavLog();
    nav.owner = log;
    var d = NavData.drive();
    var n = d.size() / 2;
    var worst = 0.0;
    var mono = true;
    var prev = -1.0;
    var topAt = -1;
    for (var i = 0; i < n; i++) {
        nav.update(d[2 * i] / 1000000.0d, d[2 * i + 1] / 1000000.0d, 36.0, i);
        var err = Util.abs(nav.progress - i * 10.0);
        if (err > worst) { worst = err; }
        if (nav.progress < prev - 0.5) { mono = false; }
        prev = nav.progress;
        if (topAt < 0 && log.count("navTop") > 0) { topAt = i * 10; }
    }
    logger.debug(log.dump());
    logger.debug("progress=" + nav.progress + " worst=" + worst + " mono=" + mono + " left=" + nav.left() + " topAt=" + topAt);
    var ok = nav.acquired && !nav.offRoute && mono && worst < 15 && nav.left() <= 15;
    // kolejność: start → podjazd za kilometr → zapowiedź skrętu w prawo → „teraz” → start podjazdu → skręt w lewo → szczyt → meta
    var iStart = log.find("navStart", null, null);
    var iClimb = log.find("navClimb", null, null);
    var iPre = log.find("navTurn", "m", 500);
    var iNow = log.find("navTurn", "m", 0);
    var iUp = log.find("navClimbStart", null, null);
    var iTop = log.find("navTop", null, null);
    var iDone = log.find("navDone", null, null);
    ok = ok && iStart == 0 && iClimb > iStart && iPre > iClimb && iNow > iPre && iUp > iPre && iTop > iUp && iDone > iTop;
    ok = ok && log.count("navTurn") == 4 && log.count("navOff") == 0 && log.count("navClimb") == 1 && log.count("navDone") == 1;
    if (iPre >= 0) { ok = ok && log.vars[iPre].get("dir").equals("right") && log.vars[iPre].get("dirTxt").equals("w prawo"); }
    if (iUp >= 0) {
        var cv = log.vars[iUp];
        logger.debug("climb vars: " + cv);
        ok = ok && cv.get("low") == 280 && cv.get("high") == 300 && cv.get("tier").equals("atak") && cv.get("grade") == 7;
    }
    ok = ok && log.find("navLeft", "km", 2) > 0 && log.find("navLeft", "km", 1) > 0;
    ok = ok && topAt >= 2730 && topAt <= 2760;
    // „Przed tobą”: woda i schronisko zapowiedziane raz (≤ 2 km przed), nawierzchnia z trasy planera
    ok = ok && log.count("navPoi") == 3 && log.find("navPoi", "name", "Schronisko") > 0 && log.find("navPoi", "kind", "Woda") >= 0;
    ok = ok && nav.course.surfAt(100) == 0 && nav.course.surfAt(2000) == 1 && nav.course.surfAt(3000) == 2 && nav.course.prof.equals("gravel");
    // stan dla trenera (te same pola co w telefonie)
    var st = nav.state();
    ok = ok && st.get("left") <= 15 && st.get("acquired") == true && st.get("name").equals("Pętla testowa");
    Smoke.cleanup();
    return ok;
}

(:test)
function testNavDetour(logger as Test.Logger) as Boolean {
    Smoke.cleanup();
    NavData.install();
    var c = Course.load();
    var nav = new Nav(c);
    var log = new NavLog();
    nav.owner = log;
    var d = NavData.detour();
    var n = d.size() / 2;
    var offAt = -1;
    var backAt = -1;
    var maxOff = 0.0;
    var frozen = true;
    var progAtOff = 0.0;
    for (var i = 0; i < n; i++) {
        nav.update(d[2 * i] / 1000000.0d, d[2 * i + 1] / 1000000.0d, 36.0, i);
        if (offAt < 0 && nav.offRoute) { offAt = i; progAtOff = nav.progress; }
        if (offAt >= 0 && backAt < 0 && !nav.offRoute) { backAt = i; }
        if (nav.offRoute) {
            if (nav.offDist > maxOff) { maxOff = nav.offDist; }
            if (nav.offDist > 50 && Util.abs(nav.progress - progAtOff) > 1) { frozen = false; }    // poza trasą postęp stoi
        }
    }
    logger.debug(log.dump());
    logger.debug("offAt=" + offAt + " backAt=" + backAt + " maxOff=" + maxOff + " frozen=" + frozen + " progress=" + nav.progress);
    // odjazd zaczyna się w 400 m trasy, 50 m od śladu jest po ok. 2 s, komunikat po 8 s poza trasą
    var ok = offAt >= 48 && offAt <= 56 && backAt >= 66 && backAt <= 72 && maxOff > 140 && maxOff < 160 && frozen;
    ok = ok && log.count("navOff") == 1 && log.count("navBack") == 1 && log.find("navBack", null, null) > log.find("navOff", null, null);
    ok = ok && Util.abs(nav.progress - (n - 1) * 10) < 15;
    // wyłączona nawigacja nic nie liczy
    nav.setEnabled(false);
    var before = log.keys.size();
    nav.update(50.0d, 15.0d, 20.0, 999);
    ok = ok && log.keys.size() == before && !nav.offRoute;
    Smoke.cleanup();
    return ok;
}

(:test)
function testNavRide(logger as Test.Logger) as Boolean {
    Smoke.cleanup();
    NavData.install();
    var r = getRide();
    var g = Smoke.dc();
    var scr = new RideScreen();
    var home = new HomeScreen();
    Cfg.put("autoPause", false); Cfg.put("indoor", false); Cfg.put("autoLapMode", 0); Cfg.put("ftp", 300); Cfg.put("tones", false); Cfg.put("link", false); Cfg.load();
    r.course = Course.load();
    r.plan = null;
    home.draw(g);                       // linia „Trasa: …” na ekranie startowym
    r.recordFit = false;
    if (!r.startRide(true)) { logger.debug("startRide failed"); r.recordFit = true; return false; }
    var ok = r.nav != null && scr.indexOf(Pg.NAV) == scr.pageCount() - 1 && scr.indexOf(Pg.CLIMB) >= 0;
    logger.debug("strony=" + scr.pages().toString());
    var d = NavData.drive();
    var n = d.size() / 2;
    var sawClimb = false;
    var climbLeft = 0;
    for (var i = 0; i < n; i++) {
        r.simPos(d[2 * i], d[2 * i + 1]);
        r.simTick(i >= 106 && i < 273 ? 292 : 190, 150, 88, 10.0);
        var cn = r.climbNow();
        if (cn != null && !sawClimb) { sawClimb = true; climbLeft = cn[2]; ok = ok && cn[0] == 280 && cn[1] == 300 && cn[3] == 1 && cn[4] == 1 && cn[5] == 2; }
        if (i % 12 == 0) {
            scr.zoom = (i / 12) % 5;
            for (var p = 0; p < scr.pageCount(); p++) { scr.page = p; scr.draw(g); }
        }
    }
    logger.debug("progress=" + r.nav.progress + " sawClimb=" + sawClimb + " climbLeft=" + climbLeft + " cues=" + r.cues.size() + " banner=" + r.banner);
    ok = ok && sawClimb && climbLeft > 1600 && climbLeft <= 1670 && r.nav.left() <= 15 && r.climbNow() == null;
    var st = r.coachState();
    ok = ok && st.get("route") != null && st.get("route").get("total") == NavData.TOTAL;
    // pola danych nawigacji
    logger.debug("pola: " + Fields.value(34, r) + " | " + Fields.value(35, r) + " | " + Fields.value(36, r) + " | " + Fields.value(37, r));
    ok = ok && Fields.value(34, r).equals("0.0") && Fields.value(35, r).equals("--");
    logger.debug("ok przed wyłączeniem=" + ok);
    // wyłączenie w trakcie jazdy
    r.setNav(false);
    scr.page = scr.indexOf(Pg.NAV); scr.draw(g);
    logger.debug("po wyłączeniu: strony=" + scr.pages().toString() + " climbNow=" + r.climbNow() + " route=" + r.coachState().get("route"));
    ok = ok && scr.indexOf(Pg.NAV) == scr.pageCount() - 1 && scr.indexOf(Pg.CLIMB) == -1;   // TRASA zostaje (włączenie z menu), PODJAZD znika
    ok = ok && r.climbNow() == null && r.coachState().get("route") == null;
    r.finish(false);
    r.reset();
    r.recordFit = true;
    r.course = null;
    Smoke.cleanup();
    return ok;
}
