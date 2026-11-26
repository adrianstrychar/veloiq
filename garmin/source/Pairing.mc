import Toybox.Application;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

//! Połączenie licznika z kontem VeloIQ – jedna ścieżka dla dwóch sposobów:
//!  • sam przez telefon: aplikacja VeloIQ w telefonie odezwała się przez most, a licznik nie ma konta →
//!    licznik prosi serwer o kod i wysyła go do telefonu, telefon (zalogowany) sam go potwierdza;
//!  • ręcznie: MENU → „Połącz z kontem” pokazuje kod do wpisania w aplikacji (przeglądarka, inny telefon).
//! W obu przypadkach kod idzie też mostem – jeśli aplikacja VeloIQ w telefonie jest otwarta, wpisywać nie trzeba.
//! Zapytania o wynik co 4 s z zegara jazdy (Ride.onTick), maksymalnie 10 minut.
class Pairing {
    var code = null;              // kod z serwera (6 cyfr) albo null
    var status as String = "";
    var failed as Boolean = false;
    var active as Boolean = false;
    var auto as Boolean = false;  // rozpoczęte przez telefon (bez ekranu z kodem)
    var doneAt as Number = 0;     // System.getTimer() udanego połączenia (komunikat na ekranie startowym)
    hidden var _device = null;
    hidden var _secret = null;
    hidden var _polls as Number = 0;
    hidden var _tick as Number = 0;
    hidden var _autoTries as Number = 0;

    function initialize() {}

    //! auto = przez telefon. Ponowne wywołanie w trakcie nie zaczyna od nowa (ten sam kod).
    function start(isAuto as Boolean) as Void {
        if (Cfg.paired()) { return; }
        if (active) {
            if (!isAuto) { auto = false; }
            sendCode();
            return;
        }
        if (isAuto) {
            // przez telefon najwyżej 3 razy na uruchomienie aplikacji (np. telefon zalogowany na inne konto i nie potwierdza)
            if (_autoTries >= 3) { return; }
            _autoTries++;
        }
        active = true;
        auto = isAuto;
        failed = false;
        code = null;
        _polls = 0;
        _tick = 0;
        status = isAuto ? "Łączę konto przez telefon..." : "Łączę z VeloIQ...";
        var ds = System.getDeviceSettings();
        getRide().api.post("/api/garmin/pair", { "model" => ds.partNumber, "app" => Cfg.VERSION }, method(:onBegin));
        WatchUi.requestUpdate();
    }

    //! Prośba z telefonu („Spróbuj ponownie” w aplikacji): limit prób automatycznych nie obowiązuje.
    function retry() as Void {
        _autoTries = 0;
        start(true);
    }

    function cancel() as Void {
        active = false;
        code = null;
    }

    function onBegin(http as Number, data) as Void {
        if (!active) { return; }
        if (http != 200 || data == null || data.get("code") == null) {
            active = false;
            failed = true;
            status = Api.errorText(http);
            WatchUi.requestUpdate();
            return;
        }
        code = data.get("code").toString();
        _device = data.get("device");
        _secret = data.get("secret");
        status = auto ? "Telefon potwierdza konto..." : "Czekam na wpisanie kodu";
        sendCode();
        WatchUi.requestUpdate();
    }

    //! Kod do aplikacji VeloIQ w telefonie (most) – zalogowana aplikacja potwierdza go sama.
    function sendCode() as Void {
        if (code != null) { getRide().link.event({ "t" => "pair", "c" => code }); }
    }

    //! Co sekundę z zegara jazdy.
    function tick() as Void {
        if (!active || code == null || _device == null) { return; }
        _tick++;
        if (_tick % 4 != 0) { return; }
        _polls++;
        if (_polls > 150) {        // 10 minut
            expire();
            return;
        }
        getRide().api.get("/api/garmin/pair", { "device" => _device, "secret" => _secret }, method(:onPoll));
    }

    hidden function expire() as Void {
        active = false;
        failed = true;
        code = null;
        status = "Kod wygasł";
        WatchUi.requestUpdate();
    }

    function onPoll(http as Number, data) as Void {
        if (!active) { return; }
        if (http != 200 || data == null) { return; }     // chwilowy brak łącza – próbujemy dalej
        var st = Util.str(data.get("status"), "");
        if (st.equals("ok") && data.get("token") != null) {
            active = false;
            code = null;
            Cfg.put("token", data.get("token").toString());
            Cfg.put("athlete", Util.str(data.get("name"), ""));
            Cfg.load();
            doneAt = System.getTimer();
            status = Cfg.athlete.length() > 0 ? "Połączono: " + Cfg.athlete : "Połączono z VeloIQ";
            getRide().onPaired();
        } else if (st.equals("expired")) {
            expire();
            return;
        }
        WatchUi.requestUpdate();
    }

    //! Komunikat dla ekranu startowego (trwające łączenie albo świeże połączenie) albo null.
    function homeLine() {
        if (active) { return status; }
        if (doneAt > 0 && System.getTimer() - doneAt < 15000) { return status; }
        if (failed && auto) { return "Konto: " + status; }
        return null;
    }
}
