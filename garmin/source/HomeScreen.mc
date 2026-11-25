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
        var ck = r.interrupted;
        if (r.resumePct >= 0) {
            // odtwarzanie przerwanej jazdy z punktu kontrolnego
            Ui.text(dc, 2 * pad, cy, Graphics.FONT_XTINY, "ODTWARZAM PRZERWANĄ JAZDĘ", Ui.L, Th.accent);
            Ui.value(dc, w / 2, y + cardH / 2, w - 6 * pad, cardH / 2, r.resumePct.format("%d"), Th.fg);
            Ui.text(dc, w / 2, y + cardH - dc.getFontHeight(Graphics.FONT_XTINY) - pad, Graphics.FONT_XTINY, "procent, chwila...", Ui.C, Th.dim);
        } else if (ck != null) {
            Ui.text(dc, 2 * pad, cy, Graphics.FONT_XTINY, "PRZERWANA JAZDA", Ui.L, Th.warn);
            cy += dc.getFontHeight(Graphics.FONT_XTINY);
            Ui.text(dc, 2 * pad, cy, Graphics.FONT_SMALL, Util.ellipsis(Util.str(ck.get("name"), "Jazda"), 24), Ui.L, Th.fg);
            cy += dc.getFontHeight(Graphics.FONT_SMALL);
            var ckInfo = "zapisane " + Util.clock(Util.int(ck.get("s"), 0));
            var ckDist = Util.num(ck.get("d"), 0.0);
            if (ckDist > 100) { ckInfo = ckInfo + ", " + (ckDist / 1000.0).format("%.1f") + " km"; }
            Ui.text(dc, 2 * pad, cy, Graphics.FONT_XTINY, ckInfo, Ui.L, Th.dim);
            cy += dc.getFontHeight(Graphics.FONT_XTINY) + pad / 2;
            Ui.lines(dc, Ui.wrap(dc, "WZNÓW: jedziesz dalej w tej samej jeździe.\nZAKOŃCZ: zapisuję i wysyłam do VeloIQ to, co było.", Graphics.FONT_XTINY, w - 4 * pad),
                w / 2, cy, Graphics.FONT_XTINY, Th.fg, 5);
        } else if (plan != null) {
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
            if (r.course != null && !Cfg.indoor && Cfg.navOn) {
                msg = "Trasa: " + r.course.name + "\n" + (r.course.total / 1000.0).format("%.1f") + " km, +" + r.course.gain + " m, podjazdy: " + r.course.climbs.size() + "\nSTART poprowadzi po śladzie.";
            }
            Ui.lines(dc, Ui.wrap(dc, msg, Graphics.FONT_XTINY, w - 4 * pad), w / 2, cy, Graphics.FONT_XTINY, Th.fg, 6);
        }
        y += cardH + pad / 2;

        // --- czujniki
        var hub = r.hub;
        var cw = (w - 2 * pad) / 4;
        // trzecia kolumna to tryb jazdy: dotknięcie przełącza trenażer ⇄ na zewnątrz
        var labels = ["MOC", "TĘTNO", Cfg.indoor ? "TRYB" : "GPS", "TELEFON"];
        var vals = [hub.power == null ? "--" : hub.power.format("%d") + " W", hub.hr == null ? "--" : hub.hr.format("%d"),
            Cfg.indoor ? "trenaż." : (hub.hasGps() ? "OK" : "szukam"), r.link.active ? "VeloIQ" : (System.getDeviceSettings().phoneConnected ? "czeka" : "--")];
        // TELEFON na zielono dopiero, gdy odezwała się aplikacja VeloIQ w telefonie (samo Garmin Connect to za mało)
        var oks = [hub.power != null, hub.hr != null, Cfg.indoor || hub.hasGps(), r.link.active];
        for (var k = 0; k < 4; k++) {
            var cx = pad + cw * k + cw / 2;
            Ui.text(dc, cx, y, Graphics.FONT_XTINY, labels[k], Ui.C, Th.dim);
            Ui.text(dc, cx, y + dc.getFontHeight(Graphics.FONT_XTINY), Graphics.FONT_TINY, vals[k], Ui.C, oks[k] ? Th.good : Th.warn);
        }
        if (r.resumePct < 0 && r.interrupted == null) { hits.add(["mode", pad + 2 * cw, y, cw, sensH]); }

        // --- komunikat / stan wysyłki
        var line = note;
        if (line == null && r.up.pending() > 0) { line = r.up.status.length() > 0 ? r.up.status : "Jazda czeka na wysyłkę"; }
        if (line == null && r.up.status.length() > 0 && (r.up.doneKey == null || r.up.recentDone())) { line = r.up.status; }
        if (line == null && Cfg.phoneLink && !r.link.active && System.getDeviceSettings().phoneConnected) { line = "Otwórz VeloIQ w telefonie"; }
        if (line == null && r.courseNote != null) { line = r.courseNote; }
        if (line == null && r.course != null && !Cfg.indoor) {
            line = "Trasa: " + Util.ellipsis(r.course.name, 16) + ", " + (r.course.total / 1000.0).format("%.0f") + " km" + (Cfg.navOn ? "" : " (wył.)");
        }

        // --- przyciski
        var by = h - 2 * (btnH + pad);
        if (line != null) {
            // jazda w VeloIQ: zielony znak i tekst, żeby było jasne, że wysyłka się skończyła
            var ok = r.up.pending() == 0 && r.up.doneKey != null && line.equals(r.up.status);
            var ly = by - dc.getFontHeight(Graphics.FONT_XTINY) - 2;
            if (ok) {
                var tw = dc.getTextWidthInPixels(line, Graphics.FONT_XTINY);
                var ch = dc.getFontHeight(Graphics.FONT_XTINY);
                Ui.check(dc, w / 2 - tw / 2 - ch, ly + ch / 6, ch * 2 / 3, Th.good);
                Ui.text(dc, w / 2 + ch / 3, ly, Graphics.FONT_XTINY, line, Ui.C, Th.good);
            } else {
                Ui.text(dc, w / 2, ly, Graphics.FONT_XTINY, line, Ui.C, Th.accent);
            }
        }
        var half = (w - 3 * pad) / 2;
        if (r.resumePct >= 0) { return; }       // odtwarzanie trwa – bez przycisków
        if (ck != null) {
            Ui.button(dc, pad, by, w - 2 * pad, btnH, "WZNÓW JAZDĘ", Th.accent, Th.onAccent);
            hits.add(["resume", pad, by, w - 2 * pad, btnH]);
            by += btnH + pad;
            Ui.button(dc, pad, by, half, btnH, "ZAKOŃCZ", Th.card, Th.fg);
            hits.add(["finalize", pad, by, half, btnH]);
            Ui.button(dc, 2 * pad + half, by, half, btnH, "MENU", Th.card, Th.fg);
            hits.add(["menu", 2 * pad + half, by, half, btnH]);
            return;
        }
        var startLabel = plan != null ? "START TRENINGU" : "START";
        Ui.button(dc, pad, by, w - 2 * pad, btnH, startLabel, Th.accent, Th.onAccent);
        hits.add(["start", pad, by, w - 2 * pad, btnH]);
        by += btnH + pad;
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
        var r = getRide();
        if (r.resumePct >= 0) { return; }
        if (r.interrupted != null) {
            // przycisk START przy przerwanej jeździe = wznowienie; nowa jazda dopiero po decyzji
            if (free) { flash("Najpierw wznów albo zakończ jazdę"); } else { r.resumeInterrupted(false); }
            WatchUi.requestUpdate();
            return;
        }
        if (!r.startRide(free)) { flash("Nie udało się rozpocząć nagrywania"); }
        WatchUi.requestUpdate();
    }

    function tap(x, y) as Void {
        for (var i = 0; i < hits.size(); i++) {
            var hit = hits[i];
            if (Ui.inside(hit, x, y)) {
                if (hit[0].equals("start")) { start(false); }
                else if (hit[0].equals("free")) { start(true); }
                else if (hit[0].equals("resume")) { getRide().resumeInterrupted(false); WatchUi.requestUpdate(); }
                else if (hit[0].equals("finalize")) { getRide().resumeInterrupted(true); WatchUi.requestUpdate(); }
                else if (hit[0].equals("menu")) { menu(); }
                else if (hit[0].equals("mode")) {
                    Menus.setIndoor(!Cfg.indoor);
                    flash(Cfg.indoor ? "Trenażer: bez GPS, prędkość z mocy" : "Na zewnątrz: GPS włączony");
                }
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
