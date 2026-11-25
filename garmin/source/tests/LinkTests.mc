import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Test;

// Most do telefonu bez telefonu: wysyłka podmieniona (FakeLink zapisuje, co by poszło), potwierdzenia ręcznie.
// Sprawdza to, co psuło jazdę z licznika w telefonie: próbki live nie mogą utknąć za kolejką komunikatów,
// a start jazdy / komunikat po nieudanej wysyłce musi pójść jeszcze raz.

(:test)
class FakeLink extends PhoneLink {
    var out;
    function initialize() {
        PhoneLink.initialize();
        out = [];
    }
    // bez rejestracji w Connect IQ – inaczej test odpiąłby most aplikacji
    function start() as Void { _on = true; }
    function stop() as Void { _on = false; }
    function phoneUp() as Boolean { return true; }
    function xmit(msg) as Void { out.add(msg); }
    //! Typ ostatnio wysłanej wiadomości („live”, „state”, „cue”…).
    function lastType() as String {
        if (out.size() == 0) { return "-"; }
        return out[out.size() - 1].get("t").toString();
    }
}

(:test)
function testLinkLiveNotStarved(logger as Test.Logger) as Boolean {
    Cfg.put("link", true); Cfg.load();
    var l = new FakeLink();
    l.start();
    l.event({ "t" => "state", "s" => "start" });          // od razu w drodze
    var ok = l.out.size() == 1 && l.lastType().equals("state");
    // w trakcie: dużo komunikatów i próbka co sekundę
    for (var i = 0; i < 5; i++) { l.event({ "t" => "cue", "k" => "c" + i }); }
    l.live([1, 200, 150, 90, 300, 0, 0, 10, 180, 220, 0]);
    // kolejne potwierdzenia: live musi pójść co najmniej co drugą wiadomość
    var types = "";
    for (var j = 0; j < 8; j++) {
        l.sent(true);
        if (j == 2) { l.live([2, 210, 151, 91, 300, 0, 0, 9, 180, 220, 0]); }
        types = types + l.lastType() + ",";
    }
    logger.debug("kolejność: " + types + " wysłane=" + l.okN + " live=" + l.liveN + " w kolejce=" + l.queued());
    // po starcie: live (czekał), cue, cue, live (nowa próbka), cue, cue, cue, …
    ok = ok && types.find("live,cue,cue,live,cue") == 0 && l.liveN == 2 && l.queued() == 0;
    l.stop();
    return ok;
}

(:test)
function testLinkRetriesEvents(logger as Test.Logger) as Boolean {
    Cfg.put("link", true); Cfg.load();
    var l = new FakeLink();
    l.start();
    l.event({ "t" => "state", "s" => "start" });
    l.sent(false);                                          // nie doszło → wraca na początek kolejki
    var ok = l.queued() == 1 && l.failN == 1;
    l.retryNow();
    ok = ok && l.out.size() == 2 && l.lastType().equals("state");
    l.sent(false); l.retryNow();                            // 2. ponowienie
    ok = ok && l.out.size() == 3;
    l.sent(false); l.retryNow();                            // po 3 próbach odpada (bez zapętlenia)
    ok = ok && l.out.size() == 3 && l.queued() == 0;
    // nieudana próbka live nie wraca (następna sekunda i tak przyjdzie)
    l.live([1, 200, 150, 90, 300, 0, 0, 10, 180, 220, 0]);
    l.retryNow();
    var n = l.out.size();
    l.sent(false); l.retryNow();
    ok = ok && l.out.size() == n && l.queued() == 0;
    logger.debug("wysłane=" + l.out.size() + " błędy=" + l.failN + " opis=" + l.describe());
    l.stop();
    return ok;
}

(:test)
function testVirtualSpeed(logger as Test.Logger) as Boolean {
    var v200 = Ride.speedFromPower(200.0, 83.0) * 3.6;
    var v300 = Ride.speedFromPower(300.0, 83.0) * 3.6;
    var v100 = Ride.speedFromPower(100.0, 83.0) * 3.6;
    logger.debug("km/h: 100 W " + v100.format("%.1f") + ", 200 W " + v200.format("%.1f") + ", 300 W " + v300.format("%.1f"));
    // płasko, klamkomanetki: ~26 / ~34 / ~39 km/h (jak w Zwift na płaskim)
    return v100 > 23.0 && v100 < 29.0 && v200 > 31.0 && v200 < 37.0 && v300 > 36.0 && v300 < 43.0;
}

(:test)
function testUploadConfirmation(logger as Test.Logger) as Boolean {
    Smoke.cleanup();
    Cfg.put("token", "t"); Cfg.load();
    var r = getRide();
    var up = r.up;
    up.enqueue(1795600000, { "dur" => 3600 }, {}, ["AAAA", "BBBB"], ["CCCC"]);
    up.kick();                                              // begin (odpowiedź symulujemy niżej)
    up.onStep(200, { "ok" => true });                       // begin OK → paczki
    up.onStep(200, { "ok" => true });                       // s0
    up.onStep(200, { "ok" => true });                       // s1
    up.onStep(200, { "ok" => true });                       // g0 → finish
    var mid = up.progI + "/" + up.progN;
    up.onStep(200, { "ok" => true, "rideId" => "x" });      // finish → w VeloIQ
    logger.debug("postęp przed końcem " + mid + ", status=" + up.status + " doneKey=" + up.doneKey + " pending=" + up.pending());
    var ok = up.doneKey == 1795600000 && up.pending() == 0 && up.status.find("Jazda w VeloIQ") == 0 && up.progI == up.progN;
    // ekran podsumowania i startowy z potwierdzeniem rysują się bez błędu
    var g = Smoke.dc();
    new HomeScreen().draw(g);
    Smoke.cleanup();
    return ok;
}
