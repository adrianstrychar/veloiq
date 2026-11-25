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
    // diagnostyka (Ustawienia → Most do telefonu): ile wiadomości poszło, ile się nie udało, kiedy ostatnia
    var okN as Number = 0;
    var failN as Number = 0;
    var liveN as Number = 0;
    var lastOkAt as Number = 0;
    var lastPhoneAt as Number = 0;
    hidden var _busy as Boolean = false;
    hidden var _busyAt as Number = 0;
    hidden var _queue;                 // zdarzenia [wiadomość, liczba prób] – ważniejsze niż pojedyncza próbka live
    hidden var _live = null;           // ostatnia próbka czekająca na wysłanie (starsze się nadpisują)
    hidden var _inflight = null;       // zdarzenie w drodze (do ponowienia, gdy się nie uda)
    hidden var _lastWasLive as Boolean = false;
    hidden var _fails as Number = 0;
    hidden var _retryAt as Number = 0;
    hidden var _listener;
    hidden var _on as Boolean = false;
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
        _inflight = null;
    }

    //! Co sekundę z zegara jazdy: telefon, który zamilkł (zamknięta aplikacja), przestaje być „aktywny” –
    //! przycisk ENZO wraca wtedy do odpowiedzi na ekranie licznika.
    function tick() as Void {
        var now = System.getTimer();
        if (active && now - lastPhoneAt > 35000) { active = false; }
        // zgubione potwierdzenie wysyłki nie może zablokować mostu: po 10 s uznajemy wiadomość za straconą
        // (bez ponawiania – mogła jednak dojść, a podwójny komunikat Enzo jest gorszy niż brak jednego)
        if (_busy && now - _busyAt > 10000) { _inflight = null; sent(false); }
        // po przerwie (błędy, brak telefonu) zaległe zdarzenia idą bez czekania na kolejną próbkę
        if (!_busy && _queue.size() > 0) { pump(); }
    }

    function onPhone(msg as Communications.PhoneAppMessage) as Void {
        var d = msg.data;
        active = true;
        lastPhoneAt = System.getTimer();
        _fails = 0;
        _retryAt = 0;
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
        if (_queue.size() >= 10) { _queue = _queue.slice(1, null); }   // przy długiej przerwie odpada najstarsze
        _queue.add([msg, 0]);
        pump();
    }

    function live(values) as Void {
        if (!_on || !Cfg.phoneLink) { return; }
        _live = { "t" => "live", "v" => values };
        pump();
    }

    //! Telefon w zasięgu (Bluetooth z Garmin Connect). Testy podmieniają.
    function phoneUp() as Boolean {
        return System.getDeviceSettings().phoneConnected;
    }

    //! Wysyłka jednej wiadomości. Testy podmieniają (bez telefonu w symulatorze).
    function xmit(msg) as Void {
        Communications.transmit(msg, null, _listener);
    }

    //! Jedna wiadomość naraz (Connect IQ nie lubi kilku w drodze). Zdarzenia (start, komunikaty, odpowiedzi) mają
    //! pierwszeństwo, ale próbka live idzie co najmniej co drugą wiadomość – inaczej przy kolejce komunikatów
    //! telefon nie widziałby mocy ani czasu jazdy.
    hidden function pump() as Void {
        if (_busy) { return; }
        if (!phoneUp()) { active = false; return; }
        if (_fails > 0 && System.getTimer() < _retryAt) { return; }
        var msg = null;
        var hasEv = _queue.size() > 0;
        if (_live != null && (!hasEv || !_lastWasLive)) {
            msg = _live;
            _live = null;
            _inflight = null;
            _lastWasLive = true;
            liveN++;
        } else if (hasEv) {
            _inflight = _queue[0];
            _queue = _queue.slice(1, null);
            msg = _inflight[0];
            _lastWasLive = false;
        }
        if (msg == null) { return; }
        _busy = true;
        _busyAt = System.getTimer();
        xmit(msg);
    }

    function sent(ok as Boolean) as Void {
        _busy = false;
        var now = System.getTimer();
        if (ok) {
            okN++;
            lastOkAt = now;
            _fails = 0;
            _inflight = null;
            pump();
        } else {
            failN++;
            _fails++;
            // zdarzenie (start jazdy, komunikat, odpowiedź Enzo) wraca na początek kolejki – do 3 prób
            if (_inflight != null && _inflight[1] < 2) {
                _inflight[1] = _inflight[1] + 1;
                var q = [_inflight];
                q.addAll(_queue);
                _queue = q;
            }
            _inflight = null;
            // ponowienie szybko: 1, 2, 3… najwyżej 5 s (dane na żywo nie mogą stać po pół minuty)
            var wait = _fails * 1000;
            _retryAt = now + (wait > 5000 ? 5000 : wait);
        }
    }

    //! Tylko testy: ponowienie bez czekania.
    function retryNow() as Void { _retryAt = 0; pump(); }

    function queued() as Number { return _queue.size(); }

    //! Krótki opis stanu mostu do menu i ekranu startowego.
    function describe() as String {
        var now = System.getTimer();
        var s = "wysłane " + okN + ", błędy " + failN;
        if (lastOkAt > 0) { s = s + ", ost. " + ((now - lastOkAt) / 1000) + " s temu"; }
        return s;
    }
}
