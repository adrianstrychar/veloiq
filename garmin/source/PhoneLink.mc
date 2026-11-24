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
//! odsyła polecenia, tekst odpowiedzi i co kilka sekund „jestem” (hb). Start jazdy na liczniku = ta sama
//! sesja na telefonie (tryb lustra): telefon pokazuje dane na żywo, mówi głosem Enzo i obsługuje rozmowę.
//!
//! Protokół (słowniki z krótkimi kluczami):
//!   Edge → telefon  { "t":"live", "v":[s, moc, tętno, kadencja, prędkość×10, faza, krok, zostało, cel↓, cel↑, pauza,
//!                                      moc 3 s, średnia kroku, falstart s, przeciąganie s, dystans m, sekundy kroku] }
//!                   { "t":"cue", "k":klucz, "kind":rodzaj, "x":tekst, "v":{zmienne} }
//!                   { "t":"talk", "st":{stan jazdy}, "q":gotowe pytanie, "tk":token rozmowy, "b":adres serwera }
//!                   { "t":"state", "s":"start|pause|resume|end|idle", "k":start jazdy (epoch s), "w":nazwa, "st":[kroki]… }
//!                   { "t":"st", "st":{stan jazdy} }  – co 30 s i na prośbę telefonu (pytania do Enzo)
//!                   { "t":"hi", "v":wersja, "rec":0|1 } – odpowiedź na „hello”
//!   telefon → Edge  { "cmd":"next|pause|resume|cancel|lap|eat|drink|talk|report|sync|state" }   { "say":"odpowiedź Enzo" }
//!                   { "hello":1 } – telefon ma most · { "hb":1 } – aplikacja w telefonie działa (co ~10 s)
class PhoneLink {
    var active as Boolean = false;     // aplikacja VeloIQ w telefonie odezwała się w ostatnich 35 s
    var owner = null;                  // onPhoneCommand(cmd), onPhoneSay(text), onPhoneHello(first)
    hidden var _busy as Boolean = false;
    hidden var _busyAt as Number = 0;
    hidden var _queue;                 // zdarzenia (ważniejsze niż próbki live)
    hidden var _live = null;           // ostatnia próbka czekająca na wysłanie
    hidden var _fails as Number = 0;
    hidden var _retryAt as Number = 0;
    hidden var _listener;
    hidden var _on as Boolean = false;
    hidden var _lastPhone as Number = 0;
    hidden var _greeted as Boolean = false;

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

    //! Co sekundę z zegara jazdy: telefon, który zamilkł (zamknięta aplikacja), przestaje być „aktywny” –
    //! przycisk ENZO wraca wtedy do odpowiedzi na ekranie licznika.
    function tick() as Void {
        var now = System.getTimer();
        if (active && now - _lastPhone > 35000) { active = false; }
        // zgubione potwierdzenie wysyłki nie może zablokować mostu na zawsze
        if (_busy && now - _busyAt > 20000) { _busy = false; }
    }

    function onPhone(msg as Communications.PhoneAppMessage) as Void {
        var d = msg.data;
        active = true;
        _lastPhone = System.getTimer();
        _fails = 0;
        if (d == null || !(d instanceof Dictionary) || owner == null) { return; }
        if (d.get("hello") != null) {
            if (!Cfg.phoneLink) { Cfg.save("link", true); }
            var first = !_greeted;
            _greeted = true;
            owner.onPhoneHello(first);
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
        // po nieudanych próbach ponawiamy coraz rzadziej, najwyżej co 30 s
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
        _busyAt = System.getTimer();
        Communications.transmit(msg, null, _listener);
    }

    function sent(ok as Boolean) as Void {
        _busy = false;
        if (ok) {
            _fails = 0;
            pump();
        } else {
            _fails++;
            var wait = _fails * 5000;
            _retryAt = System.getTimer() + (wait > 30000 ? 30000 : wait);
        }
    }
}
