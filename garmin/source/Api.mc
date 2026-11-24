import Toybox.Application;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.PersistedContent;
import Toybox.System;
import Toybox.WatchUi;

//! Klient API VeloIQ (/api/garmin/*). Zapytania idą przez telefon (Garmin Connect) albo Wi-Fi licznika.
//! Jedno zapytanie naraz, reszta czeka w kolejce.
class Api {
    hidden var _queue;
    hidden var _busy as Boolean = false;
    hidden var _cb = null;

    function initialize() {
        _queue = [];
    }

    function busy() as Boolean { return _busy || _queue.size() > 0; }

    //! cb: Method(code as Number, data) – data to słownik z JSON albo null.
    function get(path as String, params, cb) as Void {
        _queue.add([Communications.HTTP_REQUEST_METHOD_GET, path, params, cb]);
        pump();
    }

    function post(path as String, body, cb) as Void {
        _queue.add([Communications.HTTP_REQUEST_METHOD_POST, path, body, cb]);
        pump();
    }

    hidden function pump() as Void {
        if (_busy || _queue.size() == 0) { return; }
        var r = _queue[0];
        _queue = _queue.slice(1, null);
        _busy = true;
        _cb = r[3];
        var headers = {} as Dictionary;
        if (r[0] == Communications.HTTP_REQUEST_METHOD_POST) {
            headers.put("Content-Type", Communications.REQUEST_CONTENT_TYPE_JSON);
        }
        if (Cfg.token.length() > 0) { headers.put("Authorization", "Bearer " + Cfg.token); }
        Communications.makeWebRequest(Cfg.apiBase + r[1], r[2], {
            :method => r[0],
            :headers => headers,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        }, method(:onResp));
    }

    function onResp(code as Number, data as Null or ByteArray or Dictionary or String or PersistedContent.Iterator) as Void {
        _busy = false;
        var cb = _cb;
        _cb = null;
        if (cb != null) {
            cb.invoke(code, (data instanceof Dictionary) ? data : null);
        }
        pump();
    }

    //! Krótki opis błędu do pokazania na ekranie.
    static function errorText(code as Number) as String {
        if (code == 401) { return "Sparuj ponownie z VeloIQ"; }
        if (code == Communications.BLE_CONNECTION_UNAVAILABLE || code == -2 || code == -3) { return "Brak połączenia z telefonem"; }
        if (code == Communications.NETWORK_REQUEST_TIMED_OUT) { return "Serwer nie odpowiada"; }
        if (code < 0) { return "Brak internetu (" + code + ")"; }
        return "Błąd serwera " + code;
    }
}

//! Wysyłka zakończonych jazd do VeloIQ. Jazda najpierw trafia do pamięci licznika (Storage), więc
//! brak telefonu przy zapisie niczego nie gubi – wysyłka rusza przy następnej okazji.
//!
//! Storage:  "upq" → [klucze jazd],  "up_<k>" → { st, i, ns, ng, sum },  "up_<k>_x" → { series, laps, efforts },
//!           "up_<k>_s<i>" / "up_<k>_g<i>" → paczki base64 (próbki 5 s / ślad GPS co 10 s).
class Uploader {
    hidden var _api as Api;
    hidden var _running as Boolean = false;
    hidden var _key = null;
    hidden var _meta = null;
    hidden var _fails as Number = 0;
    hidden var _retryAt as Number = 0;
    hidden var _count as Number = -1;    // ile jazd w kolejce (pamięć podręczna – bez czytania Storage co sekundę)
    var status as String = "";
    var lastError as String = "";

    function initialize(api as Api) {
        _api = api;
    }

    function pending() as Number {
        var q = Application.Storage.getValue("upq");
        _count = q == null ? 0 : q.size();
        return _count;
    }

    //! Co sekundę (ekran startowy i podsumowanie jazdy): nieudana wysyłka wraca po 5, 10, 20, 40 s, potem co minutę –
    //! jazda trafia do VeloIQ, gdy tylko telefon jest znów w zasięgu, bez czekania na wyjście z podsumowania.
    function tick() as Void {
        if (_running || System.getTimer() < _retryAt) { return; }
        if (_count < 0) { pending(); }
        if (_count == 0) { return; }
        _retryAt = System.getTimer() + 60000;   // bez połączenia / bez parowania: kolejna próba za minutę
        kick();
    }

    function running() as Boolean { return _running; }

    //! Dodaje jazdę do kolejki. sBlocks / gBlocks – tablice ciągów base64.
    function enqueue(key as Number, summary, extra, sBlocks, gBlocks) as Void {
        var k = key.format("%d");
        for (var i = 0; i < sBlocks.size(); i++) { Application.Storage.setValue("up_" + k + "_s" + i, sBlocks[i]); }
        for (var j = 0; j < gBlocks.size(); j++) { Application.Storage.setValue("up_" + k + "_g" + j, gBlocks[j]); }
        Application.Storage.setValue("up_" + k + "_x", extra);
        Application.Storage.setValue("up_" + k, { "st" => 0, "i" => 0, "ns" => sBlocks.size(), "ng" => gBlocks.size(), "sum" => summary });
        var q = Application.Storage.getValue("upq");
        if (q == null) { q = []; }
        q.add(key);
        Application.Storage.setValue("upq", q);
        _count = q.size();
        _fails = 0;
        _retryAt = 0;
    }

    //! Rusza wysyłkę, jeśli jest co wysłać, urządzenie jest sparowane i nic już nie leci.
    function kick() as Void {
        if (_running || !Cfg.paired()) { return; }
        var q = Application.Storage.getValue("upq");
        if (q == null || q.size() == 0) { status = ""; return; }
        _key = q[0];
        _meta = Application.Storage.getValue("up_" + _key.format("%d"));
        if (_meta == null) { drop(); kick(); return; }
        _running = true;
        lastError = "";
        step();
    }

    hidden function notify() as Void {
        WatchUi.requestUpdate();
    }

    hidden function step() as Void {
        var k = _key.format("%d");
        var st = _meta["st"];
        var ns = _meta["ns"];
        var ng = _meta["ng"];
        if (st == 0) {
            status = "Wysyłam jazdę...";
            var x = Application.Storage.getValue("up_" + k + "_x");
            _api.post("/api/garmin/ride", { "op" => "begin", "key" => _key, "summary" => _meta["sum"], "extra" => x, "ns" => ns, "ng" => ng }, method(:onStep));
        } else if (st == 1) {
            var i = _meta["i"];
            if (i >= ns + ng) {
                _meta["st"] = 2;
                Application.Storage.setValue("up_" + k, _meta);
                step();
                return;
            }
            var kind = i < ns ? "s" : "g";
            var seq = i < ns ? i : i - ns;
            var data = Application.Storage.getValue("up_" + k + "_" + kind + seq);
            status = "Wysyłam " + (i + 1) + "/" + (ns + ng);
            _api.post("/api/garmin/ride", { "op" => "chunk", "key" => _key, "kind" => kind, "seq" => seq, "data" => (data == null ? "" : data) }, method(:onStep));
        } else {
            status = "Kończę wysyłkę...";
            _api.post("/api/garmin/ride", { "op" => "finish", "key" => _key }, method(:onStep));
        }
        notify();
    }

    function onStep(code as Number, data) as Void {
        if (code != 200 || data == null) {
            _running = false;
            lastError = Api.errorText(code);
            status = "Jazda czeka na wysyłkę";
            _fails++;
            var wait = 5000;
            for (var i = 1; i < _fails && wait < 60000; i++) { wait *= 2; }
            _retryAt = System.getTimer() + (wait > 60000 ? 60000 : wait);
            notify();
            return;
        }
        _fails = 0;
        var k = _key.format("%d");
        var st = _meta["st"];
        if (st == 0) {
            // serwer ma już tę jazdę (odpowiedź na wcześniejsze „finish” nie dotarła) → nic więcej nie wysyłamy
            if (data.get("done") == true) {
                drop();
                _running = false;
                status = "Jazda w VeloIQ";
                notify();
                kick();
                return;
            }
            _meta["st"] = 1;
            _meta["i"] = 0;
        } else if (st == 1) {
            _meta["i"] = _meta["i"] + 1;
        } else {
            drop();
            _running = false;
            status = "Jazda w VeloIQ";
            notify();
            kick();   // następna z kolejki
            return;
        }
        Application.Storage.setValue("up_" + k, _meta);
        step();
    }

    //! Usuwa pierwszą jazdę z kolejki razem z jej paczkami.
    hidden function drop() as Void {
        var q = Application.Storage.getValue("upq");
        if (q == null || q.size() == 0) { return; }
        var key = q[0];
        var k = key.format("%d");
        var meta = Application.Storage.getValue("up_" + k) as Dictionary?;
        if (meta != null) {
            for (var i = 0; i < meta["ns"]; i++) { Application.Storage.deleteValue("up_" + k + "_s" + i); }
            for (var j = 0; j < meta["ng"]; j++) { Application.Storage.deleteValue("up_" + k + "_g" + j); }
        }
        Application.Storage.deleteValue("up_" + k + "_x");
        Application.Storage.deleteValue("up_" + k);
        Application.Storage.setValue("upq", q.slice(1, null));
        _count = q.size() - 1;
        _retryAt = 0;
    }
}
