import Toybox.Communications;
import Toybox.Lang;
import Toybox.System;

class LinkListener extends Communications.ConnectionListener {
    hidden var _link;

    function initialize(link) {
        ConnectionListener.initialize();
        _link = link;
    }

    function onComplete() as Void { _link.sent(true); }
    function onError() as Void { _link.sent(false); }
}

//! Most do aplikacji VeloIQ na telefonie (Connect IQ Mobile SDK). Edge nadaje co sekundę dane z czujników
//! ANT+ i stan treningu, zdarzenia silnika (komunikaty dla głosu Enzo) oraz prośbę „zapytaj Enzo”; telefon
//! może odesłać polecenie albo tekst odpowiedzi. Bez aplikacji na telefonie most sam się wycisza.
//!
//! Protokół (słowniki z krótkimi kluczami):
//!   Edge → telefon  { "t":"live", "v":[s, moc, tętno, kadencja, prędkość×10, faza, krok, zostało, cel↓, cel↑, pauza] }
//!                   { "t":"cue", "k":klucz, "kind":rodzaj, "x":tekst, "v":{zmienne} }
//!                   { "t":"talk", "st":{stan jazdy}, "q":gotowe pytanie, "tk":token rozmowy, "b":adres serwera }
//!                   { "t":"state", "s":"start|pause|resume|end", "w":nazwa treningu, "ftp":… }
//!   telefon → Edge  { "cmd":"next|pause|resume|cancel|lap|eat|drink|talk|report" }   { "say":"odpowiedź Enzo" }
//!                   { "hello":1 }  – telefon ma most; licznik sam włącza nadawanie (bez grzebania w ustawieniach)
class PhoneLink {
    var active as Boolean = false;     // telefon z aplikacją potwierdził odbiór
    var owner = null;                  // onPhoneCommand(cmd), onPhoneSay(text)
    hidden var _busy as Boolean = false;
    hidden var _queue;                 // zdarzenia (ważniejsze niż próbki live)
    hidden var _live = null;           // ostatnia próbka czekająca na wysłanie
    hidden var _fails as Number = 0;
    hidden var _retryAt as Number = 0;
    hidden var _listener;
    hidden var _on as Boolean = false;

    function initialize() {
        _queue = [];
        _listener = new LinkListener(self);
    }

    function start() as Void {
        if (_on) { return; }
        _on = true;
        Communications.registerForPhoneAppMessages(method(:onPhone));
    }

    function stop() as Void {
        if (!_on) { return; }
        _on = false;
        Communications.registerForPhoneAppMessages(null);
        _queue = [];
        _live = null;
    }

    function onPhone(msg as Communications.PhoneAppMessage) as Void {
        var d = msg.data;
        active = true;
        _fails = 0;
        if (d == null || !(d instanceof Dictionary) || owner == null) { return; }
        if (d.get("hello") != null && !Cfg.phoneLink) {
            Cfg.save("phoneLink", true);
            owner.onPhoneHello();
        }
        var cmd = d.get("cmd");
        if (cmd != null) { owner.onPhoneCommand(cmd.toString()); }
        var say = d.get("say");
        if (say != null) { owner.onPhoneSay(say.toString()); }
    }

    function event(msg) as Void {
        if (!_on || !Cfg.phoneLink) { return; }
        if (_queue.size() >= 8) { _queue = _queue.slice(1, null); }
        _queue.add(msg);
        pump();
    }

    function live(values) as Void {
        if (!_on || !Cfg.phoneLink) { return; }
        _live = { "t" => "live", "v" => values };
        pump();
    }

    hidden function pump() as Void {
        if (_busy) { return; }
        if (!System.getDeviceSettings().phoneConnected) { active = false; return; }
        // po nieudanych próbach (brak aplikacji) ponawiamy coraz rzadziej, najwyżej co 30 s
        if (_fails > 0 && System.getTimer() < _retryAt) { return; }
        var msg = null;
        if (_queue.size() > 0) {
            msg = _queue[0];
            _queue = _queue.slice(1, null);
        } else if (_live != null) {
            msg = _live;
            _live = null;
        }
        if (msg == null) { return; }
        _busy = true;
        Communications.transmit(msg, null, _listener);
    }

    function sent(ok as Boolean) as Void {
        _busy = false;
        if (ok) {
            active = true;
            _fails = 0;
            pump();
        } else {
            active = false;
            _fails++;
            var wait = _fails * 5000;
            _retryAt = System.getTimer() + (wait > 30000 ? 30000 : wait);
        }
    }
}
