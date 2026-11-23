import Toybox.Activity;
import Toybox.Application;
import Toybox.Attention;
import Toybox.Lang;
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

    var result = null;          // podsumowanie po zapisie
    var dbg as Boolean = false;
    var uiPage as Number = -1;  // prośba o przełączenie strony ekranu jazdy (tryb demo)
    var saved as Boolean = false;
    hidden var _timer = null;
    hidden var _tickNo as Number = 0;

    function initialize() {
        hub = new SensorHub();
        rec = new Recorder();
        api = new Api();
        up = new Uploader(api);
        link = new PhoneLink();
        cues = [];
        link.owner = self;
    }

    function boot() as Void {
        Cfg.load();
        Th.apply(Cfg.theme);
        hub.start(!Cfg.indoor);
        link.start();
        _timer = new Timer.Timer();
        _timer.start(method(:onTick), 1000, true);
        loadPlan();
        if (Cfg.paired()) { sync(null); } else { up.kick(); }   // po starcie: świeży plan z VeloIQ
        Demo.boot(self);
    }

    function shutdown() as Void {
        if (_timer != null) { _timer.stop(); _timer = null; }
        // aplikacja zamykana w trakcie jazdy (np. wyłączenie licznika) – zapisz to, co jest
        if (state == RideState.RECORDING || state == RideState.PAUSED || state == RideState.AUTOPAUSED) { finish(true); }
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
        Application.Storage.deleteValue("pick");     // po synchronizacji znów domyślnie trening na dziś
        Cfg.load();
        if (!active()) { loadPlan(); }
        up.kick();
        if (scr != null) { scr.flash(plan != null ? "Pobrano: " + Util.ellipsis(plan.name, 26) : "Zsynchronizowano, dziś bez treningu"); }
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
        if (free || plan == null) {
            var w = new Workout();
            w.ftp = Cfg.ftp;
            w.weightKg = Cfg.weightKg;
            wk = w;
        } else {
            wk = plan;
        }
        if (!rec.start(wk.isFree() ? "VeloIQ" : wk.name, Cfg.indoor)) {
            showBanner("Nie mogę rozpocząć nagrywania", "error", 6);
            return false;
        }
        eng = new Engine(wk, Cfg.wPrime);
        eng.listener = self;
        startEpoch = Time.now().value();
        dist = 0.0; ascent = 0; speed = null;
        lapNo = 1; lapStartS = 0; lapSumP = 0; lapN = 0; lapSumHr = 0; lapHrN = 0; lapMaxP = 0; lapStartDist = 0.0; prevLap = null;
        _lapTarget = wk.isFree() ? 0 : (wk.steps[0].lo + wk.steps[0].hi) / 2;
        _lapType = wk.isFree() ? StepType.FREE : wk.steps[0].type;
        _autoLapDist = 0.0; _autoLapSec = 0; _fast = false; _slowRun = 0;
        _sStore = new BlockStore(4, 2248);
        _gStore = new BlockStore(10, 2250);
        _dsSum = 0; _dsN = 0; _dsCad = 0; _dsCadN = 0; _gpsSeen = false;
        cues = []; banner = null; enzoText = null; enzoBusy = false;
        _stillRun = 0; _moveRun = 0;
        result = null; saved = false;
        state = RideState.RECORDING;
        tone("start");
        link.event({ "t" => "state", "s" => "start", "w" => wk.name, "ftp" => wk.ftp, "free" => (wk.isFree() ? 1 : 0) });
        return true;
    }

    function pause() as Void {
        if (state != RideState.RECORDING && state != RideState.AUTOPAUSED) { return; }
        rec.pause();
        state = RideState.PAUSED;
        tone("stop");
        link.event({ "t" => "state", "s" => "pause" });
    }

    function resume() as Void {
        if (state != RideState.PAUSED && state != RideState.AUTOPAUSED) { return; }
        rec.resume();
        state = RideState.RECORDING;
        _stillRun = 0; _moveRun = 0;
        tone("start");
        link.event({ "t" => "state", "s" => "resume" });
    }

    function togglePause() as Void {
        if (state == RideState.RECORDING || state == RideState.AUTOPAUSED) { pause(); }
        else if (state == RideState.PAUSED) { resume(); }
    }

    function active() as Boolean {
        return state == RideState.RECORDING || state == RideState.PAUSED || state == RideState.AUTOPAUSED;
    }

    //! Kończy jazdę. save = false → odrzuć (bez zapisu FIT i bez wysyłki).
    function finish(save as Boolean) as Void {
        if (!active() || eng == null) { return; }
        var m = eng.m;
        if (!save) {
            rec.discard();
            state = RideState.IDLE;
            eng = null;
            link.event({ "t" => "state", "s" => "end", "saved" => 0 });
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
        link.event({ "t" => "state", "s" => "end", "saved" => 1 });
    }

    //! Po ekranie podsumowania – powrót na ekran startowy.
    function reset() as Void {
        hub.simulated = false;
        state = RideState.IDLE;
        eng = null;
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
                if (ai.elapsedDistance != null) { dist = ai.elapsedDistance; }
                if (ai.totalAscent != null) { ascent = ai.totalAscent; }
                speed = ai.currentSpeed != null ? ai.currentSpeed : hub.speed;
            } else {
                speed = hub.speed;
            }
            if (!hub.simulated) { autoPauseTick(); }
        }
        if (state == RideState.RECORDING && !hub.simulated) { rideTick(); }
        if (state == RideState.IDLE && _tickNo % 60 == 0) { up.kick(); }   // ponawiaj zaległą wysyłkę
        Demo.tick(self);
        WatchUi.requestUpdate();
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
                link.event({ "t" => "state", "s" => "resume", "auto" => 1 });
            }
        } else {
            _stillRun = still ? _stillRun + 1 : 0;
            if (_stillRun >= 3) {
                rec.pause();
                state = RideState.AUTOPAUSED;
                _stillRun = 0; _moveRun = 0;
                link.event({ "t" => "state", "s" => "pause", "auto" => 1 });
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

    hidden function rideTick() as Void {
        var p = hub.power;
        var h = hub.hr;
        var c = hub.cad;
        if (dbg) { System.println("CP r0"); }
        eng.tick(p, h, c);
        if (dbg) { System.println("CP r1"); }
        var pw = p == null ? 0 : p;

        // okrążenie
        lapN++; lapSumP += pw;
        if (pw > lapMaxP) { lapMaxP = pw; }
        if (h != null && h > 0) { lapSumHr += h; lapHrN++; }

        // FIT: cel kroku i W'bal
        var st = eng.step();
        if (dbg) { System.println("CP r2"); }
        rec.record(st == null ? 0 : (st.lo + st.hi) / 2, eng.m.wBal / 1000.0);
        if (dbg) { System.println("CP r3"); }

        // próbka 5 s i GPS co 10 s (do wysyłki)
        _dsSum += pw; _dsN++;
        if (c != null && c >= 0) { _dsCad += c; _dsCadN++; }
        if (eng.s % 5 == 4) { flushSample(false); }
        if (eng.s % 10 == 0) { pushGps(); }

        autoLapTick(pw);
        if (dbg) { System.println("CP r4"); }

        // telefon: dane na żywo
        if (link != null && Cfg.phoneLink) {
            link.live([eng.s, pw, h == null ? 0 : h, c == null ? -1 : c, speed == null ? -1 : Util.round(speed * 36),
                eng.phase, eng.stepIdx, eng.stepRemaining(), st == null ? 0 : st.lo, st == null ? 0 : st.hi, 0]);
        }
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
        rec.lap(_lapTarget, _lapType);
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

    //! Auto-lap w jeździe swobodnej (i po planie): dystans, czas albo „wysiłki” – lap na początku i końcu mocnego odcinka.
    hidden function autoLapTick(pw as Number) as Void {
        if (eng.phase != Phase.FREE || Cfg.autoLapMode == 0) { return; }
        if (Cfg.autoLapMode == 1) {
            if (dist - _autoLapDist >= Cfg.autoLapKm * 1000.0) { autoLap("Auto lap " + Cfg.autoLapKm + " km"); }
        } else if (Cfg.autoLapMode == 2) {
            if (eng.s - _autoLapSec >= Cfg.autoLapMin * 60) { autoLap("Auto lap " + Cfg.autoLapMin + " min"); }
        } else if (eng.s >= 30) {
            var ftp = wk.ftp;
            if (!_fast) {
                if (lapN >= 30 && eng.hist.avgP(10) >= ftp * 0.9) { _fast = true; _slowRun = 0; autoLap("Wysiłek - start"); }
            } else {
                _slowRun = eng.hist.avgP(30) < ftp * 0.72 ? _slowRun + 1 : 0;
                if (_slowRun >= 20) { _fast = false; autoLap("Wysiłek - koniec"); }
            }
        }
    }

    hidden function autoLap(label as String) as Void {
        closeLap(0, StepType.FREE, true);
        showBanner(label + "\n" + Util.clock(prevLap["sec"]) + ", " + prevLap["avgP"] + " W", "lap", 5);
    }

    // ------------------------------------------------------------------ zdarzenia silnika
    function onCue(kind, key, text, vars) as Void {
        if (dbg) { System.println("CP cue " + key); }
        var secs = 7;
        if (kind.equals("countdown")) { secs = 2; }
        else if (kind.equals("summary")) { secs = 12; }
        else if (kind.equals("arm")) { secs = 9; }
        showBanner(text, kind, secs);
        if (!key.equals("count") && !key.equals("endCount")) {
            if (cues.size() >= 12) { cues = cues.slice(1, null); }
            cues.add([eng == null ? 0 : eng.s, kind, text]);
        }
        if (dbg) { System.println("CP cue-tone"); }
        cueTone(kind, key, vars);
        if (dbg) { System.println("CP cue-link"); }
        if (!key.equals("endCount")) {
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
        if (!Cfg.tones || !(Attention has :playTone)) { return; }
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
            if (st.hrHi > 0) { sd.put("hrHigh", st.hrHi); }
            if (st.hrLo > 0) { sd.put("hrLow", st.hrLo); }
            d.put("step", sd);
            var nx = eng.nextStep();
            if (nx != null) {
                d.put("nextStep", { "name" => nx.name, "type" => StepType.key(nx.type), "durationSec" => nx.dur, "low" => nx.lo, "high" => nx.hi });
            }
            d.put("planRemainingSec", eng.planLeftSec());
        }
        if (eng.series.size() > 0) {
            var ser = [];
            var from = eng.series.size() > 8 ? eng.series.size() - 8 : 0;
            for (var i = from; i < eng.series.size(); i++) {
                var r = eng.series[i];
                ser.add({ "n" => r["n"], "avg" => r["avgPower"], "vrd" => r["verdict"], "sec" => r["durationSec"] });
            }
            d.put("series", ser);
        }
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
        link.event({ "t" => "talk" });
        showBanner("Enzo słucha\nmów do słuchawek", "enzo", 5);
        tone("msg");
    }

    // ------------------------------------------------------------------ telefon → licznik
    function onPhoneCommand(cmd as String) as Void {
        if (cmd.equals("next")) { if (eng != null && state == RideState.RECORDING) { eng.skipStep(); } }
        else if (cmd.equals("pause")) { pause(); }
        else if (cmd.equals("resume")) { resume(); }
        else if (cmd.equals("cancel")) { if (eng != null) { eng.cancelStart(); } }
        else if (cmd.equals("lap")) { lapButton(); }
        else if (cmd.equals("eat")) { if (eng != null) { eng.fueled(true); } }
        else if (cmd.equals("drink")) { if (eng != null) { eng.fueled(false); } }
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
