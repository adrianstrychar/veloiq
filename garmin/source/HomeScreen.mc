import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

//! Ekran startowy: trening na dziś z VeloIQ, stan czujników, start. Rysowany przez RootView.
class HomeScreen {
    var hits;       // [[id, x, y, w, h], …] – pola dotyku z ostatniego rysowania
    var note = null;
    hidden var _noteUntil as Number = 0;

    function initialize() {
        hits = [];
    }

    function flash(text as String) as Void {
        note = text;
        _noteUntil = System.getTimer() + 6000;
        WatchUi.requestUpdate();
    }

    function draw(dc as Graphics.Dc) as Void {
        var r = getRide();
        var w = dc.getWidth();
        var h = dc.getHeight();
        var pad = w / 28;
        hits = [];
        dc.setColor(Th.fg, Th.bg);
        dc.clear();
        if (note != null && System.getTimer() > _noteUntil) { note = null; }

        // --- nagłówek
        var y = h / 60;
        var fTitle = Ui.fit(dc, "VeloIQ", w, h / 8, Ui.textFonts());
        Ui.text(dc, pad, y, fTitle, "VeloIQ", Ui.L, Th.accent);
        Ui.text(dc, w - pad, y + 4, Graphics.FONT_XTINY, Ui.clockNow(), Ui.R, Th.dim);
        y += dc.getFontHeight(fTitle);
        var who = Cfg.paired() ? (Cfg.athlete.length() > 0 ? Cfg.athlete : "Połączono z VeloIQ") + ", FTP " + Cfg.ftp + " W" : "Nie sparowano z VeloIQ";
        Ui.text(dc, pad, y, Graphics.FONT_XTINY, who, Ui.L, Cfg.paired() ? Th.dim : Th.warn);
        y += dc.getFontHeight(Graphics.FONT_XTINY) + h / 80;

        // --- karta treningu
        var btnH = h / 9;
        var bottom = h - 2 * (btnH + pad) - pad;
        var sensH = dc.getFontHeight(Graphics.FONT_TINY) + dc.getFontHeight(Graphics.FONT_XTINY) + pad;
        var cardH = bottom - y - sensH - pad;
        Ui.card(dc, pad, y, w - 2 * pad, cardH, Th.card);
        var cy = y + pad / 2;
        var plan = r.plan;
        if (plan != null) {
            Ui.text(dc, 2 * pad, cy, Graphics.FONT_XTINY, plan.date.equals(r.todayIso()) ? "TRENING NA DZIŚ" : "TRENING " + plan.date, Ui.L, Th.accent);
            cy += dc.getFontHeight(Graphics.FONT_XTINY);
            var fName = Graphics.FONT_SMALL;
            var nameLines = Ui.wrap(dc, plan.name, fName, w - 4 * pad);
            dc.setColor(Th.fg, Graphics.COLOR_TRANSPARENT);
            for (var i = 0; i < nameLines.size() && i < 2; i++) {
                dc.drawText(2 * pad, cy, fName, nameLines[i], Ui.L);
                cy += dc.getFontHeight(fName);
            }
            var info = (plan.totalSec() / 60).format("%d") + " min";
            if (plan.tss > 0) { info = info + ", TSS " + plan.tss; }
            info = info + ", lapów: " + plan.steps.size();
            Ui.text(dc, 2 * pad, cy, Graphics.FONT_XTINY, info, Ui.L, Th.dim);
            cy += dc.getFontHeight(Graphics.FONT_XTINY) + pad / 2;
            var ph = y + cardH - cy - pad;
            if (ph > 12) { Ui.profile(dc, 2 * pad, cy, w - 4 * pad, ph, plan, -1, 0); }
        } else {
            Ui.text(dc, 2 * pad, cy, Graphics.FONT_XTINY, "DZIŚ", Ui.L, Th.accent);
            cy += dc.getFontHeight(Graphics.FONT_XTINY) + pad / 2;
            var msg = Cfg.paired() ? "Brak treningu w planie.\nJazda swobodna: wysiłki i lapy zapiszę automatycznie." : "Sparuj licznik z kontem VeloIQ (MENU), żeby pobrać plan.\nBez tego działa jazda swobodna.";
            Ui.lines(dc, Ui.wrap(dc, msg, Graphics.FONT_XTINY, w - 4 * pad), w / 2, cy, Graphics.FONT_XTINY, Th.fg, 6);
        }
        y += cardH + pad / 2;

        // --- czujniki
        var hub = r.hub;
        var cw = (w - 2 * pad) / 4;
        var labels = ["MOC", "TĘTNO", "GPS", "TELEFON"];
        var vals = [hub.power == null ? "--" : hub.power.format("%d") + " W", hub.hr == null ? "--" : hub.hr.format("%d"),
            Cfg.indoor ? "wył." : (hub.hasGps() ? "OK" : "szukam"), r.link.active ? "VeloIQ" : (System.getDeviceSettings().phoneConnected ? "OK" : "--")];
        var oks = [hub.power != null, hub.hr != null, Cfg.indoor || hub.hasGps(), System.getDeviceSettings().phoneConnected];
        for (var k = 0; k < 4; k++) {
            var cx = pad + cw * k + cw / 2;
            Ui.text(dc, cx, y, Graphics.FONT_XTINY, labels[k], Ui.C, Th.dim);
            Ui.text(dc, cx, y + dc.getFontHeight(Graphics.FONT_XTINY), Graphics.FONT_TINY, vals[k], Ui.C, oks[k] ? Th.good : Th.warn);
        }

        // --- komunikat / stan wysyłki
        var line = note;
        if (line == null && r.up.pending() > 0) { line = r.up.status.length() > 0 ? r.up.status : "Jazda czeka na wysyłkę"; }
        if (line == null && r.up.status.length() > 0) { line = r.up.status; }

        // --- przyciski
        var by = h - 2 * (btnH + pad);
        if (line != null) {
            Ui.text(dc, w / 2, by - dc.getFontHeight(Graphics.FONT_XTINY) - 2, Graphics.FONT_XTINY, line, Ui.C, Th.accent);
        }
        var startLabel = plan != null ? "START TRENINGU" : "START";
        Ui.button(dc, pad, by, w - 2 * pad, btnH, startLabel, Th.accent, Th.onAccent);
        hits.add(["start", pad, by, w - 2 * pad, btnH]);
        by += btnH + pad;
        var half = (w - 3 * pad) / 2;
        if (plan != null) {
            Ui.button(dc, pad, by, half, btnH, "SWOBODNA", Th.card, Th.fg);
            hits.add(["free", pad, by, half, btnH]);
            Ui.button(dc, 2 * pad + half, by, half, btnH, "MENU", Th.card, Th.fg);
            hits.add(["menu", 2 * pad + half, by, half, btnH]);
        } else {
            Ui.button(dc, pad, by, w - 2 * pad, btnH, "MENU", Th.card, Th.fg);
            hits.add(["menu", pad, by, w - 2 * pad, btnH]);
        }
    }

    function start(free as Boolean) as Void {
        if (!getRide().startRide(free)) { flash("Nie udało się rozpocząć nagrywania"); }
        WatchUi.requestUpdate();
    }

    function tap(x, y) as Void {
        for (var i = 0; i < hits.size(); i++) {
            var hit = hits[i];
            if (Ui.inside(hit, x, y)) {
                if (hit[0].equals("start")) { start(false); }
                else if (hit[0].equals("free")) { start(true); }
                else if (hit[0].equals("menu")) { menu(); }
                return;
            }
        }
    }

    function key(k) as Boolean {
        if (k == WatchUi.KEY_START || k == WatchUi.KEY_ENTER) { start(false); return true; }
        if (k == WatchUi.KEY_LAP) { menu(); return true; }
        return false;
    }

    function turn(d as Number) as Void {}

    function menu() as Void {
        WatchUi.pushView(Menus.home(), new HomeMenuDelegate(self), WatchUi.SLIDE_LEFT);
    }
}
