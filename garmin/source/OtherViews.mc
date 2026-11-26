import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

//! Podsumowanie po zapisie jazdy: liczby, zgodność z planem, serie, stan wysyłki do VeloIQ.
class SummaryScreen {
    var hits;

    function initialize() {
        hits = [];
    }

    function draw(dc as Graphics.Dc) as Void {
        var r = getRide();
        var e = r.eng;
        var w = dc.getWidth();
        var h = dc.getHeight();
        var pad = w / 28;
        var xt = Graphics.FONT_XTINY;
        var lh = dc.getFontHeight(xt);
        hits = [];
        dc.setColor(Th.fg, Th.bg);
        dc.clear();
        if (e == null) { return; }
        var m = e.m;
        var y = 2;
        Ui.text(dc, w / 2, y, Graphics.FONT_SMALL, r.saved ? "JAZDA ZAPISANA" : "ZAPIS NIEUDANY", Ui.C, r.saved ? Th.good : Th.bad);
        y += dc.getFontHeight(Graphics.FONT_SMALL);
        Ui.text(dc, w / 2, y, xt, Util.ellipsis(r.wk.name, 34), Ui.C, Th.dim);
        y += lh + 4;

        var btnH = h / 9;
        var statusH = lh + 6;
        var serH = e.series.size() > 0 ? Util.min(e.series.size(), 4) * lh + lh + 6 : 0;
        var gridH = h - y - btnH - pad - statusH - serH;
        var labels = ["CZAS", "DYSTANS KM", "ŚR. MOC", "NP", "TSS", "IF", "PRACA kJ", m.nHr > 0 ? "ŚR. HR" : "ŚR. KAD."];
        var vals = [Util.clock(m.n), (r.dist / 1000.0).format("%.1f"), m.avgPower().format("%d"), m.np().format("%d"),
            m.tss().format("%d"), m.intensity().format("%.2f"), m.kJ().format("%d"), (m.nHr > 0 ? m.avgHr() : m.avgCad()).format("%d")];
        var ch = gridH / 4;
        var cw = w / 2;
        for (var i = 0; i < 8; i++) {
            var cx = (i % 2) * cw;
            var cy = y + (i / 2) * ch;
            Ui.text(dc, cx + 6, cy, xt, labels[i], Ui.L, Th.dim);
            Ui.value(dc, cx + cw / 2, cy + lh + (ch - lh) / 2, cw - 10, ch - lh, vals[i], Th.fg);
        }
        y += gridH;

        if (serH > 0) {
            var c = e.compliancePct();
            Ui.text(dc, pad, y, xt, "SERIE", Ui.L, Th.accent);
            Ui.text(dc, w - pad, y, xt, "zgodność z planem " + c + "%", Ui.R, c >= 85 ? Th.good : (c >= 60 ? Th.warn : Th.bad));
            y += lh + 2;
            var from = e.series.size() > 4 ? e.series.size() - 4 : 0;
            for (var j = from; j < e.series.size(); j++) {
                var s = e.series[j];
                var v = s["verdict"];
                Ui.text(dc, pad, y, xt, "" + s["n"] + ".  " + Util.clock(s["durationSec"]) + "  " + s["avgPower"] + " W", Ui.L, Th.fg);
                Ui.text(dc, w - pad, y, xt, Phrases.verdictText(v), Ui.R, v.equals("ok") ? Th.good : (v.equals("high") ? Th.bad : Th.cold));
                y += lh;
            }
            y += 4;
        }

        // --- wysyłka do VeloIQ: wyraźny stan (zielony pasek = jazda jest w VeloIQ, pasek postępu w trakcie)
        var up = r.up;
        var sy = h - btnH - pad - lh - 4;
        var bw = w - 2 * pad;
        var isDone = up.doneKey != null && up.doneKey == r.startEpoch;
        if (isDone) {
            Ui.fillRect(dc, pad, sy - 1, bw, lh + 4, Th.good);
            var txt = "JAZDA W VELOIQ";
            var tw = dc.getTextWidthInPixels(txt, xt);
            Ui.check(dc, w / 2 - tw / 2 - lh, sy + lh / 6, lh * 2 / 3, Th.bg);
            Ui.text(dc, w / 2 + lh / 3, sy, xt, txt, Ui.C, Th.bg);
        } else if (up.running()) {
            Ui.fillRect(dc, pad, sy - 1, bw, lh + 4, Th.card);
            if (up.progN > 0) { Ui.fillRect(dc, pad, sy - 1, bw * up.progI / up.progN, lh + 4, Th.accent); }
            Ui.text(dc, w / 2, sy, xt, "Wysyłam do VeloIQ " + up.progI + "/" + up.progN, Ui.C, Th.fg);
        } else {
            var st = up.status;
            if (!Cfg.paired()) { st = "Sparuj z VeloIQ, żeby wysłać jazdę"; }
            else if (m.n < 60) { st = "Za krótka jazda, nie wysyłam"; }
            else if (up.pending() > 0) {
                st = up.lastError.length() > 0 ? up.lastError : "Jazda czeka na wysyłkę";
                var wait = up.retryIn();
                if (wait > 0) { st = st + " · ponowię za " + wait + " s"; }
            } else if (st.length() == 0) { st = "Wysyłka do VeloIQ..."; }
            Ui.text(dc, w / 2, sy, xt, Util.ellipsis(st, 40), Ui.C, up.lastError.length() > 0 ? Th.warn : Th.accent);
        }

        var by = h - btnH - pad / 2;
        Ui.button(dc, pad, by, w - 2 * pad, btnH, "GOTOWE", Th.accent, Th.onAccent);
        hits.add(["done", pad, by, w - 2 * pad, btnH]);
    }

    function done() as Void {
        getRide().reset();
        WatchUi.requestUpdate();
    }

    function tap(x, y) as Void {
        for (var i = 0; i < hits.size(); i++) {
            if (Ui.inside(hits[i], x, y)) { done(); return; }
        }
    }

    function key(k) as Boolean {
        if (k == WatchUi.KEY_START || k == WatchUi.KEY_ENTER || k == WatchUi.KEY_LAP) { done(); return true; }
        return false;
    }

    function turn(d as Number) as Void {}
    function menu() as Void { done(); }
}

//! Połączenie licznika z kontem VeloIQ (ręcznie, z MENU): kod do wpisania w aplikacji. Logika w Pairing –
//! ta sama co przy łączeniu samym przez telefon; gdy aplikacja VeloIQ w telefonie jest otwarta, potwierdzi kod sama.
class PairView extends WatchUi.View {
    hidden var _timer = null;
    hidden var _closing as Boolean = false;
    hidden var _shown as Boolean = false;

    function initialize(scr) {
        View.initialize();
    }

    function onShow() as Void {
        _shown = true;
        // trwające łączenie przez telefon: ten sam kod, teraz także na ekranie
        if (!Cfg.paired()) { getRide().pairing.start(false); }
    }

    function onHide() as Void {
        _shown = false;
        if (_timer != null) { _timer.stop(); _timer = null; }
    }

    //! Ponowna próba po błędzie albo wygaśnięciu kodu.
    function retry() as Void {
        var p = getRide().pairing;
        if (!p.active) { p.start(false); }
    }

    function failed() as Boolean { return getRide().pairing.failed && !getRide().pairing.active; }

    function close() as Void {
        if (_timer != null) { _timer.stop(); _timer = null; }
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var p = getRide().pairing;
        var w = dc.getWidth();
        var h = dc.getHeight();
        var pad = w / 20;
        var xt = Graphics.FONT_XTINY;
        dc.setColor(Th.fg, Th.bg);
        dc.clear();
        var y = h / 30;
        Ui.text(dc, w / 2, y, Graphics.FONT_SMALL, "Połącz z kontem VeloIQ", Ui.C, Th.accent);
        y += dc.getFontHeight(Graphics.FONT_SMALL) + pad;
        var done = Cfg.paired();
        var info = done ? "Licznik pobiera plan i będzie sam wysyłał jazdy do VeloIQ."
            : "Otwarta aplikacja VeloIQ w telefonie połączy konto sama. Albo wpisz kod w aplikacji: Jedź, karta Garmin Edge, Wpisz kod.";
        y = Ui.lines(dc, Ui.wrap(dc, info, xt, w - 2 * pad), w / 2, y, xt, Th.fg, 6) + pad;
        if (!done && p.code != null) {
            var shown = p.code.length() == 6 ? p.code.substring(0, 3) + " " + p.code.substring(3, 6) : p.code;
            var ch = h / 5;
            Ui.card(dc, pad, y, w - 2 * pad, ch, Th.card);
            Ui.value(dc, w / 2, y + ch / 2, w - 4 * pad, ch - 8, shown, Th.accent);
            y += ch + pad;
        }
        var st = done ? (Cfg.athlete.length() > 0 ? "Połączono: " + Cfg.athlete : "Połączono!") : p.status;
        Ui.lines(dc, Ui.wrap(dc, st, Graphics.FONT_TINY, w - 2 * pad), w / 2, y, Graphics.FONT_TINY, failed() ? Th.bad : Th.good, 3);
        Ui.text(dc, w / 2, h - dc.getFontHeight(xt) - 4, xt, failed() ? "START: spróbuj ponownie" : "Wstecz: zamknij", Ui.C, Th.dim);
        if (done && !_closing && _shown) {
            _closing = true;
            _timer = new Timer.Timer();
            _timer.start(method(:close), 2000, false);
        }
    }
}

class PairDelegate extends WatchUi.BehaviorDelegate {
    hidden var _v as PairView;

    function initialize(v as PairView) {
        BehaviorDelegate.initialize();
        _v = v;
    }

    function onTap(evt as WatchUi.ClickEvent) as Boolean {
        if (_v.failed()) { _v.retry(); }
        return true;
    }

    function onKey(evt as WatchUi.KeyEvent) as Boolean {
        var k = evt.getKey();
        if ((k == WatchUi.KEY_START || k == WatchUi.KEY_ENTER) && _v.failed()) { _v.retry(); return true; }
        return false;
    }

    function onBack() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }
}

//! Ręczne ustawienie FTP (gdy licznik nie jest sparowany albo zawodnik chce nadpisać wartość z VeloIQ).
class FtpView extends WatchUi.View {
    var ftp as Number;
    var hits;

    function initialize() {
        View.initialize();
        ftp = Cfg.ftp;
        hits = [];
    }

    function change(d as Number) as Void {
        ftp = Util.clamp(ftp + d, 80, 600);
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var pad = w / 20;
        hits = [];
        dc.setColor(Th.fg, Th.bg);
        dc.clear();
        Ui.text(dc, w / 2, h / 30, Graphics.FONT_SMALL, "FTP", Ui.C, Th.accent);
        var bh = h / 6;
        var top = h / 6;
        Ui.button(dc, pad, top, w - 2 * pad, bh, "+ 5 W", Th.card, Th.fg);
        hits.add([5, pad, top, w - 2 * pad, bh]);
        Ui.value(dc, w / 2, h / 2, w - 4 * pad, h / 5, ftp.format("%d"), Th.fg);
        var by = h - top - bh;
        Ui.button(dc, pad, by, w - 2 * pad, bh, "- 5 W", Th.card, Th.fg);
        hits.add([-5, pad, by, w - 2 * pad, bh]);
        Ui.text(dc, w / 2, h - dc.getFontHeight(Graphics.FONT_XTINY) - 4, Graphics.FONT_XTINY, "Wstecz: zapisz", Ui.C, Th.dim);
    }
}

class FtpDelegate extends WatchUi.BehaviorDelegate {
    hidden var _v as FtpView;

    function initialize(v as FtpView) {
        BehaviorDelegate.initialize();
        _v = v;
    }

    function onTap(evt as WatchUi.ClickEvent) as Boolean {
        var xy = evt.getCoordinates();
        for (var i = 0; i < _v.hits.size(); i++) {
            if (Ui.inside(_v.hits[i], xy[0], xy[1])) { _v.change(_v.hits[i][0]); }
        }
        return true;
    }

    function onNextPage() as Boolean { _v.change(-5); return true; }
    function onPreviousPage() as Boolean { _v.change(5); return true; }

    function onBack() as Boolean {
        Cfg.save("ftp", _v.ftp);
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);    // menu ustawień pokazywało starą wartość
        return true;
    }
}
