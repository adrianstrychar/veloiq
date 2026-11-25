import Toybox.Application;
import Toybox.Lang;
import Toybox.Math;
import Toybox.StringUtil;
import Toybox.System;

//! Kierunki skrętów – kody jak w lib/garmin/course.ts (DIR_CODES).
module Dir {
    const LEFT = 0;
    const RIGHT = 1;
    const SLIGHT_LEFT = 2;
    const SLIGHT_RIGHT = 3;
    const SHARP_LEFT = 4;
    const SHARP_RIGHT = 5;
    const UTURN = 6;

    //! Klucz jak w telefonie (klipy głosu Enzo: dir.left, dir.sharpRight…).
    function key(c as Number) as String {
        var t = ["left", "right", "slightLeft", "slightRight", "sharpLeft", "sharpRight", "uturn"];
        return (c >= 0 && c < t.size()) ? t[c] : "left";
    }

    function label(c as Number) as String {
        var t = ["w lewo", "w prawo", "lekko w lewo", "lekko w prawo", "ostro w lewo", "ostro w prawo", "zawróć"];
        return (c >= 0 && c < t.size()) ? t[c] : "";
    }

    //! Kąt strzałki na ekranie (stopnie, 0 = prosto, dodatnie w prawo).
    function angle(c as Number) as Number {
        var t = [-90, 90, -40, 40, -135, 135, 180];
        return (c >= 0 && c < t.size()) ? t[c] : 0;
    }
}

//! Rodzaje punktów „Przed tobą” – kody jak POI_CODES w lib/garmin/course.ts.
module Poi {
    function label(k as Number) as String {
        var t = ["Kawiarnia", "Woda", "Toaleta", "Serwis", "Sklep", "Stacja", "Jedzenie"];
        return (k >= 0 && k < t.size()) ? t[k] : "Punkt";
    }
    //! Krótki znak na mapę i listę (czcionki licznika nie mają emoji).
    function sign(k as Number) as String {
        var t = ["K", "W", "WC", "S", "Sk", "P", "J"];
        return (k >= 0 && k < t.size()) ? t[k] : "?";
    }
}

//! Trasa GPX pobrana z VeloIQ (lib/garmin/course.ts): uproszczony ślad w pamięci jako bajty
//! (12 B na punkt: szer. i dług. w mikrostopniach, wysokość + 500 m, odległość od poprzedniego punktu),
//! skręty [dystans, kierunek] i podjazdy [start, koniec, przewyższenie, nachylenie×10, cel↓, cel↑, taktyka].
//! Trasa z planera ma też nawierzchnię [od m, kod 0 asfalt / 1 szuter / 2 teren / 3 ?] i punkty
//! „Przed tobą” [dystans, rodzaj, nazwa] oraz profil (road / gravel / mtb / calm) do powrotu na trasę.
class Course {
    const REC = 12;
    var id as String = "";
    var name as String = "";
    var total as Number = 0;       // m
    var gain as Number = 0;        // m
    var n as Number = 0;           // liczba punktów
    var cues;                      // [[d, dir], …]
    var climbs;                    // [[start, end, gain, grade10, low, high, tier], …]
    var surf;                      // [[od m, kod], …] – pusta tablica dla zwykłego pliku GPX
    var pois;                      // [[d, rodzaj, nazwa], …]
    var prof as String = "";
    var cum;                       // dystans narastająco dla każdego punktu (m)
    var minLat as Number = 0;
    var maxLat as Number = 0;
    var minLon as Number = 0;
    var maxLon as Number = 0;
    var eleMin as Number = 0;
    var eleMax as Number = 0;
    var hasEle as Boolean = false;
    hidden var _b as ByteArray;

    function initialize(meta as Dictionary, bytes as ByteArray, cueList, climbList, surfList, poiList) {
        id = Util.str(meta.get("id"), "");
        prof = Util.str(meta.get("prof"), "");
        surf = surfList instanceof Array ? surfList : [];
        pois = poiList instanceof Array ? poiList : [];
        name = Util.str(meta.get("name"), "Trasa");
        total = Util.int(meta.get("total"), 0);
        gain = Util.int(meta.get("gain"), 0);
        _b = bytes;
        n = bytes.size() / REC;
        cues = cueList instanceof Array ? cueList : [];
        climbs = climbList instanceof Array ? climbList : [];
        cum = new [n];
        var d = 0;
        var first = true;
        for (var i = 0; i < n; i++) {
            d += u16(i * REC + 10);
            cum[i] = d;
            var la = lat(i);
            var lo = lon(i);
            if (i == 0) { minLat = la; maxLat = la; minLon = lo; maxLon = lo; }
            if (la < minLat) { minLat = la; }
            if (la > maxLat) { maxLat = la; }
            if (lo < minLon) { minLon = lo; }
            if (lo > maxLon) { maxLon = lo; }
            var e = ele(i);
            if (e != null) {
                if (first) { eleMin = e; eleMax = e; first = false; hasEle = true; }
                if (e < eleMin) { eleMin = e; }
                if (e > eleMax) { eleMax = e; }
            }
        }
        if (n > 0 && total <= 0) { total = cum[n - 1]; }
    }

    hidden function u16(off as Number) as Number {
        return _b[off] | (_b[off + 1] << 8);
    }

    //! Szerokość / długość geograficzna punktu w mikrostopniach.
    function lat(i as Number) as Number {
        return _b.decodeNumber(Lang.NUMBER_FORMAT_SINT32, { :offset => i * REC, :endianness => Lang.ENDIAN_LITTLE }) as Number;
    }

    function lon(i as Number) as Number {
        return _b.decodeNumber(Lang.NUMBER_FORMAT_SINT32, { :offset => i * REC + 4, :endianness => Lang.ENDIAN_LITTLE }) as Number;
    }

    //! Wysokość punktu (m) albo null, gdy trasa nie ma wysokości.
    function ele(i as Number) {
        var v = u16(i * REC + 8);
        return v == 65535 ? null : v - 500;
    }

    //! Indeks odcinka, w którym leży dystans d (m) – wyszukiwanie binarne.
    function segAt(d) as Number {
        if (n < 2) { return 0; }
        var lo = 0;
        var hi = n - 2;
        while (lo < hi) {
            var mid = (lo + hi + 1) / 2;
            if (cum[mid] <= d) { lo = mid; } else { hi = mid - 1; }
        }
        return lo;
    }

    //! Kod nawierzchni w miejscu d (m po trasie) albo -1, gdy trasa jej nie ma.
    function surfAt(d) as Number {
        var sz = surf.size();
        if (sz == 0) { return -1; }
        var code = surf[0][1];
        for (var i = 1; i < sz; i++) {
            if (surf[i][0] > d) { break; }
            code = surf[i][1];
        }
        return code;
    }

    //! Wysokość w miejscu d (m po trasie), interpolowana; null bez danych.
    function eleAt(d) {
        if (!hasEle || n < 2) { return null; }
        var i = segAt(d);
        var a = ele(i);
        var b = ele(i + 1);
        if (a == null || b == null) { return a != null ? a : b; }
        var len = cum[i + 1] - cum[i];
        var t = len > 0 ? (d - cum[i]).toFloat() / len : 0.0;
        return a + (b - a) * Util.clamp(t, 0.0, 1.0);
    }

    // ------------------------------------------------------------------ pamięć licznika
    //! Trasa z ostatniej synchronizacji albo null (brak / niepełne pobranie).
    static function load() {
        var meta = Application.Storage.getValue("crs") as Dictionary?;
        var ok = Application.Storage.getValue("crs_ok");
        if (meta == null || !(meta instanceof Dictionary) || ok == null || !ok.toString().equals(Util.str(meta.get("id"), "?"))) { return null; }
        var parts = Util.int(meta.get("parts"), 0);
        var bytes = []b;
        for (var i = 0; i < parts; i++) {
            var s = Application.Storage.getValue("crs_p" + i);
            if (s == null || !(s instanceof String)) { return null; }
            var part = StringUtil.convertEncodedString(s, {
                :fromRepresentation => StringUtil.REPRESENTATION_STRING_BASE64,
                :toRepresentation => StringUtil.REPRESENTATION_BYTE_ARRAY
            });
            bytes.addAll(part as ByteArray);
        }
        if (bytes.size() < 2 * 12) { return null; }
        return new Course(meta, bytes, Application.Storage.getValue("crs_t"), Application.Storage.getValue("crs_c"),
            Application.Storage.getValue("crs_s"), Application.Storage.getValue("crs_q"));
    }

    static function clear() as Void {
        var meta = Application.Storage.getValue("crs") as Dictionary?;
        var parts = (meta != null && meta instanceof Dictionary) ? Util.int(meta.get("parts"), 0) : 0;
        for (var i = 0; i < parts; i++) { Application.Storage.deleteValue("crs_p" + i); }
        Application.Storage.deleteValue("crs");
        Application.Storage.deleteValue("crs_t");
        Application.Storage.deleteValue("crs_c");
        Application.Storage.deleteValue("crs_s");
        Application.Storage.deleteValue("crs_q");
        Application.Storage.deleteValue("crs_ok");
    }

    static function storedId() as String {
        var ok = Application.Storage.getValue("crs_ok");
        return ok == null ? "" : ok.toString();
    }
}

//! Nawigacja po trasie – ta sama logika co w telefonie (mobile/ios-src/RideEngine/RouteNavigator.swift):
//! dopasowanie pozycji do śladu, postęp, zapowiedzi skrętów (300/500 m i „teraz”), zjechanie z trasy i powrót,
//! podjazdy (1 km przed, start, szczyt), kilometry do mety i meta. Wywoływana raz na sekundę z pozycją GPS.
//! Zdarzenia: owner.onNav(klucz, zmienne) – klucze jak w telefonie (navTurn, navClimb, navOff…).
class Nav {
    var course as Course;
    var owner = null;
    var enabled as Boolean = true;
    var acquired as Boolean = false;
    var offRoute as Boolean = false;
    var muted as Boolean = false;        // długo poza trasą – cisza do powrotu
    var progress as Float = 0.0;         // m po trasie
    var offDist as Float = 0.0;          // m od śladu (ostatnie dopasowanie)
    var idx as Number = 0;               // odcinek, na którym jesteśmy
    var nearLat as Number = 0;           // najbliższy punkt śladu (mikrostopnie) – strzałka powrotu
    var nearLon as Number = 0;
    hidden var _offSince as Number = -1;
    hidden var _lastOffSay as Number = 0;
    hidden var _lastGlobal as Number = -100;
    hidden var _cueSaid as ByteArray;
    hidden var _climbSaid as ByteArray;
    hidden var _poiSaid as ByteArray;
    hidden var _lastKmLeft as Number = -1;
    hidden var _done as Boolean = false;
    hidden var _speed as Float = 0.0;    // km/h, wygładzona
    hidden var _toStartSaid as Boolean = false;
    hidden var _bi as Number = 0;        // wynik nearest(): odcinek, rzut, odległość
    hidden var _bt as Float = 0.0;
    hidden var _bd as Float = 0.0;

    function initialize(c as Course) {
        course = c;
        _cueSaid = new [c.cues.size()]b;
        _climbSaid = new [c.climbs.size()]b;
        _poiSaid = new [c.pois.size() + 1]b;
    }

    function setEnabled(on as Boolean) as Void {
        if (on == enabled) { return; }
        enabled = on;
        _offSince = -1; offRoute = false; muted = false; _lastGlobal = -100;
    }

    function left() as Number {
        var l = course.total - progress;
        return l < 0 ? 0 : l.toNumber();
    }

    //! Najbliższy odcinek w zakresie a…b (indeksy odcinków). Wynik w _bi, _bt, _bd.
    hidden function nearest(la as Number, lo as Number, a as Number, b as Number) as Void {
        var c = course;
        _bd = 1.0e9; _bi = a < 0 ? 0 : a; _bt = 0.0;
        if (a < 0) { a = 0; }
        if (b > c.n - 2) { b = c.n - 2; }
        if (a > b) { return; }
        var kx = Math.cos(la / 1000000.0 * Math.PI / 180.0) * 0.11132;   // m na mikrostopień długości
        var ky = 0.11054;
        var ax = (c.lon(a) - lo) * kx;
        var ay = (c.lat(a) - la) * ky;
        for (var i = a; i <= b; i++) {
            var bx = (c.lon(i + 1) - lo) * kx;
            var by = (c.lat(i + 1) - la) * ky;
            var dx = bx - ax;
            var dy = by - ay;
            var l2 = dx * dx + dy * dy;
            var t = 0.0;
            if (l2 > 0) { t = Util.clamp(-(ax * dx + ay * dy) / l2, 0.0, 1.0); }
            var px = ax + t * dx;
            var py = ay + t * dy;
            var d = Math.sqrt(px * px + py * py);
            if (d < _bd) { _bd = d; _bi = i; _bt = t; }
            ax = bx; ay = by;
        }
    }

    //! Pozycja w stopniach, prędkość w km/h (albo null), czas jazdy w sekundach (do odmierzania komunikatów).
    function update(latDeg, lonDeg, speedKmh, now as Number) as Void {
        if (speedKmh != null && speedKmh >= 0) { _speed = _speed * 0.6 + speedKmh * 0.4; }
        if (!enabled || course.n < 2) { return; }
        var la = (latDeg * 1000000.0).toNumber();
        var lo = (lonDeg * 1000000.0).toNumber();
        var c = course;
        // okno wokół ostatniej pozycji: ok. 300 m wstecz i 3 km do przodu (ślad jest uproszczony – liczymy po dystansie)
        var a = idx;
        while (a > 0 && c.cum[idx] - c.cum[a] < 300) { a--; }
        var b = idx + 1;
        while (b < c.n - 2 && c.cum[b] - c.cum[idx] < 3000) { b++; }
        nearest(la, lo, a, b);
        var mi = _bi; var mt = _bt; var md = _bd;
        // brak dopasowania → co 5 s szukaj po całej trasie
        if ((!acquired || md > 60) && now - _lastGlobal >= 5) {
            _lastGlobal = now;
            nearest(la, lo, 0, c.n - 2);
            if (_bd + 5 < md) { mi = _bi; mt = _bt; md = _bd; }
        }
        offDist = md;
        nearLat = (c.lat(mi) + (c.lat(mi + 1) - c.lat(mi)) * mt).toNumber();
        nearLon = (c.lon(mi) + (c.lon(mi + 1) - c.lon(mi)) * mt).toNumber();
        if (!acquired) {
            if (md <= 40) {
                acquired = true; idx = mi;
                say("navStart", { "name" => c.name });
            } else {
                if (!_toStartSaid && md > 150) { _toStartSaid = true; say("navToStart", { "m" => Util.round(md / 10.0) * 10 }); }
                return;
            }
        }
        if (md > 50) {
            if (_offSince < 0) { _offSince = now; }
            // dwa komunikaty: po 8 s i po 2 min (wyciszenie) – potem cisza do powrotu na trasę
            if (!offRoute && now - _offSince >= 8) {
                offRoute = true; _lastOffSay = now; muted = false;
                say("navOff", {});
            } else if (offRoute && !muted && now - _lastOffSay >= 120) {
                muted = true;
                say("navMute", {});
            }
            return;     // poza trasą nie przesuwamy postępu
        }
        _offSince = -1;
        if (offRoute && md <= 30) { offRoute = false; muted = false; say("navBack", {}); }
        idx = mi;
        progress = c.cum[mi] + (c.cum[mi + 1] - c.cum[mi]) * mt;
        checkCues();
        checkClimbs();
        checkPois();
        checkDistance();
    }

    //! Woda, kawiarnia i serwis 2 km przed nami – jedna zapowiedź na punkt (zaplanuj postój albo bidon).
    hidden function checkPois() as Void {
        var ps = course.pois;
        for (var i = 0; i < ps.size(); i++) {
            var k = ps[i][1];
            if (k != 0 && k != 1 && k != 3) { continue; }
            var to = ps[i][0] - progress;
            if (to < 0 || _poiSaid[i] > 0) { continue; }
            if (to <= 2000 && to > 300) {
                _poiSaid[i] = 1;
                say("navPoi", { "name" => Util.str(ps[i][2], Poi.label(k)), "kind" => Poi.label(k), "km" => (to / 1000.0).format("%.1f"), "m" => Util.round(to / 100.0) * 100 });
                return;
            }
        }
    }

    //! Najbliższe punkty „Przed tobą”: [[indeks, metry do punktu], …] (najwyżej `count`).
    function nextPois(count as Number) {
        var out = [];
        var ps = course.pois;
        for (var i = 0; i < ps.size() && out.size() < count; i++) {
            var to = ps[i][0] - progress;
            if (to >= -50) { out.add([i, to < 0 ? 0 : to.toNumber()]); }
        }
        return out;
    }

    //! Indeks najbliższego niewykonanego skrętu (≥ 20 m za nim = wykonany) albo -1.
    function nextCueIdx(margin as Number) as Number {
        var cs = course.cues;
        for (var i = 0; i < cs.size(); i++) {
            if (cs[i][0] - progress >= -margin) { return i; }
        }
        return -1;
    }

    //! Liczy się wyłącznie najbliższy niewykonany skręt – o kolejnym mówimy dopiero po minięciu tego.
    hidden function checkCues() as Void {
        var fast = _speed > 32;
        var far = fast ? 500 : 300;
        var nowDist = fast ? 70 : 45;
        var i = nextCueIdx(20);
        if (i < 0) { return; }
        var cs = course.cues;
        var to = cs[i][0] - progress;
        var said = _cueSaid[i];
        var prevClose = i > 0 && cs[i][0] - cs[i - 1][0] < 150;   // tuż po poprzednim skręcie – tylko „teraz”
        var dir = cs[i][1];
        if (said < 1 && to <= far && to > nowDist + 40 && !prevClose) {
            _cueSaid[i] = 1;
            var label = to > 400 ? 500 : (to > 250 ? 300 : (to > 150 ? 200 : 100));
            say("navTurn", { "dist" => label, "dir" => Dir.key(dir), "m" => label, "dirTxt" => Dir.label(dir), "code" => dir });
        } else if (said < 2 && to <= nowDist) {
            _cueSaid[i] = 2;
            say("navTurn", { "dist" => 0, "dir" => Dir.key(dir), "m" => 0, "dirTxt" => Dir.label(dir), "code" => dir });
        }
    }

    hidden function climbVars(cl) {
        var len = cl[1] - cl[0];
        var v = { "len" => (len / 1000.0).format("%.1f"), "grade" => Util.round(cl[3] / 10.0), "gain" => cl[2] } as Dictionary;
        if (cl[4] > 0 && cl[5] > 0) {
            v.put("low", cl[4]); v.put("high", cl[5]);
            v.put("target", "cel " + cl[4] + "-" + cl[5] + " W");
        } else {
            v.put("target", "+" + cl[2] + " m");
        }
        if (cl[6] > 0) { v.put("tier", ["", "oszczedz", "atak", "full"][cl[6]]); }
        return v;
    }

    hidden function checkClimbs() as Void {
        var cls = course.climbs;
        for (var i = 0; i < cls.size(); i++) {
            var cl = cls[i];
            var said = _climbSaid[i];
            if (said < 1 && progress < cl[0] && cl[0] - progress <= 1000) {
                _climbSaid[i] = 1; say("navClimb", climbVars(cl));
            } else if (said < 2 && progress >= cl[0] && progress < cl[1] - 200) {
                _climbSaid[i] = 2; say("navClimbStart", climbVars(cl));
            } else if (said == 2 && progress >= cl[1]) {
                _climbSaid[i] = 3; say("navTop", climbVars(cl));
            }
        }
    }

    hidden function checkDistance() as Void {
        var l = left();
        if (!_done && l <= 40) { _done = true; say("navDone", {}); return; }
        var km = l / 1000;
        // kamienie milowe: 1, 2, 5, co 10 km do 100, potem co 20 km
        if (_lastKmLeft >= 0 && km < _lastKmLeft && l > 500) {
            var marks = [1, 2, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300];
            for (var i = 0; i < marks.size(); i++) {
                if (marks[i] > km && marks[i] <= _lastKmLeft) { say("navLeft", { "km" => marks[i] }); break; }
            }
        }
        _lastKmLeft = km;
    }

    hidden function say(key as String, vars) as Void {
        if (owner != null) { owner.onNav(key, vars); }
    }

    // ------------------------------------------------------------------ stan dla ekranu i trenera
    //! [kod kierunku, metry do skrętu] albo null.
    function nextTurn() {
        var i = nextCueIdx(10);
        if (i < 0) { return null; }
        var to = course.cues[i][0] - progress;
        return [course.cues[i][1], to < 0 ? 0 : to.toNumber()];
    }

    //! Najbliższy podjazd (także ten, na którym jesteśmy): [indeks, metry do startu (0 = na podjeździe), metry do szczytu].
    function nextClimb() {
        var cls = course.climbs;
        for (var i = 0; i < cls.size(); i++) {
            if (cls[i][1] > progress) {
                var inM = cls[i][0] - progress;
                return [i, inM < 0 ? 0 : inM.toNumber(), (cls[i][1] - progress).toNumber()];
            }
        }
        return null;
    }

    //! Stan dla trenera – te same pola co w telefonie (RouteNavigator.state()).
    function state() {
        var d = { "name" => course.name, "total" => course.total, "progress" => progress.toNumber(), "left" => left(),
            "acquired" => acquired, "offRoute" => offRoute, "enabled" => enabled } as Dictionary;
        var t = nextTurn();
        if (t != null) { d.put("nextTurn", { "dir" => Dir.key(t[0]), "in" => t[1] }); }
        var nc = nextClimb();
        if (nc != null) {
            var cl = course.climbs[nc[0]];
            var cd = { "in" => nc[1], "len" => cl[1] - cl[0], "grade" => cl[3] / 10.0, "gain" => cl[2], "onIt" => nc[1] == 0 } as Dictionary;
            if (cl[4] > 0) { cd.put("low", cl[4]); cd.put("high", cl[5]); }
            if (cl[6] > 0) { cd.put("tier", ["", "oszczedz", "atak", "full"][cl[6]]); }
            d.put("nextClimb", cd);
        }
        return d;
    }
}
