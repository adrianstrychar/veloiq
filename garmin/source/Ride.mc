import Toybox.Activity;
import Toybox.Application;
import Toybox.Attention;
import Toybox.Lang;
import Toybox.StringUtil;
import Toybox.System;
import Toybox.Time;
import Toybox.Timer;
import Toybox.WatchUi;

module RideState {
    const IDLE = 0;
    const RECORDING = 1;
    const PAUSED = 2;        // pauza ręczna
    const AUTOPAUSED = 3;    // postój (auto-pauza całej jazdy)
    const DONE = 4;          // zapisane – ekran podsumowania
}

//! Kontroler jazdy: spina czujniki, silnik treningu, nagrywanie FIT, lapy, komunikaty, telefon i wysyłkę.
//! Jeden obiekt na całą aplikację (Application.getApp().ride). tick() co sekundę z zegara.
class Ride {
    var state as Number = 0;
    var hub as SensorHub;
    var rec as Recorder;
    var api as Api;
    var up as Uploader;
    var link as PhoneLink;
    var pairing as Pairing;

    var course = null;          // trasa GPX z VeloIQ (Course) albo null
    var nav = null;             // nawigacja bieżącej jazdy (Nav) albo null
    var courseNote = null;      // stan pobierania trasy do pokazania na ekranie startowym
    hidden var _cMeta = null;   // nagłówek pobieranej trasy
    hidden var _cPart as Number = 0;
    hidden var _reroute as Boolean = false;   // pobierana trasa to powrót na trasę / do startu – wchodzi w trakcie jazdy
    var startLat = null;        // miejsce startu jazdy (pierwszy fix GPS) – „prowadź do startu”
    var startLon = null;
    // wykres treningu i paliwo
    var pTrace = null;          // moc co 10 s (W / 4 w bajcie) – strona WYKRES
    hidden var _trSum as Number = 0;
    hidden var _trN as Number = 0;
    var choBurn as Float = 0.0; // g węglowodanów spalonych (szacunek z intensywności względem FTP)
    var choEat as Number = 0;   // g zjedzonych (żel 25 g, baton 40 g – z ekranu, menu albo głosem)
    var drinks as Number = 0;

    var plan = null;            // trening wybrany na ekranie startowym (Workout) albo null
    var wk = null;              // trening bieżącej jazdy (plan albo jazda swobodna)
    var eng = null;             // Engine bieżącej jazdy
    var startEpoch as Number = 0;

    // --- dane „z licznika” (Activity.Info): dystans, przewyższenie, prędkość
    var dist as Float = 0.0;    // m
    var ascent as Number = 0;   // m
    var speed = null;           // m/s

    // --- bieżące okrążenie
    var lapNo as Number = 1;
    var lapStartS as Number = 0;
    var lapSumP as Number = 0;
    var lapN as Number = 0;
    var lapSumHr as Number = 0;
    var lapHrN as Number = 0;
    var lapMaxP as Number = 0;
    var lapStartDist as Float = 0.0;
    var prevLap = null;         // { no, sec, avgP, avgHr, dist, type }
    hidden var _lapTarget as Number = 0;
    hidden var _lapType as Number = 5;
    hidden var _autoLapDist as Float = 0.0;
    hidden var _autoLapSec as Number = 0;
    hidden var _fast as Boolean = false;
    hidden var _slowRun as Number = 0;
    // --- podjazd (auto-lap „wysiłki”): z trasy GPX albo z wysokościomierza licznika
    var climbing as Boolean = false;
    hidden var _segClimb as Boolean = false;    // bieżący mocny odcinek to podjazd
    hidden var _climbBase as Float = 0.0;
    hidden var _climbTop as Float = 0.0;
    hidden var _cdD = null;                     // próbki co 5 s: dystans i wysokość z ostatnich ~2,5 min
    hidden var _cdA = null;

    // --- zapis do wysyłki: próbki 5 s i ślad GPS co 10 s
    hidden var _sStore = null;
    hidden var _gStore = null;
    hidden var _dsSum as Number = 0;
    hidden var _dsN as Number = 0;
    hidden var _dsCad as Number = 0;
    hidden var _dsCadN as Number = 0;
    hidden var _gpsSeen as Boolean = false;

    // --- komunikaty
    var cues;                   // ostatnie komunikaty: [[s, rodzaj, tekst], …] (najnowszy na końcu)
    var banner = null;          // tekst banera na ekranie jazdy
    var bannerKind as String = "";
    hidden var _bannerUntil as Number = 0;

    // --- Enzo
    var enzoBusy as Boolean = false;
    var enzoText = null;        // odpowiedź Enzo pokazywana jako karta
    hidden var _enzoUntil as Number = 0;

    // --- auto-pauza całej jazdy
    hidden var _stillRun as Number = 0;
    hidden var _moveRun as Number = 0;

    // --- przerwana jazda (wyłączenie licznika, awaria): punkt kontrolny co minutę i wznowienie po uruchomieniu
    var interrupted = null;     // punkt kontrolny czekający na decyzję: { t, s, name, d, … } albo null
    var resumePct as Number = -1;       // odtwarzanie przerwanej jazdy: 0–100, -1 = nie trwa
    var replayAuto as Boolean = true;   // false tylko w testach: odtwarzanie krokami wywoływanymi ręcznie
    hidden var _rp = null;
    hidden var _rpTimer = null;
    hidden var _replaying as Boolean = false;
    hidden var _distBase as Float = 0.0;
    hidden var _vSpeed as Float = 0.0;     // wirtualna prędkość na trenażerze (m/s)
    hidden var _vDist as Float = 0.0;      // wirtualny dystans tej jazdy (m)
    hidden var _vDistOn as Boolean = false;
    //! Tryb „na zewnątrz”, a przez minutę kręcisz bez GPS i bez czujnika prędkości = trenażer: prędkość i dystans
    //! z mocy do końca jazdy (zapomniany przełącznik trybu nie kończy się zerową prędkością).
    var autoIndoor as Boolean = false;
    hidden var _noGpsPow as Number = 0;
    hidden var _gpsThisRide as Boolean = false;   // po pierwszym GPS w tej jeździe nie zgadujemy (tunel ≠ trenażer)
    hidden var _ascBase as Number = 0;
    hidden var _ckS as Number = 0;      // pierwszy blok próbek, który trzeba (ponownie) zapisać
    hidden var _ckG as Number = 0;

    var result = null;          // podsumowanie po zapisie
    var recordFit as Boolean = true;   // false tylko w testach: symulator nie pozwala założyć drugiej sesji FIT w tym samym wywołaniu
    var uiPage as Number = -1;  // prośba o przełączenie strony ekranu jazdy – identyfikator Pg (głos, tryb demo)
    var uiZoom as Number = -1;  // jw. – skala mapy na stronie TRASA
    var saved as Boolean = false;
    var quiet as Boolean = false;      // testy: bez wibracji (symulator bez ekranu zawiesza się na Attention.vibrate)
    hidden var _timer = null;
    hidden var _tickNo as Number = 0;

    function initialize() {
        hub = new SensorHub();
        rec = new Recorder();
        api = new Api();
        up = new Uploader(api);
        link = new PhoneLink();
        pairing = new Pairing();
        cues = [];
        link.owner = self;
        up.onDone = method(:onUploaded);
    }

    //! Jazda dotarła do VeloIQ: wyraźny sygnał (dźwięk + wibracja), a telefon dostaje potwierdzenie do karty jazdy.
    function onUploaded() as Void {
        tone("save");
        if (!quiet && (Attention has :vibrate)) { Attention.vibrate([new Attention.VibeProfile(60, 250)]); }
        link.event({ "t" => "up", "k" => up.doneKey, "ok" => 1 });
    }

    function boot() as Void {
        Cfg.load();
        Th.apply(Cfg.theme);
        hub.start(!Cfg.indoor);
        link.start();
        _timer = new Timer.Timer();
        _timer.start(method(:onTick), 1000, true);
        loadPlan();
        course = Course.load();
        detectInterrupted();
        if (Cfg.paired()) { sync(null); } else { up.kick(); }   // po starcie: świeży plan z VeloIQ
        Demo.boot(self);
    }

    function shutdown() as Void {
        if (_timer != null) { _timer.stop(); _timer = null; }
        if (_rpTimer != null) { _rpTimer.stop(); _rpTimer = null; }
        // aplikacja zamykana w trakcie jazdy (np. wyłączenie licznika): plik FIT z dotychczasową częścią zostaje
        // zapisany, a jazda czeka w punkcie kontrolnym – po uruchomieniu można ją wznowić albo zakończyć i wysłać
        if (active() && eng != null && !_replaying) {
            flushSample(true);
            checkpoint();
            rec.finish(eng.m.np(), eng.m.tss(), eng.m.intensity(), eng.compliancePct(), _lapTarget, _lapType);
        }
        hub.stop();
        link.stop();
    }

    // ------------------------------------------------------------------ plan z VeloIQ
    //! Synchronizacja z VeloIQ: zawodnik (FTP, HRmax, waga), treningi na najbliższe dni, odprawa na dziś.
    //! Wynik zostaje w pamięci licznika, więc trening da się potem odpalić bez telefonu.
    hidden var _syncScr = null;

    function sync(scr) as Void {
        if (!Cfg.paired()) { return; }
        _syncScr = scr;
        api.get("/api/garmin/sync", null, method(:onSync));
    }

    function onSync(code as Number, data) as Void {
        var scr = _syncScr;
        _syncScr = null;
        if (code != 200 || data == null) {
            if (scr != null) { scr.flash(Api.errorText(code)); }
            return;
        }
        var a = data.get("athlete");
        if (a instanceof Dictionary) {
            Cfg.put("athlete", Util.str(a.get("name"), ""));
            var f = Util.int(a.get("ftp"), 0);
            if (f >= 80) { Cfg.put("ftp", f); }
            Cfg.put("hrmax", Util.int(a.get("hrmax"), 0));
            var kg = Util.int(a.get("kg"), 0);
            if (kg > 30) { Cfg.put("weightKg", kg); }
            var wp = Util.int(a.get("wPrime"), 0);
            if (wp > 1000) { Cfg.put("wPrime", wp); }
        }
        // każdy trening osobno – jedna wartość w pamięci licznika ma ograniczony rozmiar
        var list = data.get("workouts");
        var n = 0;
        if (list instanceof Array) {
            for (var i = 0; i < list.size() && i < 10; i++) {
                if (list[i] instanceof Dictionary) { Application.Storage.setValue("wk_" + n, list[i]); n++; }
            }
        }
        Application.Storage.setValue("wkn", n);
        Application.Storage.setValue("brief", data.get("brief"));
        Application.Storage.setValue("briefDate", Util.str(data.get("today"), ""));
        Application.Storage.setValue("rtk", Util.str(data.get("rideToken"), ""));
        courseSync(data.get("courseId"));
        Application.Storage.deleteValue("pick");     // po synchronizacji znów domyślnie trening na dziś
        Cfg.load();
        if (!active()) { loadPlan(); }
        up.kick();
        if (scr != null) { scr.flash(plan != null ? "Pobrano: " + Util.ellipsis(plan.name, 26) : "Zsynchronizowano, dziś bez treningu"); }
        WatchUi.requestUpdate();
    }

    // ------------------------------------------------------------------ trasa GPX z VeloIQ
    //! Po synchronizacji: serwer podaje identyfikator trasy przygotowanej dla licznika (null = brak).
    //! Nowa trasa jest pobierana częściami (małe odpowiedzi), stara zostaje do końca pobierania nietknięta w pamięci RAM.
    hidden function courseSync(idv) as Void {
        var id = idv == null ? "" : idv.toString();
        if (id.length() == 0) {
            if (Course.storedId().length() > 0) { Course.clear(); }
            if (!active()) { course = null; }
            return;
        }
        if (id.equals(Course.storedId())) { return; }
        courseNote = "Pobieram trasę...";
        api.get("/api/garmin/course/part", { "i" => "meta" }, method(:onCourseMeta));
    }

    function onCourseMeta(code as Number, data) as Void {
        if (code != 200 || data == null || !(data instanceof Dictionary) || Util.int(data.get("parts"), 0) <= 0) {
            courseNote = "Trasa: " + Api.errorText(code);
            _reroute = false;
            return;
        }
        Course.clear();
        _cMeta = data;
        _cPart = 0;
        nextCoursePart();
    }

    hidden function nextCoursePart() as Void {
        var parts = Util.int(_cMeta.get("parts"), 0);
        courseNote = "Pobieram trasę " + (_cPart + 1) + "/" + parts;
        api.get("/api/garmin/course/part", { "i" => _cPart, "id" => Util.str(_cMeta.get("id"), "") }, method(:onCoursePart));
        WatchUi.requestUpdate();
    }

    function onCoursePart(code as Number, data) as Void {
        if (_cMeta == null) { return; }
        if (code != 200 || data == null || !(data instanceof Dictionary) || data.get("d") == null) {
            courseNote = "Trasa: " + Api.errorText(code);
            _cMeta = null;
            return;
        }
        try {
            Application.Storage.setValue("crs_p" + _cPart, data.get("d").toString());
        } catch (ex) {
            courseNote = "Trasa: brak miejsca w pamięci";
            _cMeta = null;
            return;
        }
        _cPart++;
        if (_cPart < Util.int(_cMeta.get("parts"), 0)) { nextCoursePart(); return; }
        // komplet: nagłówek, skręty i podjazdy osobno (jedna wartość w pamięci licznika ma ograniczony rozmiar)
        var id = Util.str(_cMeta.get("id"), "");
        Application.Storage.setValue("crs_t", _cMeta.get("cues"));
        Application.Storage.setValue("crs_c", _cMeta.get("climbs"));
        Application.Storage.setValue("crs_s", _cMeta.get("surf"));
        Application.Storage.setValue("crs_q", _cMeta.get("pois"));
        Application.Storage.setValue("crs", { "id" => id, "name" => _cMeta.get("name"), "total" => _cMeta.get("total"),
            "gain" => _cMeta.get("gain"), "n" => _cMeta.get("n"), "parts" => _cMeta.get("parts"), "prof" => _cMeta.get("prof") });
        Application.Storage.setValue("crs_ok", id);
        _cMeta = null;
        var c = Course.load();
        if (!active()) { course = c; }
        else if (_reroute && c != null) {
            // nowa trasa w trakcie jazdy: nawigacja od nowa (dopasuje się do pozycji w kilka sekund)
            course = c;
            nav = new Nav(c);
            nav.owner = self;
            showBanner("Nowa trasa\n" + (c.total / 1000.0).format("%.1f") + " km", "nav", 6);
            tone("good");
        }
        _reroute = false;
        courseNote = c == null ? "Trasa: błąd danych" : null;
        WatchUi.requestUpdate();
    }

    //! Trening na dziś (albo wybrany z listy) z ostatniej synchronizacji.
    function loadPlan() as Void {
        plan = null;
        var n = Cfg.get("wkn", 0);
        var pick = Cfg.get("pick", null);
        var today = todayIso();
        var chosen = null;
        for (var i = 0; i < n; i++) {
            var d = Application.Storage.getValue("wk_" + i);
            if (d == null || !(d instanceof Dictionary)) { continue; }
            if (pick != null && Util.str(d.get("id"), "").equals(pick)) { chosen = d; break; }
            if (pick == null && Util.str(d.get("date"), "").equals(today)) { chosen = d; break; }
        }
        if (chosen == null) { return; }
        var w = Workout.fromDict(chosen, Cfg.ftp, Cfg.weightKg);
        if (w == null || w.steps.size() == 0) { return; }
        if (w.date.equals(today) && Util.str(Cfg.get("briefDate", ""), "").equals(today)) { w.applyBrief(Cfg.get("brief", null)); }
        plan = w;
    }

    function todayIso() as String {
        var t = Time.Gregorian.info(Time.now(), Time.FORMAT_SHORT);
        return t.year.format("%04d") + "-" + t.month.format("%02d") + "-" + t.day.format("%02d");
    }

    //! Lista treningów z synchronizacji (do menu wyboru): [[id, nazwa, opis], …].
    function workoutList() {
        var out = [];
        var n = Cfg.get("wkn", 0);
        for (var i = 0; i < n; i++) {
            var d = Application.Storage.getValue("wk_" + i);
            if (d == null || !(d instanceof Dictionary)) { continue; }
            var dur = Util.int(d.get("dur"), 0);
            out.add([Util.str(d.get("id"), ""), Util.str(d.get("name"), "Trening"),
                Util.str(d.get("date"), "") + ", " + (dur / 60) + " min"]);
        }
        return out;
    }

    // ------------------------------------------------------------------ start / pauza / koniec
    function startRide(free as Boolean) as Boolean {
        if (state != RideState.IDLE && state != RideState.DONE) { return false; }
        if (interrupted != null || resumePct >= 0) { return false; }     // najpierw decyzja o przerwanej jeździe
        coveredN = 0;
        if (free || plan == null) {
            var w = new Workout();
            w.ftp = Cfg.ftp;
            w.weightKg = Cfg.weightKg;
            wk = w;
        } else {
            wk = plan;
        }
        if (recordFit && !rec.start(wk.isFree() ? "VeloIQ" : wk.name, Cfg.indoor)) {
            showBanner("Nie mogę rozpocząć nagrywania", "error", 6);
            return false;
        }
        eng = new Engine(wk, Cfg.wPrime);
        eng.listener = self;
        nav = null;
        if (course != null && Cfg.navOn && !Cfg.indoor) {
            nav = new Nav(course);
            nav.owner = self;
        }
        startEpoch = Time.now().value();
        initRide();
        clearCheckpoint();
        if (!wk.isFree() && wk.src != null) {
            try { Application.Storage.setValue("ck_wk", wk.src); } catch (ex) {}
        }
        state = RideState.RECORDING;
        tone("start");
        link.event(startMsg(false));
        return true;
    }

    //! Zerowanie stanu jazdy (wspólne dla startu i wznowienia przerwanej jazdy).
    hidden function initRide() as Void {
        dist = 0.0; ascent = 0; speed = null;
        _distBase = 0.0; _ascBase = 0;
        _vSpeed = 0.0; _vDist = 0.0; _vDistOn = false;
        autoIndoor = false; _noGpsPow = 0; _gpsThisRide = false;
        lapNo = 1; lapStartS = 0; lapSumP = 0; lapN = 0; lapSumHr = 0; lapHrN = 0; lapMaxP = 0; lapStartDist = 0.0; prevLap = null;
        _lapTarget = wk.isFree() ? 0 : (wk.steps[0].lo + wk.steps[0].hi) / 2;
        _lapType = wk.isFree() ? StepType.FREE : wk.steps[0].type;
        _autoLapDist = 0.0; _autoLapSec = 0; _fast = false; _slowRun = 0;
        climbing = false; _segClimb = false; _climbBase = 0.0; _climbTop = 0.0; _cdD = []; _cdA = [];
        _sStore = new BlockStore(4, 2248);
        _gStore = new BlockStore(10, 2250);
        _dsSum = 0; _dsN = 0; _dsCad = 0; _dsCadN = 0; _gpsSeen = false;
        _ckS = 0; _ckG = 0;
        cues = []; banner = null; enzoText = null; enzoBusy = false;
        startLat = null; startLon = null;
        pTrace = []b; _trSum = 0; _trN = 0; choBurn = 0.0; choEat = 0; drinks = 0;
        _stillRun = 0; _moveRun = 0;
        result = null; saved = false;
    }

    function pause() as Void {
        if (state != RideState.RECORDING && state != RideState.AUTOPAUSED) { return; }
        checkpoint();
        rec.pause();
        state = RideState.PAUSED;
        tone("stop");
        link.event({ "t" => "state", "s" => "pause", "k" => startEpoch });
    }

    function resume() as Void {
        if (state != RideState.PAUSED && state != RideState.AUTOPAUSED) { return; }
        rec.resume();
        state = RideState.RECORDING;
        _stillRun = 0; _moveRun = 0;
        tone("start");
        link.event({ "t" => "state", "s" => "resume", "k" => startEpoch });
    }

    function togglePause() as Void {
        if (state == RideState.RECORDING || state == RideState.AUTOPAUSED) { pause(); }
        else if (state == RideState.PAUSED) { resume(); }
    }

    function active() as Boolean {
        return state == RideState.RECORDING || state == RideState.PAUSED || state == RideState.AUTOPAUSED;
    }

    //! Ekran jazdy był zasłonięty przez okno systemu (np. powiadomienie z telefonu, które na Edge wisi do
    //! zamknięcia ręką – aplikacja nie może wtedy rysować ani go zamknąć). Raz na jazdę: skąd to i jak wyłączyć.
    var coveredN as Number = 0;
    function coveredBySystem(sec as Number) as Void {
        coveredN++;
        if (coveredN > 1) { return; }
        showBanner("Ekran zasłonięty " + sec + " s, jazda szła dalej.\nPowiadomienia z telefonu wyłączysz w ustawieniach licznika.", "info", 12);
        WatchUi.requestUpdate();
    }

    //! Kończy jazdę. save = false → odrzuć (bez zapisu FIT i bez wysyłki).
    function finish(save as Boolean) as Void {
        if (!active() || eng == null) { return; }
        var m = eng.m;
        clearCheckpoint();          // przed kolejką wysyłki – zwalnia miejsce w pamięci licznika
        if (!save) {
            rec.discard();
            state = RideState.IDLE;
            eng = null;
            link.event({ "t" => "state", "s" => "end", "saved" => 0, "k" => startEpoch });
            return;
        }
        flushSample(true);
        saved = rec.finish(m.np(), m.tss(), m.intensity(), eng.compliancePct(), _lapTarget, _lapType);
        result = buildSummary();
        // jazdy krótsze niż minuta nie wysyłamy (serwer i tak by je pominął)
        if (m.n >= 60) {
            var sb = [];
            for (var i = 0; i < _sStore.blockCount(); i++) { sb.add(Util.b64(_sStore.block(i))); }
            var gb = [];
            if (_gpsSeen) {
                for (var j = 0; j < _gStore.blockCount(); j++) { gb.add(Util.b64(_gStore.block(j))); }
            }
            up.enqueue(startEpoch, result, buildExtra(), sb, gb);
            up.kick();
        }
        _sStore = null; _gStore = null;
        state = RideState.DONE;
        tone("save");
        link.event({ "t" => "state", "s" => "end", "saved" => 1, "k" => startEpoch, "dur" => m.n,
            "np" => m.np(), "avg" => m.avgPower(), "up" => (m.n >= 60 ? 1 : 0) });
    }

    //! Po ekranie podsumowania – powrót na ekran startowy.
    function reset() as Void {
        hub.simulated = false;
        state = RideState.IDLE;
        eng = null;
        nav = null;
        if (course == null || !course.id.equals(Course.storedId())) { course = Course.load(); }
        wk = null;
        loadPlan();
    }

    // ------------------------------------------------------------------ zegar 1 Hz
    function onTick() as Void {
        _tickNo++;
        var now = System.getTimer();
        if (banner != null && now > _bannerUntil) { banner = null; }
        if (enzoText != null && now > _enzoUntil) { enzoText = null; }

        if (state == RideState.RECORDING || state == RideState.AUTOPAUSED) {
            var ai = hub.simulated ? null : Activity.getActivityInfo();
            if (ai != null) {
                // dystans z czujnika / GPS – chyba że trenażer wykryty sam liczy już dystans z mocy (późny GPS w budynku)
                if (ai.elapsedDistance != null && ai.elapsedDistance > 0 && !(autoIndoor && _vDistOn)) { dist = _distBase + ai.elapsedDistance; _vDistOn = false; }
                if (ai.totalAscent != null) { ascent = _ascBase + ai.totalAscent; }
                speed = ai.currentSpeed != null ? ai.currentSpeed : hub.speed;
            } else {
                speed = hub.speed;
            }
            // trenażer bez czujnika prędkości: prędkość i dystans z mocy (jak w Zwift) – płasko, bez wiatru
            if (!Cfg.indoor && !autoIndoor && !hub.simulated && state == RideState.RECORDING) { detectTrainer(); }
            if ((Cfg.indoor || autoIndoor) && !hub.simulated && (speed == null || speed <= 0.1)) { virtualSpeedTick(); }
            if (!hub.simulated) { autoPauseTick(); }
        }
        if (state == RideState.RECORDING && !hub.simulated) { rideTick(); }
        link.tick();
        pairing.tick();
        // pauza (ręczna albo postój): telefon dalej widzi jazdę – inaczej po 5 s uznałby, że most zerwany
        if ((state == RideState.PAUSED || state == RideState.AUTOPAUSED) && eng != null && !hub.simulated && Cfg.phoneLink) {
            link.live(liveVec(state == RideState.PAUSED ? 1 : 2));
        }
        // co 30 s pełny stan jazdy dla telefonu (pytania do Enzo z telefonu albo przycisku Flic)
        if (active() && eng != null && link.active && _tickNo % 30 == 15) {
            link.event({ "t" => "st", "st" => coachState() });
        }
        // wysyłka zakończonej jazdy: także na ekranie podsumowania, z szybkim ponawianiem (5 s → 60 s)
        if ((state == RideState.IDLE || state == RideState.DONE) && !hub.simulated) { up.tick(); }
        // telefon: podgląd czujników przed startem (ekran Czujniki w aplikacji pokazuje, że most działa);
        // bez telefonu co 10 s (wystarczy, żeby aplikacja w telefonie się odezwała), nie w trakcie wysyłki jazdy
        if (state == RideState.IDLE && Cfg.phoneLink && !hub.simulated && !up.running()
            && _tickNo % (link.active ? 2 : 5) == 0) {
            link.live([-1, hub.power == null ? -1 : hub.power, hub.hr == null ? 0 : hub.hr, hub.cad == null ? -1 : hub.cad,
                hub.speed == null ? -1 : Util.round(hub.speed * 36), Phase.FREE, 0, 0, 0, 0, 0]);
        }
        Demo.tick(self);
        WatchUi.requestUpdate();
    }

    hidden function detectTrainer() as Void {
        if (hub.hasGps()) { _gpsThisRide = true; }
        if (_gpsThisRide || (speed != null && speed > 0.1)) { _noGpsPow = 0; return; }
        if (hub.power == null || hub.power < 30) { return; }
        _noGpsPow++;
        if (_noGpsPow >= 60) {
            autoIndoor = true;
            showBanner("Brak GPS, a kręcisz – trenażer?\nPrędkość i dystans liczę z mocy.", "info", 8);
            tone("msg");
        }
    }

    //! Wirtualna prędkość na trenażerze bez czujnika prędkości: z mocy, masy zawodnika (+8 kg roweru), pozycji na
    //! klamkomanetkach (CdA 0,32 m²) i oporu toczenia 0,004 na płaskim. Dystans rośnie o tę prędkość co sekundę
    //! (tylko w trakcie nagrywania, nie na pauzie).
    hidden function virtualSpeedTick() as Void {
        var p = hub.power;
        var v = (p == null || p <= 0) ? 0.0 : Ride.speedFromPower(p.toFloat(), Cfg.weightKg + 8.0);
        // łagodne wygaszanie, gdy przestajesz kręcić (koło trenażera jeszcze się kręci)
        if (v <= 0.0 && _vSpeed > 0.0) { v = _vSpeed * 0.85; if (v < 0.5) { v = 0.0; } }
        _vSpeed = v;
        speed = v;
        if (state == RideState.RECORDING && (_vDistOn || dist <= _distBase + 1.0)) {
            _vDistOn = true;
            _vDist += v;
            dist = _distBase + _vDist;
        }
    }

    //! Prędkość (m/s) z mocy na płaskim: 0,97·P = ½·ρ·CdA·v³ + Crr·m·g·v (bisekcja, ρ = 1,2 kg/m³).
    static function speedFromPower(p as Float, mass as Float) as Float {
        var pw = p * 0.97;
        var a = 0.5 * 1.2 * 0.32;
        var b = 0.004 * mass * 9.81;
        var lo = 0.0;
        var hi = 30.0;
        for (var i = 0; i < 30; i++) {
            var mid = (lo + hi) / 2.0;
            if (a * mid * mid * mid + b * mid > pw) { hi = mid; } else { lo = mid; }
        }
        return (lo + hi) / 2.0;
    }

    //! Auto-pauza jazdy jak w telefonie: zero mocy i kadencji, a na zewnątrz dodatkowo prędkość < 3 km/h
    //! (zjazd bez pedałowania to nie postój). 3 s postoju = pauza, 2 s ruchu = wznowienie.
    hidden function autoPauseTick() as Void {
        if (!Cfg.autoPause || eng == null || eng.s <= 10) { return; }
        var p = hub.power;
        var c = hub.cad;
        var pedaling = (p != null && p > 0) || (c != null && c > 0);
        var kmh = speed == null ? null : speed * 3.6;
        var moving = pedaling || (kmh != null && kmh >= 3);
        var still = false;
        if (!pedaling) {
            if (!Cfg.indoor) { still = kmh != null && kmh < 3; }
            else { still = p != null; }
        }
        if (state == RideState.AUTOPAUSED) {
            _moveRun = moving ? _moveRun + 1 : 0;
            if (_moveRun >= 2) {
                rec.resume();
                state = RideState.RECORDING;
                _moveRun = 0; _stillRun = 0;
                link.event({ "t" => "state", "s" => "resume", "auto" => 1, "k" => startEpoch });
            }
        } else {
            _stillRun = still ? _stillRun + 1 : 0;
            if (_stillRun >= 3) {
                rec.pause();
                state = RideState.AUTOPAUSED;
                _stillRun = 0; _moveRun = 0;
                link.event({ "t" => "state", "s" => "pause", "auto" => 1, "k" => startEpoch });
            }
        }
    }

    //! Sekunda jazdy z podanymi odczytami zamiast czujników (testy w symulatorze, tryb demo).
    function simTick(p, h, c, spd) as Void {
        hub.simulated = true;
        hub.power = p; hub.hr = h; hub.cad = c; hub.speed = spd;
        speed = spd;
        if (spd != null) { dist += spd; }
        if (state == RideState.RECORDING) { rideTick(); }
    }

    //! Tylko testy: stan jazdy znika z pamięci jak po awarii – bez zapisu i bez kasowania punktu kontrolnego.
    function dropForTest() as Void {
        state = RideState.IDLE;
        eng = null; wk = null; nav = null;
        _sStore = null; _gStore = null;
    }

    //! Pozycja podana z zewnątrz w mikrostopniach (testy w symulatorze, tryb demo).
    function simPos(latMicro as Number, lonMicro as Number) as Void {
        hub.simulated = true;
        hub.lat = latMicro / 1000000.0d;
        hub.lon = lonMicro / 1000000.0d;
    }

    hidden function rideTick() as Void {
        var p = hub.power;
        var h = hub.hr;
        var c = hub.cad;
        eng.tick(p, h, c);
        var pw = p == null ? 0 : p;
        accum(pw);

        // okrążenie
        lapN++; lapSumP += pw;
        if (pw > lapMaxP) { lapMaxP = pw; }
        if (h != null && h > 0) { lapSumHr += h; lapHrN++; }

        // FIT: cel kroku i W'bal
        var st = eng.step();
        rec.record(st == null ? 0 : (st.lo + st.hi) / 2, eng.m.wBal / 1000.0);

        // próbka 5 s i GPS co 10 s (do wysyłki)
        _dsSum += pw; _dsN++;
        if (c != null && c >= 0) { _dsCad += c; _dsCadN++; }
        if (eng.s % 5 == 4) { flushSample(false); }
        if (eng.s % 10 == 0) { pushGps(); }

        autoLapTick(pw);
        navTick();
        if (eng.s % 60 == 59) { checkpoint(); }

        // telefon: dane na żywo co sekundę – także zanim aplikacja w telefonie się odezwie (jej „hello” mogło
        // przepaść, a telefon i tak odbiera); bez telefonu wysyłka sama zwalnia (ponowienia co 1–5 s)
        if (link != null && Cfg.phoneLink) {
            link.live(liveVec(0));
        }
    }

    //! Sekunda jazdy dla wykresu (średnia co 10 s) i bilansu węglowodanów. Udział węglowodanów w spalaniu rośnie
    //! z intensywnością: ~35% poniżej 50% FTP, ~65% przy 75% FTP, ~90% przy progu (typowe wartości z badań).
    //! Energia z jedzenia ≈ praca w kJ (sprawność mięśni ~24% · 4,184 kJ/kcal ≈ 1).
    hidden function accum(pw as Number) as Void {
        _trSum += pw; _trN++;
        if (_trN >= 10) {
            var a = _trSum / _trN / 4;
            if (pTrace.size() < 4000) { pTrace.add(a > 255 ? 255 : a); }
            _trSum = 0; _trN = 0;
        }
        if (pw <= 0) { return; }
        var r = pw.toFloat() / eng.m.ftp;
        var f = r < 0.5 ? 0.35 : (r < 0.75 ? 0.35 + (r - 0.5) * 1.2 : (r < 1.0 ? 0.65 + (r - 0.75) : 0.95));
        choBurn += pw / 1000.0 * f / 4.0;
    }

    //! Jedzenie (g węglowodanów) albo picie (g = 0): przypomnienia silnika, bilans na stronie PALIWO.
    function fuel(g as Number) as Void {
        if (eng == null) { return; }
        if (g > 0) {
            eng.fueled(true);
            choEat += g;
            showBanner("Zapisane: " + g + " g\nrazem " + choEat + " g", "info", 3);
        } else {
            eng.fueled(false);
            drinks++;
            showBanner("Zapisane: picie", "info", 3);
        }
        WatchUi.requestUpdate();
    }

    //! Strona na życzenie (głos, menu): wyłączona w „Ekranach jazdy” – zawodnik chce ją widzieć, więc ją włączamy.
    function showPageById(name as String) as Void {
        var id = Pg.byName(name);
        if (id < 0) { return; }
        var k = null;
        var on = true;
        if (id == Pg.CHART) { k = "pgChart"; on = Cfg.pgChart; }
        else if (id == Pg.EFFORT) { k = "pgEffort"; on = Cfg.pgEffort; }
        else if (id == Pg.F2) { k = "pgF2"; on = Cfg.pgF2; }
        else if (id == Pg.FUEL) { k = "pgFuel"; on = Cfg.pgFuel; }
        else if (id == Pg.ENZO) { k = "pgEnzo"; on = Cfg.pgEnzo; }
        else if (id == Pg.CLIMB) { k = "pgClimb"; on = Cfg.pgClimb; }
        if (!on && k != null) { Cfg.save(k, true); }
        uiPage = id;
        WatchUi.requestUpdate();
    }

    hidden function flushSample(force as Boolean) as Void {
        if (_sStore == null || _dsN == 0) { return; }
        if (!force && _dsN < 5) { return; }
        var avg = Util.round(_dsSum.toFloat() / _dsN);
        var h = hub.hr;
        var cad = 255;      // 255 = brak czujnika kadencji
        if (_dsCadN > 0) { cad = Util.clamp(Util.round(_dsCad.toFloat() / _dsCadN), 0, 254); }
        if (avg > 65534) { avg = 65534; }
        var hb = (h == null || h <= 0) ? 0 : (h > 255 ? 255 : h);
        var r = [avg & 0xFF, (avg >> 8) & 0xFF, hb, cad]b;
        _sStore.add(r);
        _dsSum = 0; _dsN = 0; _dsCad = 0; _dsCadN = 0;
    }

    hidden function pushGps() as Void {
        if (_gStore == null || Cfg.indoor) { return; }
        var la = 0x7FFFFFFF;
        var lo = 0x7FFFFFFF;
        if (hub.hasGps()) {
            la = (hub.lat * 1000000.0d).toNumber();
            lo = (hub.lon * 1000000.0d).toNumber();
            _gpsSeen = true;
        }
        var al = hub.alt == null ? 0 : Util.clamp(Util.round(hub.alt) + 500, 0, 65535);
        var r = [la & 0xFF, (la >> 8) & 0xFF, (la >> 16) & 0xFF, (la >> 24) & 0xFF,
            lo & 0xFF, (lo >> 8) & 0xFF, (lo >> 16) & 0xFF, (lo >> 24) & 0xFF, al & 0xFF, (al >> 8) & 0xFF]b;
        _gStore.add(r);
    }

    // ------------------------------------------------------------------ lapy
    //! Zamyka bieżące okrążenie (FIT) i zaczyna nowe o podanym celu / rodzaju.
    hidden function closeLap(nextTarget as Number, nextType as Number, beep as Boolean) as Void {
        if (eng == null) { return; }
        if (_replaying) { beep = false; } else { rec.lap(_lapTarget, _lapType); }
        prevLap = {
            "no" => lapNo, "sec" => lapN, "avgP" => (lapN > 0 ? Util.round(lapSumP.toFloat() / lapN) : 0),
            "avgHr" => (lapHrN > 0 ? Util.round(lapSumHr.toFloat() / lapHrN) : 0), "dist" => dist - lapStartDist, "type" => _lapType
        };
        lapNo++;
        lapStartS = eng.s + 1;
        lapSumP = 0; lapN = 0; lapSumHr = 0; lapHrN = 0; lapMaxP = 0;
        lapStartDist = dist;
        _lapTarget = nextTarget;
        _lapType = nextType;
        _autoLapDist = dist;
        _autoLapSec = eng.s;
        if (beep) { tone("lap"); }
    }

    //! Przycisk Lap: w planie = następny krok (jak w treningach Garmina; w czekaniu „start teraz”),
    //! w jeździe swobodnej = zwykłe okrążenie.
    function lapButton() as Void {
        if (state != RideState.RECORDING || eng == null) { return; }
        if (eng.phase != Phase.FREE) {
            eng.skipStep();
        } else {
            closeLap(0, StepType.FREE, true);
            showBanner("Okrążenie " + (lapNo - 1) + "\n" + Util.clock(prevLap["sec"]) + ", " + prevLap["avgP"] + " W", "lap", 6);
        }
    }

    //! Czy jedziemy teraz pod górę. Z trasą GPX podjazdy są znane z góry (start i szczyt co do metra); bez niej
    //! decyduje wysokościomierz: start = co najmniej 12 m i 3% na ostatnich 150–400 m, koniec = 8 m poniżej
    //! najwyższego punktu albo wypłaszczenie poniżej 1% na ostatnich 150 m.
    hidden function climbTick() as Boolean {
        if (nav != null && nav.enabled && nav.acquired && !nav.offRoute && nav.course.climbs.size() > 0) {
            var nc = nav.nextClimb();
            var on = nc != null && nc[1] == 0;
            if (on && !climbing) {
                var cl = nav.course.climbs[nc[0]];
                _climbBase = 0.0; _climbTop = cl[2].toFloat();
            }
            climbing = on;
            return climbing;
        }
        var a = hub.alt;
        if (a == null || eng.s % 5 != 0) { return climbing; }
        _cdD.add(dist); _cdA.add(a.toFloat());
        if (_cdD.size() > 30) { _cdD = _cdD.slice(1, null); _cdA = _cdA.slice(1, null); }
        var last = _cdD.size() - 1;
        if (!climbing) {
            var j = last;
            while (j > 0 && dist - _cdD[j - 1] <= 400) { j--; }
            var span = dist - _cdD[j];
            var gain = a - _cdA[j];
            if (span >= 150 && gain >= 12 && gain >= span * 0.03) { climbing = true; _climbBase = _cdA[j]; _climbTop = a.toFloat(); }
        } else {
            if (a > _climbTop) { _climbTop = a.toFloat(); }
            // szczyt: krótsze okno (ok. 150 m), żeby lap nie ciągnął się długo po wypłaszczeniu
            var k = last;
            while (k > 0 && dist - _cdD[k - 1] <= 150) { k--; }
            var spanE = dist - _cdD[k];
            if (_climbTop - a >= 8 || (spanE >= 100 && a - _cdA[k] < spanE * 0.01)) { climbing = false; }
        }
        return climbing;
    }

    //! Auto-lap w jeździe swobodnej (i po planie): dystans, czas albo „wysiłki” – lap na początku i końcu mocnego odcinka
    //! oraz na początku i na szczycie podjazdu.
    hidden function autoLapTick(pw as Number) as Void {
        if (eng.phase != Phase.FREE || Cfg.autoLapMode == 0) { return; }
        if (Cfg.autoLapMode == 1) {
            if (dist - _autoLapDist >= Cfg.autoLapKm * 1000.0) { autoLap("Auto lap " + Cfg.autoLapKm + " km"); }
        } else if (Cfg.autoLapMode == 2) {
            if (eng.s - _autoLapSec >= Cfg.autoLapMin * 60) { autoLap("Auto lap " + Cfg.autoLapMin + " min"); }
        } else if (eng.s >= 30) {
            var ftp = wk.ftp;
            var uphill = climbTick();
            if (!_fast) {
                if (uphill && lapN >= 20) { _fast = true; _segClimb = true; _slowRun = 0; autoLap("Podjazd - start"); }
                else if (lapN >= 30 && eng.hist.avgP(10) >= ftp * 0.9) { _fast = true; _segClimb = false; _slowRun = 0; autoLap("Wysiłek - start"); }
            } else {
                if (uphill) { _segClimb = true; }
                _slowRun = eng.hist.avgP(30) < ftp * 0.72 ? _slowRun + 1 : 0;
                if (_segClimb) {
                    // podjazd trzyma lap otwarty także przy spokojnej mocy; koniec lapa = szczyt
                    if (!uphill) { _fast = false; _segClimb = false; autoLap("Szczyt, +" + Util.round(_climbTop - _climbBase) + " m"); }
                } else if (_slowRun >= 20) { _fast = false; autoLap("Wysiłek - koniec"); }
            }
        }
    }

    hidden function autoLap(label as String) as Void {
        closeLap(0, StepType.FREE, true);
        showBanner(label + "\n" + Util.clock(prevLap["sec"]) + ", " + prevLap["avgP"] + " W", "lap", 5);
    }

    // ------------------------------------------------------------------ przerwana jazda: punkt kontrolny i wznowienie
    //! Zapis do pamięci licznika: próbki 5 s i ślad GPS (te same bloki, które idą potem do VeloIQ) + stan liczników.
    //! Wołany co minutę jazdy, przy pauzie i przy zamykaniu aplikacji. Brak miejsca = jazda trwa dalej bez punktu.
    function checkpoint() as Void {
        if (eng == null || _sStore == null || _replaying) { return; }
        try {
            var nb = _sStore.blockCount();
            for (var i = _ckS; i < nb; i++) { Application.Storage.setValue("ck_s" + i, Util.b64(_sStore.block(i))); }
            _ckS = nb > 0 ? nb - 1 : 0;       // ostatni, niepełny blok zapisujemy następnym razem ponownie
            var gb = _gpsSeen ? _gStore.blockCount() : 0;
            for (var j = _ckG; j < gb; j++) { Application.Storage.setValue("ck_g" + j, Util.b64(_gStore.block(j))); }
            _ckG = gb > 0 ? gb - 1 : 0;
            Application.Storage.setValue("ck", { "t" => startEpoch, "s" => eng.s + 1, "ns" => _sStore.count, "nb" => nb, "gb" => gb,
                "d" => dist, "a" => ascent, "free" => (wk.isFree() ? 1 : 0), "name" => wk.name, "at" => Time.now().value(),
                "fe" => choEat, "fd" => drinks });
        } catch (ex) {
            // pamięć pełna – nic więcej nie zrobimy; nagranie FIT i jazda trwają normalnie
        }
    }

    function clearCheckpoint() as Void {
        var ck = Application.Storage.getValue("ck") as Dictionary?;
        var nb = 0;
        var gb = 0;
        if (ck != null && ck instanceof Dictionary) { nb = Util.int(ck.get("nb"), 0); gb = Util.int(ck.get("gb"), 0); }
        for (var i = 0; i <= nb; i++) { Application.Storage.deleteValue("ck_s" + i); }
        for (var j = 0; j <= gb; j++) { Application.Storage.deleteValue("ck_g" + j); }
        Application.Storage.deleteValue("ck");
        Application.Storage.deleteValue("ck_wk");
        interrupted = null;
    }

    //! Po uruchomieniu aplikacji: czy została jazda przerwana wyłączeniem licznika albo awarią.
    //! Świeża (do 12 h) czeka na decyzję na ekranie startowym; starsza jest domykana i wysyłana od razu.
    function detectInterrupted() as Void {
        interrupted = null;
        var ck = Application.Storage.getValue("ck") as Dictionary?;
        if (ck == null || !(ck instanceof Dictionary)) { return; }
        if (Util.int(ck.get("ns"), 0) < 12) { clearCheckpoint(); return; }       // mniej niż minuta – nie ma czego ratować
        interrupted = ck;
        if (Time.now().value() - Util.int(ck.get("at"), 0) > 12 * 3600) { resumeInterrupted(true); }
    }

    //! Odtwarza przerwaną jazdę z punktu kontrolnego: silnik dostaje zapisane próbki (po 5 s), więc krok planu,
    //! serie, NP i TSS wracają do stanu sprzed przerwy. finalize = true → bez dalszej jazdy: zakończ i wyślij.
    function resumeInterrupted(finalize as Boolean) as Boolean {
        var ck = interrupted;
        if (ck == null || resumePct >= 0 || active()) { return false; }
        var w = null;
        if (Util.int(ck.get("free"), 1) == 0) { w = Workout.fromDict(Application.Storage.getValue("ck_wk"), Cfg.ftp, Cfg.weightKg); }
        if (w == null) {
            w = new Workout();
            w.ftp = Cfg.ftp;
            w.weightKg = Cfg.weightKg;
        }
        wk = w;
        eng = new Engine(wk, Cfg.wPrime);
        eng.listener = self;
        nav = null;
        _replaying = true;
        initRide();
        startEpoch = Util.int(ck.get("t"), Time.now().value());
        dist = Util.num(ck.get("d"), 0.0).toFloat();
        ascent = Util.int(ck.get("a"), 0);
        choEat = Util.int(ck.get("fe"), 0);
        drinks = Util.int(ck.get("fd"), 0);
        _distBase = dist;
        _ascBase = ascent;
        // ślad GPS wraca w całości od razu (same bajty), próbki mocy przechodzą przez silnik partiami
        var gb = Util.int(ck.get("gb"), 0);
        for (var j = 0; j < gb; j++) {
            var gs = Application.Storage.getValue("ck_g" + j);
            if (gs == null || !(gs instanceof String)) { break; }
            var g = Util.unb64(gs);
            for (var k = 0; k + 10 <= g.size(); k += 10) { _gStore.add(g.slice(k, k + 10)); }
            _gpsSeen = true;
        }
        _rp = { "b" => 0, "i" => 0, "nb" => Util.int(ck.get("nb"), 0), "ns" => Util.max(1, Util.int(ck.get("ns"), 1)), "done" => 0, "fin" => finalize, "cur" => null };
        resumePct = 0;
        if (replayAuto) {
            _rpTimer = new Timer.Timer();
            _rpTimer.start(method(:onReplay), 100, true);
        }
        return true;
    }

    //! Jedna partia odtwarzania: do 60 próbek (5 minut jazdy) na wywołanie – zegar licznika ma limit czasu wykonania.
    function onReplay() as Void {
        if (_rp == null) { return; }
        var budget = 60;
        while (budget > 0) {
            var cur = _rp["cur"];
            if (cur == null) {
                var s = _rp["b"] < _rp["nb"] ? Application.Storage.getValue("ck_s" + _rp["b"]) : null;
                if (s == null || !(s instanceof String)) { finishReplay(); return; }
                cur = Util.unb64(s);
                _rp["cur"] = cur;
                _rp["i"] = 0;
            }
            var o = _rp["i"] * 4;
            if (o + 4 > cur.size()) { _rp["cur"] = null; _rp["b"] = _rp["b"] + 1; continue; }
            var p = cur[o] | (cur[o + 1] << 8);
            var h = cur[o + 2] == 0 ? null : cur[o + 2];
            var c = cur[o + 3] == 255 ? null : cur[o + 3];
            _sStore.add(cur.slice(o, o + 4));
            for (var k = 0; k < 5; k++) {
                eng.tick(p, h, c);
                accum(p);
                lapN++; lapSumP += p;
                if (p > lapMaxP) { lapMaxP = p; }
                if (h != null) { lapSumHr += h; lapHrN++; }
            }
            _rp["i"] = _rp["i"] + 1;
            _rp["done"] = _rp["done"] + 1;
            budget--;
        }
        resumePct = Util.clamp(_rp["done"] * 100 / _rp["ns"], 0, 99);
        WatchUi.requestUpdate();
    }

    hidden function finishReplay() as Void {
        var finalize = _rp["fin"];
        if (_rpTimer != null) { _rpTimer.stop(); _rpTimer = null; }
        _rp = null;
        _replaying = false;
        resumePct = -1;
        interrupted = null;
        _ckS = 0; _ckG = 0;
        lapStartDist = dist;
        _autoLapDist = dist;
        _autoLapSec = eng.s;
        if (finalize) {
            // bez dalszej jazdy: podsumowanie i wysyłka tego, co było w punkcie kontrolnym (plik FIT zapisano przy zamykaniu)
            state = RideState.PAUSED;
            finish(true);
            saved = true;
            WatchUi.requestUpdate();
            return;
        }
        if (recordFit && !rec.start(wk.isFree() ? "VeloIQ" : wk.name, Cfg.indoor)) {
            showBanner("Nie mogę rozpocząć nagrywania", "error", 6);
        }
        rec.pause();                    // nagrywanie rusza dopiero po „Wznów”
        if (course != null && Cfg.navOn && !Cfg.indoor) {
            nav = new Nav(course);
            nav.owner = self;
        }
        state = RideState.PAUSED;
        showBanner("Jazda wznowiona\n" + Util.clock(eng.s + 1) + " odtworzone", "info", 6);
        var sm = startMsg(false);
        sm.put("resumed", 1);
        link.event(sm);
        WatchUi.requestUpdate();
    }

    // ------------------------------------------------------------------ nawigacja po trasie
    hidden function navTick() as Void {
        if (hub.lat == null || hub.lon == null) { return; }
        if (!hub.simulated && !hub.hasGps()) { return; }
        if (startLat == null) { startLat = hub.lat; startLon = hub.lon; }
        if (nav == null) { return; }
        nav.update(hub.lat, hub.lon, speed == null ? null : speed * 3.6, eng.s);
    }

    //! Nowa trasa z planera w telefonie: pobierz od razu. W trakcie jazdy wchodzi zamiast obecnej (jak powrót na trasę).
    function courseNow() as Void {
        if (!Cfg.paired()) { return; }
        if (active()) { _reroute = true; showBanner("Pobieram nową trasę...", "nav", 5); }
        courseNote = "Pobieram trasę...";
        api.get("/api/garmin/course/part", { "i" => "meta" }, method(:onCourseMeta));
    }

    // ------------------------------------------------------------------ powrót na trasę / do startu (serwer VeloIQ)
    //! to = "start" (miejsce startu jazdy) albo "rejoin" (najbliższy sensowny punkt trasy przed nami + reszta trasy).
    //! Serwer wyznacza dojazd profilem trasy (szosa / gravel / MTB) i podmienia trasę; licznik pobiera ją jak zwykle.
    hidden var _rq as String = "";     // „place”: nazwa miejsca, „poi”: rodzaj punktu

    function reroute(to as String) as Void {
        if (!active()) { return; }
        if (!Cfg.paired()) { showBanner("Sparuj licznik z VeloIQ,\nżeby wyznaczać trasy", "error", 5); return; }
        if (hub.lat == null || hub.lon == null || (!hub.simulated && !hub.hasGps())) { showBanner("Czekam na GPS", "error", 4); return; }
        if (to.equals("rejoin") && nav == null) { to = "start"; }
        var label = to.equals("start") ? "do startu" : (to.equals("rejoin") ? "powrót na trasę" : (to.equals("poi") ? "do najbliższego punktu" : "do celu"));
        if (to.equals("start") && startLat == null) { showBanner("Nie znam miejsca startu", "error", 4); return; }
        var body = { "to" => to, "lat" => hub.lat, "lon" => hub.lon } as Dictionary;
        if (to.equals("place")) { body.put("q", _rq); }
        if (to.equals("poi")) { body.put("kind", _rq); }
        if (startLat != null) { body.put("sLat", startLat); body.put("sLon", startLon); }
        if (nav != null) { body.put("prog", nav.progress.toNumber()); body.put("prof", nav.course.prof); }
        showBanner("Wyznaczam trasę\n" + label + "...", "nav", 8);
        api.post("/api/garmin/route", body, method(:onReroute));
    }

    function onReroute(code as Number, data) as Void {
        if (code != 200 || data == null || !(data instanceof Dictionary)) {
            var msg = (data instanceof Dictionary && data.get("message") != null) ? data.get("message").toString() : Api.errorText(code);
            showBanner("Trasa: " + msg, "error", 6);
            link.event({ "t" => "cue", "k" => "navReroute", "kind" => "nav", "x" => "Nie udało się wyznaczyć trasy. " + msg, "v" => { "say" => msg } });
            return;
        }
        var say = Util.str(data.get("say"), "Nowa trasa gotowa.");
        link.event({ "t" => "cue", "k" => "navReroute", "kind" => "nav", "x" => say, "v" => { "say" => say } });
        if (data.get("keep") == true) { showBanner(say, "nav", 8); tone("msg"); return; }   // punkt jest na obecnej trasie
        _reroute = true;
        onCourseMeta(200, data);
    }

    //! Zdarzenie nawigacji: baner na liczniku + ten sam klucz do telefonu (głos Enzo ma nagrania skrętów i podjazdów).
    function onNav(key, vars) as Void {
        var text = Phrases.nav(key, vars);
        if (text != null) {
            showBanner(text, key.equals("navOff") ? "error" : "nav", key.equals("navTurn") ? 6 : 8);
            if (cues.size() >= 12) { cues = cues.slice(1, null); }
            cues.add([eng == null ? 0 : eng.s, "nav", text]);
            if (key.equals("navTurn")) { tone(Util.int(vars.get("m"), 0) > 0 ? "msg" : "go"); }
            else if (key.equals("navOff")) { tone("error"); }
            else if (key.equals("navBack") || key.equals("navTop") || key.equals("navDone")) { tone("good"); }
            else { tone("msg"); }
        }
        link.event({ "t" => "cue", "k" => key, "kind" => "nav", "x" => (text == null ? "" : text), "v" => vars });
    }

    //! Włączenie / wyłączenie nawigacji w trakcie jazdy (menu).
    function setNav(on as Boolean) as Void {
        if (nav != null) { nav.setEnabled(on); }
    }

    //! Podjazd z trasy, na którym teraz jesteśmy, jeśli ma cel mocy (strategia wyścigu):
    //! [cel↓, cel↑, metry do szczytu, numer, liczba podjazdów, taktyka] albo null.
    function climbNow() {
        if (nav == null || !nav.enabled || !nav.acquired || nav.offRoute) { return null; }
        var nc = nav.nextClimb();
        if (nc == null || nc[1] > 0) { return null; }
        var cl = nav.course.climbs[nc[0]];
        if (cl[4] <= 0 || cl[5] <= 0) { return null; }
        return [cl[4], cl[5], nc[2], nc[0] + 1, nav.course.climbs.size(), cl[6]];
    }

    // ------------------------------------------------------------------ zdarzenia silnika
    function onCue(kind, key, text, vars) as Void {
        if (_replaying) { return; }     // odtwarzanie przerwanej jazdy: bez banerów, dźwięków i głosu
        var secs = 6;
        if (kind.equals("countdown")) { secs = 2; }
        else if (kind.equals("summary")) { secs = 10; }
        else if (kind.equals("arm")) { secs = 8; }
        else if (kind.equals("praise")) { secs = 4; }
        showBanner(text, kind, secs);
        if (!key.equals("count") && !key.equals("endCount")) {
            if (cues.size() >= 12) { cues = cues.slice(1, null); }
            cues.add([eng == null ? 0 : eng.s, kind, text]);
        }
        cueTone(kind, key, vars);
        // odliczanie 3-2-1: telefon dostaje tylko „3” i resztę odlicza sam (radio ma za duże opóźnienia na 1 Hz)
        var skip = key.equals("endCount") || (key.equals("count") && Util.int(vars.get("n"), 0) != 3);
        if (!skip) {
            link.event({ "t" => "cue", "k" => key, "kind" => kind, "x" => text, "v" => vars });
        }
    }

    function onStepLap(idx) as Void {
        var st = wk.steps[idx];
        closeLap((st.lo + st.hi) / 2, st.type, false);
    }

    function onPlanDone() as Void {
        closeLap(0, StepType.FREE, false);
        _fast = false; _slowRun = 0;
    }

    function onFalseStart() as Void {
        var st = eng.step();
        if (st != null) { closeLap((st.lo + st.hi) / 2, st.type, false); }
    }

    function onSeries(res) as Void {}

    function onEffort(on, e) as Void {}

    function showBanner(text as String, kind as String, secs as Number) as Void {
        banner = text;
        bannerKind = kind;
        _bannerUntil = System.getTimer() + secs * 1000;
    }

    // ------------------------------------------------------------------ dźwięki
    hidden function cueTone(kind, key, vars) as Void {
        if (kind.equals("countdown")) {
            if (key.equals("goNow")) { tone("go"); } else { tone("tick"); }
        } else if (kind.equals("step")) { tone("go"); }
        else if (kind.equals("correction")) { tone(key.equals("tooLow") ? "low" : "high"); }
        else if (kind.equals("praise")) { tone("good"); }
        else if (kind.equals("summary")) { tone("lap"); }
        else if (kind.equals("pause")) { tone("stop"); }
        else if (kind.equals("effort")) { tone("lap"); }
        else { tone("msg"); }
    }

    function tone(name as String) as Void {
        if (quiet || !Cfg.tones || !(Attention has :playTone)) { return; }
        var t = Attention.TONE_MSG;
        if (name.equals("start")) { t = Attention.TONE_START; }
        else if (name.equals("stop")) { t = Attention.TONE_STOP; }
        else if (name.equals("go")) { t = Attention.TONE_INTERVAL_ALERT; }
        else if (name.equals("tick")) { t = Attention.TONE_KEY; }
        else if (name.equals("high")) { t = Attention.TONE_ALERT_HI; }
        else if (name.equals("low")) { t = Attention.TONE_ALERT_LO; }
        else if (name.equals("good")) { t = Attention.TONE_SUCCESS; }
        else if (name.equals("lap")) { t = Attention.TONE_LAP; }
        else if (name.equals("save")) { t = Attention.TONE_SUCCESS; }
        else if (name.equals("error")) { t = Attention.TONE_FAILURE; }
        Attention.playTone(t);
    }

    // ------------------------------------------------------------------ Enzo
    //! Stan jazdy dla trenera (te same pola co w telefonie: /api/ride/ask).
    function coachState() {
        var d = {} as Dictionary;
        if (eng == null) { return d; }
        var m = eng.m;
        d.put("workout", wk.name);
        d.put("ftp", wk.ftp);
        d.put("elapsedSec", eng.s + 1);
        // paliwo i rezerwa (pytania „co zjeść?”, „dam radę?”) oraz korekta planu głosem
        d.put("carbsEatenG", choEat);
        d.put("carbsBurnedG", Util.round(choBurn));
        d.put("drinks", drinks);
        d.put("wBalPct", m.wBalPct());
        if (eng.bias != 0) { d.put("targetBiasPct", eng.bias); }
        d.put("phase", Phase.key(eng.phase));
        d.put("power3s", Util.round(eng.hist.avgP(3)));
        d.put("power30s", Util.round(eng.hist.avgP(30)));
        d.put("avgPowerRide", m.avgPower());
        d.put("np", m.np());
        d.put("tss", m.tss());
        d.put("wbalPct", m.wBalPct());
        if (hub.hr != null) { d.put("hr", hub.hr); }
        if (hub.cad != null) { d.put("cadence", hub.cad); }
        d.put("kJ", m.kJ());
        if (!Cfg.indoor) {
            d.put("distanceKm", Util.round(dist / 100.0) / 10.0);
            d.put("speedKmh", speed == null ? 0 : Util.round(speed * 3.6));
        }
        d.put("sinceEatSec", eng.s - eng.lastEat);
        d.put("sinceDrinkSec", eng.s - eng.lastDrink);
        var st = eng.step();
        d.put("falseStartLeft", eng.falseStartLeft());
        var ivLeft = 0;
        for (var k = eng.stepIdx + 1; k < wk.steps.size(); k++) { if (wk.steps[k].type == StepType.INTERVAL) { ivLeft++; } }
        d.put("intervalsLeft", eng.phase == Phase.FREE ? 0 : ivLeft);
        d.put("inInterval", eng.phase != Phase.FREE && st != null && st.type == StepType.INTERVAL);
        if (st != null) {
            var sd = {} as Dictionary;
            sd.put("name", st.name);
            sd.put("type", StepType.key(st.type));
            if (st.type == StepType.INTERVAL) {
                sd.put("intervalNo", eng.intervalNo(eng.stepIdx));
                sd.put("intervalCount", eng.intervalCount);
            }
            sd.put("targetLow", st.lo);
            sd.put("targetHigh", st.hi);
            sd.put("avgPower", eng.stepAvgPower());
            sd.put("elapsedSec", eng.inStep);
            sd.put("remainingSec", eng.stepRemaining());
            sd.put("durationSec", st.dur);
            if (st.hrHi > 0) { sd.put("hrHigh", st.hrHi); }
            if (st.hrLo > 0) { sd.put("hrLow", st.hrLo); }
            d.put("step", sd);
            var nx = eng.nextStep();
            if (nx != null) {
                var nd = { "name" => nx.name, "type" => StepType.key(nx.type), "durationSec" => nx.dur, "targetLow" => nx.lo, "targetHigh" => nx.hi };
                if (nx.type == StepType.INTERVAL) { nd.put("intervalNo", eng.intervalNo(eng.stepIdx + 1)); nd.put("intervalCount", eng.intervalCount); }
                d.put("nextStep", nd);
            }
            d.put("planRemainingSec", eng.planLeftSec());
        }
        if (eng.series.size() > 0) {
            var ser = [];
            var from = eng.series.size() > 8 ? eng.series.size() - 8 : 0;
            for (var i = from; i < eng.series.size(); i++) {
                var r = eng.series[i];
                ser.add({ "n" => r["n"], "avgPower" => r["avgPower"], "verdict" => r["verdict"], "durationSec" => r["durationSec"] });
            }
            d.put("series", ser);
        }
        if (nav != null && nav.enabled) { d.put("route", nav.state()); }
        if (wk.readiness != null) { d.put("readiness", Util.round(wk.readiness)); d.put("readyState", wk.readyState); }
        if (wk.recovery != null) { d.put("recovery", Util.round(wk.recovery)); }
        return d;
    }

    //! Pytanie do Enzo z licznika (tekst odpowiedzi wraca na ekran).
    function askEnzo(question as String) as Void {
        if (!Cfg.paired()) { showBanner("Najpierw sparuj licznik\nz kontem VeloIQ", "error", 6); return; }
        if (enzoBusy) { return; }
        enzoBusy = true;
        enzoText = null;
        api.post("/api/garmin/ask", { "question" => question, "state" => coachState() }, method(:onEnzo));
    }

    function onEnzo(code as Number, data) as Void {
        enzoBusy = false;
        if (code != 200 || data == null || data.get("say") == null) {
            showBanner("Enzo niedostępny\n" + Api.errorText(code), "error", 6);
            tone("error");
            return;
        }
        showEnzo(data.get("say").toString());
        var act = data.get("action");
        if (act != null) { onPhoneCommand(act.toString()); }
    }

    function showEnzo(text as String) as Void {
        enzoText = text;
        _enzoUntil = System.getTimer() + 20000;
        if (cues.size() >= 12) { cues = cues.slice(1, null); }
        cues.add([eng == null ? 0 : eng.s, "enzo", text]);
        tone("msg");
    }

    function dismissEnzo() as Void { enzoText = null; }

    //! Przycisk Enzo, gdy działa most do telefonu: telefon włącza mikrofon słuchawek i odpowiada głosem.
    function talkToPhone() as Void {
        link.event(withAuth({ "t" => "talk", "st" => coachState() }));
        showBanner("Enzo słucha\nmów teraz", "enzo", 5);
        tone("msg");
    }

    //! Gotowe pytanie bez słuchania (np. raport po przytrzymaniu przycisku Flic) – telefon odpowiada głosem.
    function askPhone(question as String) as Void {
        link.event(withAuth({ "t" => "talk", "q" => question, "st" => coachState() }));
    }

    //! Dokłada token rozmowy z trenerem (z ostatniej synchronizacji) i adres serwera – dzięki temu telefon
    //! może pytać Enzo także wtedy, gdy trening nie był uruchamiany w telefonie.
    hidden function withAuth(m) {
        var tk = Application.Storage.getValue("rtk");
        if (tk != null && tk instanceof String && tk.length() > 0) {
            m.put("tk", tk);
            m.put("b", Cfg.apiBase);
        }
        return m;
    }

    function onPhoneHello(first as Boolean) as Void {
        if (first) { showBanner("Telefon połączony\nEnzo mówi w słuchawkach", "enzo", 6); }
        link.event(hiMsg());
        if (active()) { link.event(startMsg(true)); }
        // licznik bez konta VeloIQ: kod prosto do zalogowanej aplikacji w telefonie – bez przepisywania
        if (!Cfg.paired()) { pairing.start(true); }
    }

    //! Odpowiedź na powitanie telefonu: wersja aplikacji, czy trwa jazda, czy licznik ma konto VeloIQ.
    function hiMsg() {
        return { "t" => "hi", "v" => Cfg.VERSION, "rec" => (active() ? 1 : 0), "acct" => (Cfg.paired() ? 1 : 0), "who" => Cfg.athlete };
    }

    //! Licznik połączony z kontem (przez telefon albo kodem): sygnał, plan z VeloIQ, telefon wie, że konto jest.
    function onPaired() as Void {
        tone("good");
        if (!quiet && (Attention has :vibrate)) { Attention.vibrate([new Attention.VibeProfile(50, 200)]); }
        link.event(hiMsg());
        sync(null);
        WatchUi.requestUpdate();
    }

    //! Sekunda jazdy dla telefonu. pauseFlag: 0 jazda, 1 pauza ręczna, 2 postój (auto-pauza).
    function liveVec(pauseFlag as Number) {
        var p = hub.power;
        var h = hub.hr;
        var c = hub.cad;
        var st = eng.step();
        return [eng.s, p == null ? -1 : p, h == null ? 0 : h, c == null ? -1 : c, speed == null ? -1 : Util.round(speed * 36),
            eng.phase, eng.stepIdx, eng.stepRemaining(), st == null ? 0 : st.lo, st == null ? 0 : st.hi, pauseFlag,
            Util.round(eng.hist.avgP(3)), eng.stepAvgPower(), eng.falseStartLeft(), eng.overrunSec(), Util.round(dist), eng.inStep];
    }

    //! Start jazdy dla telefonu: tu jest cały plan (kroki), żeby telefon pokazał tę samą sesję co licznik.
    //! sync = odpowiedź na prośbę telefonu (aplikacja otwarta w trakcie jazdy) – telefon nie zeruje komunikatów.
    function startMsg(sync as Boolean) {
        var steps = [];
        if (wk != null) {
            var n = wk.steps.size() > 40 ? 40 : wk.steps.size();
            for (var i = 0; i < n; i++) {
                var x = wk.steps[i];
                steps.add([x.type, x.dur, x.lo, x.hi, x.cadLo, x.cadHi, x.name]);
            }
        }
        var m = withAuth({ "t" => "state", "s" => "start", "k" => startEpoch, "w" => (wk == null ? "VeloIQ" : wk.name),
            "id" => (wk == null ? "free" : wk.id), "ftp" => (wk == null ? Cfg.ftp : wk.ftp),
            "free" => (wk == null || wk.isFree() ? 1 : 0), "in" => (Cfg.indoor ? 1 : 0), "st" => steps,
            "el" => (eng == null ? 0 : eng.s + 1), "p" => (state == RideState.PAUSED ? 1 : (state == RideState.AUTOPAUSED ? 2 : 0)) });
        if (sync) { m.put("sync", 1); }
        return m;
    }

    // ------------------------------------------------------------------ telefon → licznik
    function onPhoneCommand(cmd as String) as Void {
        if (cmd.equals("next")) { if (eng != null && state == RideState.RECORDING) { eng.skipStep(); } }
        else if (cmd.equals("pause")) { pause(); }
        else if (cmd.equals("resume")) { resume(); }
        else if (cmd.equals("cancel")) { if (eng != null) { eng.cancelStart(); } }
        else if (cmd.equals("lap")) { lapButton(); }
        else if (cmd.equals("eat")) { fuel(25); }
        else if (cmd.equals("drink")) { fuel(0); }
        else if (cmd.find("eat:") == 0) { fuel(Util.clamp(Util.int(cmd.substring(4, cmd.length()).toNumber(), 25), 5, 120)); }
        else if (cmd.equals("talk")) { if (eng != null) { talkToPhone(); } }
        else if (cmd.equals("report")) { if (eng != null) { askPhone("raport"); } }
        else if (cmd.equals("pair")) { pairing.start(true); }
        else if (cmd.equals("sync")) { link.event(active() ? startMsg(true) : { "t" => "state", "s" => "idle" }); }
        else if (cmd.equals("resync")) { courseNow(); }
        else if (cmd.equals("route:start")) { reroute("start"); }
        else if (cmd.equals("route:rejoin")) { reroute("rejoin"); }
        else if (cmd.find("route:place:") == 0) { _rq = cmd.substring(12, cmd.length()); reroute("place"); }
        else if (cmd.find("route:poi:") == 0) { _rq = cmd.substring(10, cmd.length()); reroute("poi"); }
        else if (cmd.equals("state")) { if (eng != null && active()) { link.event({ "t" => "st", "st" => coachState() }); } }
        else if (cmd.find(":") != null) { planEdit(cmd); }
        else if (cmd.equals("repeat")) { planEdit(cmd); }
    }

    //! Zmiana planu w trakcie jazdy (głos przez telefon albo menu „Zmień plan”):
    //!   extend:SEK (ujemne = skróć), bias:PROC (0 = plan), repeat, page:ID.
    //! Telefon dostaje odświeżony plan (start z sync=1), żeby wykres i Enzo znały zmiany.
    function planEdit(cmd as String) as Void {
        var i = cmd.find(":");
        var verb = i == null ? cmd : cmd.substring(0, i);
        var argS = i == null ? "" : cmd.substring(i + 1, cmd.length());
        var plus = argS.length() > 0 && argS.substring(0, 1).equals("+");
        if (plus) { argS = argS.substring(1, argS.length()); }
        var arg = Util.int(argS.toNumber(), 0);
        if (verb.equals("page")) {
            showPageById(argS);
            return;
        }
        if (eng == null || !active()) { return; }
        var msg = null;
        if (verb.equals("extend")) {
            var d = eng.extendStep(arg);
            if (d != 0) { msg = (d > 0 ? "Krok dłuższy o " : "Krok krótszy o ") + Util.durShort(d > 0 ? d : -d); }
            else { msg = eng.phase == Phase.FREE ? "Plan zakończony" : null; }
        } else if (verb.equals("bias")) {
            var b = arg;
            if (plus || arg < 0) { b = eng.bias + arg; }      // „+5” / „-5” względem obecnej korekty, „0” / „10” – wprost
            eng.setBias(b);
            msg = eng.bias == 0 ? "Cele mocy jak w planie" : "Cele mocy " + (eng.bias > 0 ? "+" : "") + eng.bias + "%";
            var st = eng.step();
            if (st != null && st.type != StepType.RECOVERY && st.type != StepType.COOLDOWN) { msg = msg + "\nteraz " + st.lo + "-" + st.hi + " W"; }
        } else if (verb.equals("repeat")) {
            msg = eng.repeatInterval() ? "Dodany interwał\nrazem " + eng.intervalCount : "Nie ma czego powtórzyć";
        }
        if (msg != null) { showBanner(msg, "info", 5); tone("msg"); }
        if (link.active) { link.event(startMsg(true)); }
        WatchUi.requestUpdate();
    }

    function onPhoneSay(text as String) as Void {
        showEnzo(text);
    }

    // ------------------------------------------------------------------ podsumowanie do wysyłki
    hidden function buildSummary() {
        var m = eng.m;
        var d = {} as Dictionary;
        d.put("startedAt", startEpoch);
        d.put("durationSec", m.n);
        d.put("elapsedSec", Time.now().value() - startEpoch);
        d.put("avgPower", m.avgPower());
        d.put("maxPower", m.maxP);
        d.put("np", m.np());
        d.put("tss", m.tss());
        d.put("kJ", m.kJ());
        d.put("avgHr", m.avgHr());
        d.put("maxHr", m.maxHr);
        d.put("avgCad", m.avgCad());
        d.put("compliancePct", eng.compliancePct());
        d.put("seriesCount", eng.series.size());
        d.put("ftp", wk.ftp);
        d.put("outdoor", Cfg.indoor ? 0 : 1);
        d.put("distanceM", Util.round(dist));
        d.put("ascentM", ascent);
        d.put("workoutId", wk.id);
        d.put("workoutName", wk.name);
        d.put("workoutType", wk.type);
        d.put("best", m.best);
        d.put("zones", m.zones);
        d.put("wbalMinPct", Util.round(m.wBalMin * 100.0 / m.wPrime));
        d.put("samplePeriod", 5);
        d.put("gpsPeriod", 10);
        d.put("device", System.getDeviceSettings().partNumber);
        d.put("app", Cfg.VERSION);
        return d;
    }

    //! Serie, lapy, wysiłki i kroki planu – osobno, żeby nie przekroczyć rozmiaru jednej wartości w pamięci licznika.
    hidden function buildExtra() {
        var d = {} as Dictionary;
        var ser = eng.series;
        d.put("series", ser.size() > 40 ? ser.slice(0, 40) : ser);
        var laps = eng.laps;
        d.put("laps", laps.size() > 80 ? laps.slice(0, 80) : laps);
        var eff = eng.allEfforts();
        d.put("efforts", eff.size() > 30 ? eff.slice(0, 30) : eff);
        var steps = [];
        for (var i = 0; i < wk.steps.size() && i < 120; i++) {
            var s = wk.steps[i];
            steps.add([s.name, s.type, s.dur, s.lo, s.hi, s.cadLo, s.cadHi, s.start, s.hrLo, s.hrHi]);
        }
        d.put("steps", steps);
        return d;
    }
}

//! Skrót: kontroler jazdy bieżącej aplikacji.
function getRide() {
    return (Application.getApp() as VeloIQApp).ride;
}
