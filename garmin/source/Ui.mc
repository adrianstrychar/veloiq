import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;

//! Rysowanie: dobór czcionek do miejsca (ten sam kod na 282×470, 246×322 i 480×800), zawijanie tekstu, przyciski.
module Ui {
    const C = Graphics.TEXT_JUSTIFY_CENTER;
    const L = Graphics.TEXT_JUSTIFY_LEFT;
    const R = Graphics.TEXT_JUSTIFY_RIGHT;
    const VC = Graphics.TEXT_JUSTIFY_VCENTER;

    function numFonts() {
        return [Graphics.FONT_NUMBER_THAI_HOT, Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM, Graphics.FONT_NUMBER_MILD,
            Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY];
    }

    function textFonts() {
        return [Graphics.FONT_LARGE, Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY];
    }

    //! Największa czcionka z listy, w której tekst mieści się w polu maxW × maxH.
    function fit(dc as Graphics.Dc, text as String, maxW, maxH, fonts) {
        for (var i = 0; i < fonts.size(); i++) {
            if (dc.getFontHeight(fonts[i]) <= maxH && dc.getTextWidthInPixels(text, fonts[i]) <= maxW) { return fonts[i]; }
        }
        return fonts[fonts.size() - 1];
    }

    //! Czy tekst składa się tylko ze znaków obecnych w czcionkach liczbowych.
    function numeric(s as String) as Boolean {
        if (s.equals("--")) { return false; }     // brak danych: zwykła czcionka, nie dwa grube bloki
        var a = s.toCharArray();
        for (var i = 0; i < a.size(); i++) {
            var code = a[i].toNumber();
            // cyfry, ':', '.', '-', spacja
            if (!((code >= 48 && code <= 57) || code == 58 || code == 46 || code == 45 || code == 32)) { return false; }
        }
        return true;
    }

    //! Wartość pola: czcionka liczbowa dla liczb, tekstowa dla reszty; wyśrodkowana w (cx, cy).
    function value(dc as Graphics.Dc, cx, cy, maxW, maxH, text as String, color) as Void {
        var f = fit(dc, text, maxW, maxH, numeric(text) ? numFonts() : textFonts());
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy, f, text, C | VC);
    }

    function text(dc as Graphics.Dc, x, y, font, s as String, just, color) as Void {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y, font, s, just);
    }

    //! Zawijanie po słowach z uwzględnieniem "\n". Zwraca tablicę linii.
    function wrap(dc as Graphics.Dc, s as String, font, maxW) {
        var lines = [];
        var rest = s;
        while (rest != null) {
            var nl = rest.find("\n");
            var para = nl == null ? rest : rest.substring(0, nl);
            rest = nl == null ? null : rest.substring(nl + 1, rest.length());
            var line = "";
            var words = para;
            while (words != null && words.length() > 0) {
                var sp = words.find(" ");
                var word = sp == null ? words : words.substring(0, sp);
                words = sp == null ? null : words.substring(sp + 1, words.length());
                var cand = line.length() == 0 ? word : line + " " + word;
                if (line.length() > 0 && dc.getTextWidthInPixels(cand, font) > maxW) {
                    lines.add(line);
                    line = word;
                } else {
                    line = cand;
                }
            }
            lines.add(line);
        }
        return lines;
    }

    //! Rysuje linie wyśrodkowane w poziomie od yTop; zwraca y pod ostatnią linią.
    function lines(dc as Graphics.Dc, arr, cx, yTop, font, color, maxLines as Number) {
        var h = dc.getFontHeight(font);
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        var n = arr.size() < maxLines ? arr.size() : maxLines;
        for (var i = 0; i < n; i++) {
            dc.drawText(cx, yTop + i * h, font, arr[i], C);
        }
        return yTop + n * h;
    }

    function fillRect(dc as Graphics.Dc, x, y, w, h, color) as Void {
        dc.setColor(color, color);
        dc.fillRectangle(x, y, w, h);
    }

    function card(dc as Graphics.Dc, x, y, w, h, color) as Void {
        dc.setColor(color, color);
        dc.fillRoundedRectangle(x, y, w, h, 6);
    }

    function button(dc as Graphics.Dc, x, y, w, h, label as String, bg, fg) as Void {
        dc.setColor(bg, bg);
        dc.fillRoundedRectangle(x, y, w, h, 8);
        var f = fit(dc, label, w - 10, h - 4, [Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY]);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x + w / 2, y + h / 2, f, label, C | VC);
    }

    function inside(hit, x, y) as Boolean {
        return x >= hit[1] && x < hit[1] + hit[3] && y >= hit[2] && y < hit[2] + hit[4];
    }

    function clockNow() as String {
        var t = System.getClockTime();
        return t.hour.format("%d") + ":" + t.min.format("%02d");
    }

    //! Profil treningu: słupki kroków (wysokość = moc względem FTP, szerokość = czas), kursor postępu.
    function profile(dc as Graphics.Dc, x, y, w, h, wk, stepIdx, inStep) as Void {
        var total = wk.totalSec();
        if (total <= 0) { return; }
        var maxP = wk.ftp * 1.3;
        for (var i = 0; i < wk.steps.size(); i++) {
            var m = (wk.steps[i].lo + wk.steps[i].hi) / 2;
            if (wk.steps[i].type == StepType.INTERVAL && m > maxP) { maxP = m; }
        }
        if (maxP > wk.ftp * 2.2) { maxP = wk.ftp * 2.2; }
        var t = 0;
        var cursor = -1;
        for (var j = 0; j < wk.steps.size(); j++) {
            var st = wk.steps[j];
            var x0 = x + (t * w) / total;
            var x1 = x + ((t + st.dur) * w) / total;
            var bw = x1 - x0 - 1;
            if (bw < 1) { bw = 1; }
            var mid = (st.lo + st.hi) / 2.0;
            var bh = Util.round(h * (mid / maxP));
            if (bh > h) { bh = h; }
            if (bh < 3) { bh = 3; }
            var col = Th.stepColor(st.type);
            if (stepIdx >= 0 && j < stepIdx) { col = Th.line; }
            dc.setColor(col, col);
            dc.fillRectangle(x0, y + h - bh, bw, bh);
            if (j == stepIdx) {
                var prog = inStep > st.dur ? st.dur : inStep;
                cursor = x0 + (prog * (x1 - x0)) / st.dur;
            }
            t += st.dur;
        }
        if (cursor >= 0) {
            dc.setColor(Th.fg, Th.fg);
            dc.fillRectangle(cursor, y - 2, 2, h + 4);
        }
    }
}

//! Własne pola danych VeloIQ. id → etykieta + wartość liczona z bieżącej jazdy.
module Fields {
    const COUNT = 34;

    function label(id as Number) as String {
        var t = ["MOC 3s", "MOC 10s", "MOC 30s", "TĘTNO", "KADENCJA", "KM/H", "DYSTANS", "CZAS", "ŚR. MOC", "NP",
            "IF", "TSS", "PRACA kJ", "W'BAL %", "MOC LAP", "CZAS LAP", "HR LAP", "ŚR. HR", "PRZEWYŻ.", "GODZINA",
            "CEL W", "DO KOŃCA", "ŚR. KROKU", "ZGODNOŚĆ %", "% FTP", "W/KG", "HR % MAX", "ŚR. KAD.", "STREFA", "DO KOŃCA PLANU",
            "MAX MOC", "TEMP.", "WYSOKOŚĆ", "OD JEDZENIA"];
        return (id >= 0 && id < t.size()) ? t[id] : "?";
    }

    function defaults() {
        return [[0, 3, 4, 5, 14, 9, 7, 6], [11, 10, 12, 13, 8, 17, 18, 19]];
    }

    function pages() {
        var p = Cfg.pages;
        if (p == null || !(p instanceof Array) || p.size() != 2) { return defaults(); }
        return p;
    }

    function n(v) as String {
        return v == null ? "--" : v.format("%d");
    }

    function value(id as Number, r) as String {
        var e = r.eng;
        if (e == null) { return "--"; }
        var m = e.m;
        var hub = r.hub;
        if (id == 0) { return hub.power == null ? "--" : Util.round(e.hist.avgP(3)).format("%d"); }
        if (id == 1) { return Util.round(e.hist.avgP(10)).format("%d"); }
        if (id == 2) { return Util.round(e.hist.avgP(30)).format("%d"); }
        if (id == 3) { return n(hub.hr); }
        if (id == 4) { return n(hub.cad); }
        if (id == 5) { return r.speed == null ? "--" : (r.speed * 3.6).format("%.1f"); }
        if (id == 6) { return (r.dist / 1000.0).format(r.dist >= 100000 ? "%.1f" : "%.2f"); }
        if (id == 7) { return Util.clock(e.s + 1); }
        if (id == 8) { return m.avgPower().format("%d"); }
        if (id == 9) { return m.np().format("%d"); }
        if (id == 10) { return m.intensity().format("%.2f"); }
        if (id == 11) { return m.tss().format("%d"); }
        if (id == 12) { return m.kJ().format("%d"); }
        if (id == 13) { return m.wBalPct().format("%d"); }
        if (id == 14) { return r.lapN > 0 ? Util.round(r.lapSumP.toFloat() / r.lapN).format("%d") : "--"; }
        if (id == 15) { return Util.clock(r.lapN); }
        if (id == 16) { return r.lapHrN > 0 ? Util.round(r.lapSumHr.toFloat() / r.lapHrN).format("%d") : "--"; }
        if (id == 17) { return m.nHr > 0 ? m.avgHr().format("%d") : "--"; }
        if (id == 18) { return r.ascent.format("%d"); }
        if (id == 19) { return Ui.clockNow(); }
        var st = e.step();
        if (id == 20) { return st == null ? "--" : st.lo.format("%d") + "-" + st.hi.format("%d"); }
        if (id == 21) { return st == null ? "--" : Util.clock(e.stepRemaining()); }
        if (id == 22) { return st == null ? "--" : e.stepAvgPower().format("%d"); }
        if (id == 23) { return e.series.size() > 0 ? e.compliancePct().format("%d") : "--"; }
        if (id == 24) { return Util.round(e.hist.avgP(3) * 100.0 / m.ftp).format("%d"); }
        if (id == 25) { return (e.hist.avgP(3) / Cfg.weightKg).format("%.1f"); }
        if (id == 26) { return (hub.hr == null || Cfg.hrmax <= 0) ? "--" : Util.round(hub.hr * 100.0 / Cfg.hrmax).format("%d"); }
        if (id == 27) { return m.nCad > 0 ? m.avgCad().format("%d") : "--"; }
        if (id == 28) { return "Z" + (m.zoneOf(Util.round(e.hist.avgP(3))) + 1); }
        if (id == 29) { return st == null ? "--" : Util.clock(e.planLeftSec()); }
        if (id == 30) { return m.maxP.format("%d"); }
        if (id == 31) { return hub.temp == null ? "--" : hub.temp.format("%.0f"); }
        if (id == 32) { return hub.alt == null ? "--" : hub.alt.format("%.0f"); }
        if (id == 33) { return Util.clock(e.s - e.lastEat); }
        return "--";
    }

    //! Kolor wartości: moc względem celu / strefy, reszta w kolorze tekstu.
    function color(id as Number, r) as Number {
        var e = r.eng;
        if (e == null) { return Th.fg; }
        if (id == 0 || id == 24 || id == 28) { return powerColor(r, Util.round(e.hist.avgP(3))); }
        if (id == 13) { var w = e.m.wBalPct(); return w < 25 ? Th.bad : (w < 50 ? Th.warn : Th.fg); }
        if (id == 23) { var c = e.compliancePct(); return e.series.size() == 0 ? Th.fg : (c >= 85 ? Th.good : (c >= 60 ? Th.warn : Th.bad)); }
        return Th.fg;
    }

    //! Kolor mocy: w planie – względem celu kroku (zielony w zakresie, czerwony za mocno, niebieski za słabo),
    //! w jeździe swobodnej – kolor strefy.
    function powerColor(r, p as Number) as Number {
        var e = r.eng;
        if (e == null || r.hub.power == null) { return Th.dim; }
        var st = e.step();
        if (st == null) { return Th.zone(e.m.zoneOf(p)); }
        var tol = Util.max(10.0, (st.lo + st.hi) / 2.0 * 0.03) / 2;
        if (p > st.hi + tol) { return Th.bad; }
        if (p < st.lo - tol) { return st.type == StepType.RECOVERY || st.type == StepType.COOLDOWN ? Th.good : Th.cold; }
        return Th.good;
    }
}
