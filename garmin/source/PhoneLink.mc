import Toybox.Communications;
import Toybox.Lang;
import Toybox.System;

//! Potwierdzenie jednej wysyłki – każda wiadomość ma własny słuchacz, więc wiadomo, która doszła, a która nie.
class LinkListener extends Communications.ConnectionListener {
    hidden var _link;
    hidden var _item;

    function initialize(link, item) {
        ConnectionListener.initialize();
        _link = link;
        _item = item;
    }

    function onComplete() as Void { _link.done(_item, true); }
    function onError() as Void { _link.done(_item, false); }
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
    // diagnostyka (Ustawienia → Most do telefonu): ile wiadomości doszło, ile się nie udało, ile bez potwierdzenia
    var okN as Number = 0;
    var failN as Number = 0;
    var lostN as Number = 0;
    var liveN as Number = 0;
    var lastOkAt as Number = 0;
    var lastPhoneAt as Number = 0;
    // wiadomości w drodze: [wiadomość, próby, wysłano (ms), live?] – najwyżej 3 naraz. Potwierdzenie z telefonu
    // (onComplete) przychodzi z iPhone'em często po kilku sekundach albo wcale – czekanie na nie z każdą kolejną
    // wiadomością dławiło most do jednej wiadomości na 20 s (dziennik jazdy 25.11: żadna próbka live nie doszła).
    hidden var _out;
    hidden var _lastXmitAt as Number = 0;
    hidden var _queue;                 // zdarzenia [wiadomość, liczba prób] – ważniejsze niż pojedyncza próbka live
    hidden var _live = null;           // ostatnia próbka czekająca na wysłanie (starsze się nadpisują)
    hidden var _lastWasLive as Boolean = false;
    hidden var _fails as Number = 0;
    hidden var _retryAt as Number = 0;
    hidden var _on as Boolean = false;
    hidden var _greeted as Boolean = false;

    static const MAX_OUT = 3;          // wiadomości w drodze naraz
    static const GAP_MS = 900;         // odstęp, gdy poprzednia nie jest jeszcze potwierdzona
    static const STALE_MS = 3000;      // bez potwierdzenia po 3 s: zwalniamy miejsce (zwykle i tak doszła)

    function initialize() {
        _queue = [];
        _out = [];
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
        _out = [];
    }

    //! Co sekundę z zegara jazdy: telefon, który zamilkł (zamknięta aplikacja), przestaje być „aktywny” –
    //! przycisk ENZO wraca wtedy do odpowiedzi na ekranie licznika. Zaległe zdarzenia idą bez czekania na próbkę.
    function tick() as Void {
        var now = System.getTimer();
        if (active && now - lastPhoneAt > 35000) { active = false; }
        if (_queue.size() > 0 || _live != null) { pump(); }
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
    function xmit(msg, listener) as Void {
        Communications.transmit(msg, null, listener);
    }

    //! Zdarzenia (start, komunikaty, odpowiedzi) mają pierwszeństwo, ale próbka live idzie co najmniej co drugą
    //! wiadomość. Następna wiadomość nie czeka na potwierdzenie poprzedniej dłużej niż GAP_MS.
    hidden function pump() as Void {
        if (!phoneUp()) { active = false; return; }
        var now = System.getTimer();
        if (_fails > 0 && now < _retryAt) { return; }
        // wiadomości bez potwierdzenia od 3 s zwalniają miejsce
        while (_out.size() > 0 && now - _out[0][2] > STALE_MS) {
            _out = _out.slice(1, null);
            lostN++;
        }
        if (_out.size() >= MAX_OUT) { return; }
        if (_out.size() > 0 && now - _lastXmitAt < GAP_MS) { return; }
        var item = null;
        var hasEv = _queue.size() > 0;
        if (_live != null && (!hasEv || !_lastWasLive)) {
            item = [_live, 0, now, true];
            _live = null;
            _lastWasLive = true;
            liveN++;
        } else if (hasEv) {
            var q = _queue[0];
            _queue = _queue.slice(1, null);
            item = [q[0], q[1], now, false];
            _lastWasLive = false;
        }
        if (item == null) { return; }
        _out.add(item);
        _lastXmitAt = now;
        xmit(item[0], new LinkListener(self, item));
    }

    //! Potwierdzenie (albo błąd) konkretnej wiadomości.
    function done(item, ok as Boolean) as Void {
        var now = System.getTimer();
        var rest = [];
        for (var i = 0; i < _out.size(); i++) { if (_out[i] != item) { rest.add(_out[i]); } }
        _out = rest;
        if (ok) {
            okN++;
            lastOkAt = now;
            _fails = 0;
        } else {
            failN++;
            _fails++;
            // zdarzenie (start jazdy, komunikat, odpowiedź Enzo) wraca na początek kolejki – do 3 prób;
            // nieudana próbka live nie wraca (za sekundę jest nowa)
            if (!item[3] && item[1] < 2) {
                var q = [[item[0], item[1] + 1]];
                q.addAll(_queue);
                _queue = q;
            }
            // ponowienie szybko: 1, 2, 3… najwyżej 5 s (dane na żywo nie mogą stać po pół minuty)
            var wait = _fails * 1000;
            _retryAt = now + (wait > 5000 ? 5000 : wait);
        }
        pump();
    }

    //! Tylko testy: ponowienie bez czekania i „postarzenie” wiadomości w drodze.
    function retryNow() as Void { _retryAt = 0; pump(); }
    function ageForTest(ms as Number) as Void {
        for (var i = 0; i < _out.size(); i++) { _out[i][2] = _out[i][2] - ms; }
        _lastXmitAt = _lastXmitAt - ms;
    }

    function queued() as Number { return _queue.size(); }
    function inFlight() as Number { return _out.size(); }

    //! Krótki opis stanu mostu do menu.
    function describe() as String {
        var now = System.getTimer();
        var s = "wysłane " + okN + ", błędy " + failN + ", bez potw. " + lostN;
        if (lastOkAt > 0) { s = s + ", ost. " + ((now - lastOkAt) / 1000) + " s temu"; }
        return s;
    }
}
