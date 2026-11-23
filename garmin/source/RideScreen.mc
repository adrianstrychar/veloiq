import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

//! Ekrany jazdy: TRENING (cel mocy, odliczanie, profil), dwie strony własnych pól danych, OKRĄŻENIA / SERIE, ENZO.
//! Strony: przesunięcie palcem w bok albo przyciski góra/dół. Rysowany przez RootView.
class RideScreen {
    const PAGES = 5;
    var page as Number = 0;
    var hits;

    function initialize() {
        hits = [];
    }

    function draw(dc as Graphics.Dc) as Void {
        var r = getRide();
        var e = r.eng;
        hits = [];
        dc.setColor(Th.fg, Th.bg);
        dc.clear();
        if (e == null) { return; }
        var w = dc.getWidth();
        var h = dc.getHeight();
        var top = drawBar(dc, r, w, h);
        if (page == 0) { drawMain(dc, r, e, top, w, h); }
        else if (page == 1 || page == 2) { drawGrid(dc, r, top, w, h, page - 1); }
        else if (page == 3) { drawLaps(dc, r, e, top, w, h); }
        else { drawEnzo(dc, r, top, w, h); }

        if (r.state == RideState.PAUSED) { drawPaused(dc, r, w, h); }
        if (r.enzoText != null) { drawEnzoCard(dc, r, w, h); }
        else if (r.banner != null && r.state != RideState.PAUSED) { drawBanner(dc, r, w, h); }
    }

    // ------------------------------------------------------------------ pasek stanu
    hidden function drawBar(dc, r, w, h) {
        var f = Graphics.FONT_XTINY;
        var bh = dc.getFontHeight(f) + 2;
        var pad = w / 28;
        Ui.text(dc, pad, 1, f, Ui.clockNow(), Ui.L, Th.dim);
        // kropki stron
        var gap = bh / 2 + 2;
        var x0 = w / 2 - (PAGES - 1) * gap / 2;
        for (var i = 0; i < PAGES; i++) {
            dc.setColor(i == page ? Th.accent : Th.line, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(x0 + i * gap, bh / 2, i == page ? 4 : 3);
        }
        var label = "REC";
        var col = Th.bad;
        if (r.state == RideState.PAUSED) { label = "PAUZA"; col = Th.warn; }
        else if (r.state == RideState.AUTOPAUSED) { label = "POSTÓJ"; col = Th.warn; }
        var tw = dc.getTextWidthInPixels(label, f);
        Ui.text(dc, w - pad, 1, f, label, Ui.R, col);
        if (r.link.active) {
            Ui.text(dc, w - pad - tw - 8, 1, f, "TEL", Ui.R, Th.good);
        }
        dc.setColor(Th.line, Th.line);
        dc.fillRectangle(0, bh, w, 1);
        return bh + 2;
    }

    // ------------------------------------------------------------------ strona TRENING
    hidden function drawMain(dc, r, e, top, w, h) as Void {
        var pad = w / 28;
        var H = h - top;
        var st = e.step();
        var hub = r.hub;
        var p3 = Util.round(e.hist.avgP(3));
        var xt = Graphics.FONT_XTINY;
        var xtH = dc.getFontHeight(xt);

        // --- A. nagłówek kroku
        var y = top;
        var hh = Util.round(H * 0.13);
        if (st != null) {
            var sc = Th.stepColor(st.type);
            Ui.fillRect(dc, 0, y, 5, hh, sc);
            var badge = "";
            if (e.phase == Phase.ARMED) { badge = "GOTOWY?"; }
            else if (e.phase == Phase.WAITING) { badge = "CZEKAM"; }
            else if (e.phase == Phase.AUTOPAUSED) { badge = "PAUZA"; }
            var bw = badge.length() > 0 ? dc.getTextWidthInPixels(badge, xt) + 10 : 0;
            var nameF = Ui.fit(dc, st.name, w - 3 * pad - bw, hh - xtH, [Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_TINY, xt]);
            Ui.text(dc, pad + 5, y, nameF, st.name, Ui.L, Th.fg);
            if (bw > 0) {
                Ui.card(dc, w - pad - bw, y + 2, bw, xtH + 2, Th.warn);
                Ui.text(dc, w - pad - bw / 2, y + 2, xt, badge, Ui.C, Th.bg);
            }
            var nx = e.nextStep();
            var sub = "ostatni lap";
            if (nx != null) {
                sub = "potem: " + nx.name + " " + Util.durShort(nx.dur);
                if (nx.type == StepType.INTERVAL) { sub = sub + ", " + nx.lo + "-" + nx.hi + " W"; }
            }
            Ui.text(dc, pad + 5, y + hh - xtH - 1, xt, Util.ellipsis(sub, 38), Ui.L, Th.dim);
        } else {
            Ui.fillRect(dc, 0, y, 5, hh, e.inEffort() ? Th.warn : Th.line);
            if (e.inEffort()) {
                Ui.text(dc, pad + 5, y, Graphics.FONT_SMALL, "WYSIŁEK " + Util.clock(e.effortSec()), Ui.L, Th.warn);
                Ui.text(dc, w - pad, y, Graphics.FONT_SMALL, "" + e.effortAvg() + " W", Ui.R, Th.warn);
            } else {
                Ui.text(dc, pad + 5, y, Graphics.FONT_SMALL, e.wk.isFree() ? "JAZDA SWOBODNA" : "PO PLANIE", Ui.L, Th.fg);
            }
            var lapAvg = r.lapN > 0 ? Util.round(r.lapSumP.toFloat() / r.lapN) : 0;
            Ui.text(dc, pad + 5, y + hh - xtH - 1, xt, "okrążenie " + r.lapNo + ": " + Util.clock(r.lapN) + ", " + lapAvg + " W", Ui.L, Th.dim);
        }
        y += hh;

        // --- B. moc
        var ph = Util.round(H * 0.25);
        var pTxt = hub.power == null ? "--" : p3.format("%d");
        var pCol = Fields.powerColor(r, p3);
        var subH = dc.getFontHeight(Graphics.FONT_TINY);
        Ui.value(dc, w / 2, y + (ph - subH) / 2, w - 6 * pad, ph - subH, pTxt, pCol);
        Ui.text(dc, w - pad, y + 2, xt, "W", Ui.R, Th.dim);
        Ui.text(dc, pad, y + 2, xt, "MOC 3s", Ui.L, Th.dim);
        var tgt = "";
        if (st != null) {
            tgt = (st.type == StepType.RECOVERY || st.type == StepType.COOLDOWN) ? "luźno, poniżej " + st.hi + " W" : "cel " + st.lo + "-" + st.hi + " W";
        } else {
            tgt = "Z" + (e.m.zoneOf(p3) + 1) + ", " + Util.round(p3 * 100.0 / e.m.ftp) + "% FTP";
        }
        Ui.text(dc, w / 2, y + ph - subH, Graphics.FONT_TINY, tgt, Ui.C, Th.fg);
        y += ph;

        // --- C. wskaźnik względem celu / stref
        var gh = Util.round(H * 0.05);
        drawGauge(dc, e, st, p3, pad, y + 2, w - 2 * pad, gh - 4, hub.power != null);
        y += gh;

        // --- D. czas
        var th = Util.round(H * 0.17);
        var tLabel = "CZAS";
        var tVal = Util.clock(e.s + 1);
        var tCol = Th.fg;
        if (st != null) {
            if (e.phase == Phase.WAITING) { tLabel = "PRZERWA DŁUŻSZA O"; tVal = Util.clock(e.overrunSec()); tCol = Th.warn; }
            else if (e.phase == Phase.ARMED) { tLabel = "START ZA (albo ruszaj wcześniej)"; tVal = Util.clock(e.stepRemaining()); tCol = Th.accent; }
            else if (e.phase == Phase.AUTOPAUSED) { tLabel = "PAUZA INTERWAŁU, ZOSTAŁO"; tVal = Util.clock(e.stepRemaining()); tCol = Th.warn; }
            else { tLabel = "DO KOŃCA LAPA"; tVal = Util.clock(e.stepRemaining()); }
        }
        var fsLeft = e.falseStartLeft();
        var tw = w;
        if (fsLeft > 0 && r.state == RideState.RECORDING) {
            // okno falstartu: przycisk odwołania startu interwału
            tw = w * 55 / 100;
            var bx = tw;
            var bwid = w - tw - pad;
            Ui.button(dc, bx, y + 4, bwid, th - 8, "FALSTART " + fsLeft, Th.bad, 0xFFFFFF);
            hits.add(["fs", bx, y, bwid, th]);
        }
        Ui.text(dc, tw / 2, y, xt, tLabel, Ui.C, Th.dim);
        Ui.value(dc, tw / 2, y + xtH + (th - xtH) / 2, tw - 2 * pad, th - xtH, tVal, tCol);
        y += th;

        // --- E. cztery małe pola: tętno, kadencja, prędkość, średnia moc lapa
        // (w planie lap = krok treningu liczony przez silnik, bez sekund postoju; poza planem bieżące okrążenie)
        var mh = Util.round(H * 0.13);
        var lapAvgP = st != null ? e.stepAvgPower() : (r.lapN > 0 ? Util.round(r.lapSumP.toFloat() / r.lapN) : 0);
        var labels = ["TĘTNO", "KADENCJA", "KM/H", "ŚR. LAP"];
        var vals = [Fields.n(hub.hr), Fields.n(hub.cad), r.speed == null ? "--" : (r.speed * 3.6).format("%.1f"), lapAvgP.format("%d")];
        var cw = w / 4;
        dc.setColor(Th.line, Th.line);
        dc.fillRectangle(0, y, w, 1);
        for (var i = 0; i < 4; i++) {
            var cx = cw * i + cw / 2;
            Ui.text(dc, cx, y + 1, xt, labels[i], Ui.C, Th.dim);
            var col = Th.fg;
            if (i == 0 && st != null && st.hrHi > 0 && hub.hr != null && st.type != StepType.INTERVAL && hub.hr > st.hrHi + 3) { col = Th.bad; }
            if (i == 1 && st != null && hub.cad != null && ((st.cadLo > 0 && hub.cad < st.cadLo) || (st.cadHi > 0 && hub.cad > st.cadHi))) { col = Th.warn; }
            if (i == 3 && st != null && st.type == StepType.INTERVAL && e.inStep >= 10) { col = Fields.powerColor(r, lapAvgP); }
            Ui.value(dc, cx, y + xtH + (mh - xtH) / 2, cw - 6, mh - xtH, vals[i], col);
            if (i > 0) { dc.setColor(Th.line, Th.line); dc.fillRectangle(cw * i, y + 4, 1, mh - 8); }
        }
        y += mh;

        // --- F. profil treningu / liczniki jazdy
        var btnH = Util.round(H * 0.13);
        var fh = h - y - btnH - pad;
        if (st != null && fh > 14) {
            Ui.profile(dc, pad, y + 4, w - 2 * pad, fh - 8, e.wk, e.stepIdx, e.inStep);
        } else if (fh > xtH) {
            var m = e.m;
            Ui.text(dc, w / 2, y + (fh - xtH) / 2, xt, "NP " + m.np() + ",  TSS " + m.tss() + ",  " + m.kJ() + " kJ", Ui.C, Th.dim);
        }

        // --- G. przyciski
        var by = h - btnH - pad / 2;
        var ew = (w - 3 * pad) * 62 / 100;
        var enzoLabel = r.enzoBusy ? "ENZO..." : (r.link.active ? "ENZO (głos)" : "ENZO");
        Ui.button(dc, pad, by, ew, btnH, enzoLabel, Th.accent, Th.onAccent);
        hits.add(["enzo", pad, by, ew, btnH]);
        var lx = 2 * pad + ew;
        var lw = w - lx - pad;
        Ui.button(dc, lx, by, lw, btnH, st != null ? "LAP >" : "LAP", Th.card, Th.fg);
        hits.add(["lap", lx, by, lw, btnH]);
    }

    //! Pasek: w planie zakres celu ze znacznikiem bieżącej mocy, w jeździe swobodnej strefy Z1–Z7.
    hidden function drawGauge(dc, e, st, p, x, y, w, h, live) as Void {
        if (h < 4) { h = 4; }
        if (st != null) {
            var lo = st.lo;
            var hi = st.hi;
            var rest = st.type == StepType.RECOVERY || st.type == StepType.COOLDOWN;
            if (rest) { lo = 0; }
            var span = Util.max(hi - lo, 20) * 1.5;
            var a = rest ? 0.0 : lo - span;
            var b = hi + span;
            Ui.fillRect(dc, x, y, w, h, Th.line);
            var zx0 = x + Util.round((lo - a) * w / (b - a));
            var zx1 = x + Util.round((hi - a) * w / (b - a));
            Ui.fillRect(dc, zx0, y, zx1 - zx0, h, Th.good);
            if (live) {
                var mx = x + Util.round((Util.clamp(p, a, b) - a) * w / (b - a));
                dc.setColor(Th.fg, Th.fg);
                dc.fillRectangle(mx - 2, y - 3, 4, h + 6);
            }
        } else {
            var top = e.m.ftp * 1.6;
            var edges = [0.0, 0.56, 0.76, 0.91, 1.06, 1.21, 1.51, 1.6];
            for (var z = 0; z < 7; z++) {
                var x0 = x + Util.round(edges[z] / 1.6 * w);
                var x1 = x + Util.round(edges[z + 1] / 1.6 * w);
                Ui.fillRect(dc, x0, y, x1 - x0 - 1, h, Th.zone(z));
            }
            if (live) {
                var px = x + Util.round(Util.clamp(p, 0, top) * w / top);
                dc.setColor(Th.fg, Th.fg);
                dc.fillRectangle(px - 2, y - 3, 4, h + 6);
            }
        }
    }

    // ------------------------------------------------------------------ strony pól danych
    hidden function drawGrid(dc, r, top, w, h, idx) as Void {
        var ids = Fields.pages()[idx];
        var n = ids.size();
        if (n == 0) { return; }
        var cols = n == 1 ? 1 : 2;
        var rows = (n + cols - 1) / cols;
        var cw = w / cols;
        var ch = (h - top) / rows;
        var xt = Graphics.FONT_XTINY;
        var lh = dc.getFontHeight(xt);
        for (var i = 0; i < n; i++) {
            var cx = (i % cols) * cw;
            var cy = top + (i / cols) * ch;
            var cellW = (cols == 2 && i == n - 1 && n % 2 == 1) ? w : cw;    // ostatnie nieparzyste pole na całą szerokość
            Ui.text(dc, cx + 6, cy + 1, xt, Fields.label(ids[i]), Ui.L, Th.dim);
            Ui.value(dc, cx + cellW / 2, cy + lh + (ch - lh) / 2, cellW - 10, ch - lh - 2, Fields.value(ids[i], r), Fields.color(ids[i], r));
            dc.setColor(Th.line, Th.line);
            dc.fillRectangle(cx, cy + ch - 1, cellW, 1);
            if (i % cols == 0 && cellW == cw && cols == 2) { dc.fillRectangle(cw - 1, cy + 4, 1, ch - 8); }
        }
    }

    // ------------------------------------------------------------------ okrążenia i serie
    hidden function drawLaps(dc, r, e, top, w, h) as Void {
        var pad = w / 28;
        var xt = Graphics.FONT_XTINY;
        var lh = dc.getFontHeight(xt);
        var y = top + 2;
        Ui.text(dc, pad, y, xt, "OKRĄŻENIE " + r.lapNo, Ui.L, Th.accent);
        y += lh;
        var bh = (h - top) / 5;
        Ui.value(dc, w / 4, y + bh / 2, w / 2 - pad, bh, Util.clock(r.lapN), Th.fg);
        var lapAvg = r.lapN > 0 ? Util.round(r.lapSumP.toFloat() / r.lapN) : 0;
        Ui.value(dc, w * 3 / 4, y + bh / 2, w / 2 - pad, bh, lapAvg.format("%d"), Fields.powerColor(r, lapAvg));
        y += bh;
        Ui.text(dc, w / 4, y, xt, "CZAS", Ui.C, Th.dim);
        Ui.text(dc, w * 3 / 4, y, xt, "ŚR. MOC W", Ui.C, Th.dim);
        y += lh + 2;
        var lapHr = r.lapHrN > 0 ? Util.round(r.lapSumHr.toFloat() / r.lapHrN).format("%d") : "--";
        var info = "HR " + lapHr + ",  max " + r.lapMaxP + " W";
        if (!Cfg.indoor) { info = info + ",  " + (Util.max(0.0, r.dist - r.lapStartDist) / 1000.0).format("%.2f") + " km"; }
        Ui.text(dc, w / 2, y, xt, info, Ui.C, Th.fg);
        y += lh + 4;
        dc.setColor(Th.line, Th.line);
        dc.fillRectangle(pad, y, w - 2 * pad, 1);
        y += 4;
        if (r.prevLap != null) {
            var pl = r.prevLap;
            Ui.text(dc, pad, y, xt, "POPRZEDNIE (" + pl["no"] + ")", Ui.L, Th.dim);
            Ui.text(dc, w - pad, y, xt, Util.clock(pl["sec"]) + ",  " + pl["avgP"] + " W" + (pl["avgHr"] > 0 ? ",  HR " + pl["avgHr"] : ""), Ui.R, Th.fg);
            y += lh + 4;
        }
        // serie interwałów z oceną
        var ser = e.series;
        if (ser.size() > 0) {
            Ui.text(dc, pad, y, xt, "SERIE", Ui.L, Th.accent);
            Ui.text(dc, w - pad, y, xt, "zgodność " + e.compliancePct() + "%", Ui.R, Th.fg);
            y += lh + 2;
            var tf = Graphics.FONT_TINY;
            var rowH = dc.getFontHeight(tf);
            var fitRows = (h - y) / rowH;
            var from = ser.size() > fitRows ? ser.size() - fitRows : 0;
            for (var i = from; i < ser.size(); i++) {
                var s = ser[i];
                var v = s["verdict"];
                var col = v.equals("ok") ? Th.good : (v.equals("high") ? Th.bad : Th.cold);
                Ui.text(dc, pad, y, tf, "" + s["n"] + ".  " + Util.clock(s["durationSec"]), Ui.L, Th.fg);
                Ui.text(dc, w - pad, y, tf, "" + s["avgPower"] + " W  " + s["compliancePct"] + "%", Ui.R, col);
                y += rowH;
            }
        } else if (e.efforts.size() > 0 || e.inEffort()) {
            Ui.text(dc, pad, y, xt, "WYSIŁKI", Ui.L, Th.accent);
            y += lh + 2;
            var tf2 = Graphics.FONT_TINY;
            var rowH2 = dc.getFontHeight(tf2);
            var eff = e.efforts;
            var fitRows2 = (h - y) / rowH2;
            var from2 = eff.size() > fitRows2 ? eff.size() - fitRows2 : 0;
            for (var j = from2; j < eff.size(); j++) {
                Ui.text(dc, pad, y, tf2, "" + (j + 1) + ".  " + Util.clock(eff[j]["durationSec"]), Ui.L, Th.fg);
                Ui.text(dc, w - pad, y, tf2, "" + eff[j]["avgPower"] + " W", Ui.R, Th.warn);
                y += rowH2;
            }
            if (e.inEffort() && y + rowH2 <= h) {
                Ui.text(dc, pad, y, tf2, "trwa  " + Util.clock(e.effortSec()), Ui.L, Th.fg);
                Ui.text(dc, w - pad, y, tf2, "" + e.effortAvg() + " W", Ui.R, Th.warn);
            }
        } else {
            Ui.text(dc, w / 2, y + lh, xt, "Tu pojawią się serie i wysiłki", Ui.C, Th.dim);
        }
    }

    // ------------------------------------------------------------------ strona ENZO
    hidden function drawEnzo(dc, r, top, w, h) as Void {
        var pad = w / 28;
        var xt = Graphics.FONT_XTINY;
        var lh = dc.getFontHeight(xt);
        var btnH = (h - top) / 8;
        var y = top + 2;
        Ui.text(dc, pad, y, Graphics.FONT_SMALL, "ENZO", Ui.L, Th.accent);
        Ui.text(dc, w - pad, y + 4, xt, r.link.active ? "głos w telefonie" : (Cfg.paired() ? "odpowiedzi na ekranie" : "nie sparowano"), Ui.R, Th.dim);
        y += dc.getFontHeight(Graphics.FONT_SMALL) + 2;

        // przyciski na dole
        var by = h - btnH - pad / 2;
        if (r.link.active) {
            var half = (w - 3 * pad) / 2;
            Ui.button(dc, pad, by, half, btnH, "MÓW", Th.accent, Th.onAccent);
            hits.add(["talk", pad, by, half, btnH]);
            Ui.button(dc, 2 * pad + half, by, half, btnH, "PYTANIA", Th.card, Th.fg);
            hits.add(["ask", 2 * pad + half, by, half, btnH]);
        } else {
            Ui.button(dc, pad, by, w - 2 * pad, btnH, r.enzoBusy ? "ENZO MYŚLI..." : "ZAPYTAJ ENZO", Th.accent, Th.onAccent);
            hits.add(["ask", pad, by, w - 2 * pad, btnH]);
        }

        // ostatnie komunikaty, najnowszy na górze
        var limit = by - pad;
        var cues = r.cues;
        if (cues.size() == 0) {
            Ui.lines(dc, Ui.wrap(dc, "Komunikaty trenera pojawią się tutaj. Zapytaj Enzo o moc, tętno, jedzenie albo co dalej.", xt, w - 2 * pad), w / 2, y + lh, xt, Th.dim, 6);
            return;
        }
        for (var i = cues.size() - 1; i >= 0 && y + lh <= limit; i--) {
            var c = cues[i];
            var col = c[1].equals("enzo") ? Th.accent : (c[1].equals("correction") ? Th.warn : Th.fg);
            Ui.text(dc, pad, y, xt, Util.clock(c[0]), Ui.L, Th.dim);
            var tx = pad + dc.getTextWidthInPixels("0:00:00", xt) + 4;
            var ls = Ui.wrap(dc, c[2], xt, w - tx - pad);
            dc.setColor(col, Graphics.COLOR_TRANSPARENT);
            for (var k = 0; k < ls.size() && y + lh <= limit; k++) {
                dc.drawText(tx, y, xt, ls[k], Ui.L);
                y += lh;
            }
            y += 3;
        }
    }

    // ------------------------------------------------------------------ nakładki
    hidden function drawBanner(dc, r, w, h) as Void {
        var kind = r.bannerKind;
        var text = r.banner;
        var pad = w / 28;
        if (kind.equals("countdown") && Ui.numeric(text)) {
            // 3-2-1: duża cyfra na środku
            var rad = w / 5;
            dc.setColor(Th.accent, Th.accent);
            dc.fillCircle(w / 2, h / 2, rad);
            Ui.value(dc, w / 2, h / 2, rad * 2, rad * 2, text, Th.onAccent);
            return;
        }
        var col = Th.accent;
        if (kind.equals("correction") || kind.equals("error")) { col = Th.bad; }
        else if (kind.equals("praise")) { col = Th.good; }
        else if (kind.equals("pause")) { col = Th.warn; }
        else if (kind.equals("cadence")) { col = Th.warn; }
        var bw = w - 2 * pad;
        var fonts = [Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_TINY];
        var f = fonts[2];
        var ls = null;
        var maxH = h * 42 / 100;
        for (var i = 0; i < fonts.size(); i++) {
            ls = Ui.wrap(dc, text, fonts[i], bw - 2 * pad);
            f = fonts[i];
            if (ls.size() * dc.getFontHeight(f) <= maxH - 2 * pad) { break; }
        }
        var bh = ls.size() * dc.getFontHeight(f) + 2 * pad;
        if (bh > maxH) { bh = maxH; }
        // baner nad przyciskami, moc i czas zostają widoczne
        var by = h - bh - h / 6;
        dc.setColor(col, col);
        dc.fillRoundedRectangle(pad - 3, by - 3, bw + 6, bh + 6, 10);
        dc.setColor(Th.bg, Th.bg);
        dc.fillRoundedRectangle(pad, by, bw, bh, 8);
        Ui.lines(dc, ls, w / 2, by + pad, f, Th.fg, (bh - 2 * pad) / dc.getFontHeight(f));
    }

    hidden function drawEnzoCard(dc, r, w, h) as Void {
        var pad = w / 28;
        var x = pad;
        var y = h / 8;
        var cw = w - 2 * pad;
        var ch = h * 3 / 4;
        dc.setColor(Th.accent, Th.accent);
        dc.fillRoundedRectangle(x - 3, y - 3, cw + 6, ch + 6, 12);
        dc.setColor(Th.bg, Th.bg);
        dc.fillRoundedRectangle(x, y, cw, ch, 10);
        Ui.text(dc, w / 2, y + 4, Graphics.FONT_SMALL, "ENZO", Ui.C, Th.accent);
        var ty = y + dc.getFontHeight(Graphics.FONT_SMALL) + 8;
        var xt = Graphics.FONT_XTINY;
        var room = y + ch - ty - dc.getFontHeight(xt) - 6;
        var fonts = [Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_TINY, xt];
        var f = xt;
        var ls = null;
        for (var i = 0; i < fonts.size(); i++) {
            ls = Ui.wrap(dc, r.enzoText, fonts[i], cw - 2 * pad);
            f = fonts[i];
            if (ls.size() * dc.getFontHeight(f) <= room) { break; }
        }
        Ui.lines(dc, ls, w / 2, ty, f, Th.fg, room / dc.getFontHeight(f));
        Ui.text(dc, w / 2, y + ch - dc.getFontHeight(xt) - 3, xt, "dotknij, aby zamknąć", Ui.C, Th.dim);
    }

    hidden function drawPaused(dc, r, w, h) as Void {
        var pad = w / 28;
        var ch = h * 2 / 5;
        var y = (h - ch) / 2;
        dc.setColor(Th.warn, Th.warn);
        dc.fillRoundedRectangle(pad - 3, y - 3, w - 2 * pad + 6, ch + 6, 12);
        dc.setColor(Th.bg, Th.bg);
        dc.fillRoundedRectangle(pad, y, w - 2 * pad, ch, 10);
        var tf = Ui.fit(dc, "PAUZA", w - 4 * pad, ch / 3, Ui.textFonts());
        Ui.text(dc, w / 2, y + 4, tf, "PAUZA", Ui.C, Th.warn);
        var ty = y + dc.getFontHeight(tf) + 4;
        Ui.text(dc, w / 2, ty, Graphics.FONT_XTINY, "czas jazdy " + Util.clock(r.eng.s + 1), Ui.C, Th.fg);
        var btnH = ch / 3;
        var by = y + ch - btnH - pad;
        var half = (w - 5 * pad) / 2;
        Ui.button(dc, 2 * pad, by, half, btnH, "WZNÓW", Th.good, 0x000000);
        hits.add(["resume", 2 * pad, by, half, btnH]);
        Ui.button(dc, 3 * pad + half, by, half, btnH, "ZAKOŃCZ", Th.card, Th.fg);
        hits.add(["end", 3 * pad + half, by, half, btnH]);
    }

    // ------------------------------------------------------------------ sterowanie
    function tap(x, y) as Void {
        var r = getRide();
        if (r.enzoText != null) { r.dismissEnzo(); return; }
        // przyciski nakładek są dodawane na końcu – sprawdzamy od końca
        for (var i = hits.size() - 1; i >= 0; i--) {
            var hit = hits[i];
            if (!Ui.inside(hit, x, y)) { continue; }
            var id = hit[0];
            if (r.state == RideState.PAUSED && !(id.equals("resume") || id.equals("end"))) { continue; }
            if (id.equals("enzo")) { enzo(); }
            else if (id.equals("lap")) { r.lapButton(); }
            else if (id.equals("fs")) { if (r.eng != null) { r.eng.cancelStart(); } }
            else if (id.equals("resume")) { r.resume(); }
            else if (id.equals("end")) { WatchUi.pushView(Menus.pause(), new PauseMenuDelegate(), WatchUi.SLIDE_UP); }
            else if (id.equals("talk")) { r.talkToPhone(); }
            else if (id.equals("ask")) { WatchUi.pushView(Menus.questions(), new QuestionMenuDelegate(), WatchUi.SLIDE_UP); }
            return;
        }
    }

    //! Przycisk Enzo: z mostem do telefonu – rozmowa głosem; bez – pytania z listy, odpowiedź na ekranie.
    function enzo() as Void {
        var r = getRide();
        if (r.link.active) { r.talkToPhone(); }
        else { WatchUi.pushView(Menus.questions(), new QuestionMenuDelegate(), WatchUi.SLIDE_UP); }
    }

    function key(k) as Boolean {
        var r = getRide();
        if (k == WatchUi.KEY_START) {
            if (r.state == RideState.PAUSED) { r.resume(); }
            else {
                r.pause();
                WatchUi.pushView(Menus.pause(), new PauseMenuDelegate(), WatchUi.SLIDE_UP);
            }
            return true;
        }
        if (k == WatchUi.KEY_LAP) { r.lapButton(); return true; }
        if (k == WatchUi.KEY_ENTER) { menu(); return true; }
        return false;
    }

    function turn(d as Number) as Void {
        page = (page + d + PAGES) % PAGES;
        WatchUi.requestUpdate();
    }

    function menu() as Void {
        WatchUi.pushView(Menus.ride(self), new RideMenuDelegate(self), WatchUi.SLIDE_LEFT);
    }
}
