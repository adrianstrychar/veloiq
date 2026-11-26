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
    var out;      // wysłane wiadomości
    var lst;      // ich słuchacze (potwierdzenia w teście ręcznie)
    function initialize() {
        PhoneLink.initialize();
        out = [];
        lst = [];
    }
    // bez rejestracji w Connect IQ – inaczej test odpiąłby most aplikacji
    function start() as Void { _on = true; }
    function stop() as Void { _on = false; }
    function phoneUp() as Boolean { return true; }
    function xmit(msg, listener) as Void { out.add(msg); lst.add(listener); }
    //! Potwierdzenie (ok) albo błąd ostatnio wysłanej wiadomości.
    function ack(ok as Boolean) as Void {
        var x = lst[lst.size() - 1];
        if (ok) { x.onComplete(); } else { x.onError(); }
    }
    //! Ostatnia wysłana wiadomość danego typu (albo null).
    function sent(t as String) {
        for (var i = out.size() - 1; i >= 0; i--) {
            if (out[i].get("t").toString().equals(t)) { return out[i]; }
        }
        return null;
    }
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
        l.ack(true);
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
function testLinkNoAckDoesNotStall(logger as Test.Logger) as Boolean {
    // iPhone często nie potwierdza wysyłki: most nie może czekać – po 0,9 s idzie następna, po 3 s miejsce wraca
    Cfg.put("link", true); Cfg.load();
    var l = new FakeLink();
    l.start();
    l.live([1, 200, 150, 90, 300, 0, 0, 10, 180, 220, 0]);
    var ok = l.out.size() == 1 && l.inFlight() == 1;
    l.live([2, 201, 150, 90, 300, 0, 0, 9, 180, 220, 0]);   // za wcześnie (bez potwierdzenia) – czeka
    ok = ok && l.out.size() == 1;
    l.ageForTest(1000);
    l.tick();                                                // po sekundzie: następna mimo braku potwierdzenia
    ok = ok && l.out.size() == 2 && l.inFlight() == 2;
    l.event({ "t" => "cue", "k" => "x" });
    l.ageForTest(1000); l.tick();
    ok = ok && l.out.size() == 3 && l.inFlight() == 3 && l.lastType().equals("cue");
    l.live([3, 202, 150, 90, 300, 0, 0, 8, 180, 220, 0]);
    l.ageForTest(1500); l.tick();                            // 3 w drodze – limit; najstarsza ma już > 3 s → zwolniona
    logger.debug("w drodze=" + l.inFlight() + " wysłane=" + l.out.size() + " bez potw.=" + l.lostN);
    ok = ok && l.out.size() == 4 && l.lostN >= 1 && l.lastType().equals("live");
    l.stop();
    return ok;
}

(:test)
function testLinkRetriesEvents(logger as Test.Logger) as Boolean {
    Cfg.put("link", true); Cfg.load();
    var l = new FakeLink();
    l.start();
    l.event({ "t" => "state", "s" => "start" });
    l.ack(false);                                           // nie doszło → wraca na początek kolejki
    var ok = l.queued() == 1 && l.failN == 1;
    l.retryNow();
    ok = ok && l.out.size() == 2 && l.lastType().equals("state");
    l.ack(false); l.retryNow();                             // 2. ponowienie
    ok = ok && l.out.size() == 3;
    l.ack(false); l.retryNow();                             // po 3 próbach odpada (bez zapętlenia)
    ok = ok && l.out.size() == 3 && l.queued() == 0;
    // nieudana próbka live nie wraca (następna sekunda i tak przyjdzie)
    l.live([1, 200, 150, 90, 300, 0, 0, 10, 180, 220, 0]);
    l.retryNow();
    var n = l.out.size();
    l.ack(false); l.retryNow();
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
    // bez dźwięku i wibracji: w symulatorze bez ekranu wibracja zawiesza przebieg testów (limit czasu)
    var cb = up.onDone;
    var calls = [0];
    up.onDone = null;
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
    up.onDone = cb;
    Smoke.cleanup();
    return ok && calls[0] == 0;
}

(:test)
function testAutoPairing(logger as Test.Logger) as Boolean {
    // licznik bez konta + telefon z aplikacją VeloIQ: kod idzie mostem, telefon go potwierdza, licznik dostaje token
    Smoke.cleanup();
    Cfg.put("link", true); Cfg.put("apiBase", "https://localhost"); Cfg.load();     // bez zapytań do prawdziwego serwera
    var r = getRide();
    r.quiet = true;
    var oldLink = r.link;
    var l = new FakeLink();
    l.start();
    l.owner = r;
    r.link = l;
    r.pairing = new Pairing();
    var p = r.pairing;
    r.onPhoneHello(true);
    var hi = l.sent("hi");
    var ok = p.active && p.auto && hi != null && hi.get("acct") == 0;
    p.onBegin(200, { "code" => "482913", "device" => "0b8f0b1e-1111-2222-3333-444455556666", "secret" => "s" });
    for (var i = 0; i < 4; i++) { l.ack(true); l.ageForTest(1000); l.tick(); }
    var pm = l.sent("pair");
    ok = ok && pm != null && pm.get("c").equals("482913") && p.code.equals("482913");
    p.onPoll(200, { "status" => "pending" });
    ok = ok && p.active && !Cfg.paired();
    // ekran startowy w trakcie łączenia i ekran z kodem rysują się bez błędu
    var g = Smoke.dc();
    new HomeScreen().draw(g);
    new PairView(null).onUpdate(g);
    p.onPoll(200, { "status" => "ok", "token" => "tok-1", "name" => "Adrian" });
    for (var j = 0; j < 4; j++) { l.ack(true); l.ageForTest(1000); l.tick(); }
    hi = l.sent("hi");
    logger.debug("paired=" + Cfg.paired() + " athlete=" + Cfg.athlete + " line=" + p.homeLine() + " hi=" + hi);
    ok = ok && Cfg.paired() && Cfg.athlete.equals("Adrian") && !p.active && p.homeLine() != null && hi != null && hi.get("acct") == 1;
    new HomeScreen().draw(g);
    // kolejne powitanie: konto jest – bez nowego łączenia
    r.onPhoneHello(false);
    ok = ok && !p.active;
    // ręczne łączenie na liczniku z kontem nic nie psuje
    p.start(false);
    ok = ok && !p.active;
    l.stop();
    r.link = oldLink;
    r.quiet = false;
    Smoke.cleanup();
    return ok;
}

(:test)
function testAutoPairingGivesUp(logger as Test.Logger) as Boolean {
    // telefon nie potwierdza (np. inne konto): najwyżej 3 próby na uruchomienie aplikacji, kod wygasa po 10 min
    Smoke.cleanup();
    Cfg.put("link", true); Cfg.put("apiBase", "https://localhost"); Cfg.load();     // bez zapytań do prawdziwego serwera
    var r = getRide();
    r.quiet = true;
    // kod idzie mostem – podmieniony, bo prawdziwy Communications.transmit w symulatorze bez telefonu zawiesza testy
    var oldLink = r.link;
    var l = new FakeLink();
    l.start();
    l.owner = r;
    r.link = l;
    r.pairing = new Pairing();
    var p = r.pairing;
    var starts = 0;
    for (var k = 0; k < 5; k++) {
        p.start(true);
        if (p.active) { starts++; }
        p.onBegin(200, { "code" => "11111" + k, "device" => "0b8f0b1e-1111-2222-3333-44445555666" + k, "secret" => "s" });
        p.onPoll(200, { "status" => "expired" });
    }
    logger.debug("próby=" + starts + " status=" + p.status + " failed=" + p.failed);
    var ok = starts == 3 && p.failed && !p.active && p.status.equals("Kod wygasł");
    // ręcznie (MENU) można zawsze
    p.start(false);
    ok = ok && p.active && !p.auto;
    p.cancel();
    l.stop();
    r.link = oldLink;
    r.quiet = false;
    Smoke.cleanup();
    return ok;
}
