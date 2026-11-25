import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.WatchUi;

//! Strony graficzne jazdy (od wersji 0.3.0), inspirowane Edge 1060 i Wahoo, w stylu VeloIQ:
//!   WYKRES  – cały trening na osi czasu jazdy: bloki celów, rzeczywista moc (co 10 s) na ich tle, „teraz”,
//!             kolejne kroki z godziną startu (jak interaktywny ekran treningu w Edge 1060). Dotknięcie: zbliżenie.
//!   WYSIŁEK – rezerwa W′ jako bateria (jak „stamina” Garmina), ile wytrzymasz przy tej mocy, strefy mocy.
//!   PALIWO  – bilans węglowodanów (spalone z intensywności, zjedzone), glikogen, cel na godzinę, przyciski.
//!   PODJAZD – profil podjazdu w kolorach nachylenia (jak ClimbPro), co przed nami, kolejne podjazdy.
//!   krawędzie – kolor zgodności z celem po bokach ekranu TRENING (jak diody LED w Wahoo).
module Pages2 {

    // ------------------------------------------------------------------ WYKRES
    //! Granice kroków na osi czasu jazdy: przeszłe z faktycznych lapów, bieżący do „teraz + zostało”, przyszłe z planu.
    function timeline(e) {
        var n = e.wk.steps.size();
        var t0 = new [n];
        var t1 = new [n];
        var now = e.s + 1;
        var t = 0;
        for (var j = 0; j < n; j++) {
            if (j < e.stepIdx) {
                t0[j] = j < e.laps.size() ? e.laps[j]["startSec"] : t;
                t1[j] = j + 1 < e.laps.size() ? e.laps[j + 1]["startSec"] : t0[j] + e.wk.steps[j].dur;
            } else if (j == e.stepIdx && e.phase != Phase.FREE) {
                t0[j] = e.stepStartSec;
                t1[j] = now + e.stepRemaining();
                if (t1[j] < now) { t1[j] = now; }
            } else {
                t0[j] = t;
                t1[j] = t + e.wk.steps[j].dur;
            }
            if (j > e.stepIdx && j > 0) { t0[j] = t1[j - 1]; t1[j] = t0[j] + e.wk.steps[j].dur; }
            t = t1[j];
        }
        return [t0, t1, t > now ? t : now];
    }

    function chart(dc as Graphics.Dc, scr, r, e, top as Number, w as Number, h as Number) as Void {
        var pad = w / 28;
        var xt = Graphics.FONT_XTINY;
        var xtH = dc.getFontHeight(xt);
        var H = h - top;
        var y = top + 2;
        var st = e.step();

        // --- A. nagłówek: krok i ile zostało
        var hh = Util.round(H * 0.12);
        if (st != null) {
            Ui.fillRect(dc, 0, y, 5, hh, Th.stepColor(st.type));
            Ui.text(dc, pad + 5, y, Graphics.FONT_SMALL, Util.ellipsis(st.name, 18), Ui.L, Th.fg);
            var tgt = (st.type == StepType.RECOVERY || st.type == StepType.COOLDOWN) ? "< " + st.hi + " W" : "" + st.lo + "-" + st.hi + " W";
            Ui.text(dc, pad + 5, y + hh - xtH - 1, xt, tgt + (e.bias != 0 ? "  (cel " + (e.bias > 0 ? "+" : "") + e.bias + "%)" : ""), Ui.L, Th.dim);
            var rem = Util.clock(e.stepRemaining());
            var rf = Ui.fit(dc, rem, w / 2 - pad, hh, [Graphics.FONT_NUMBER_MILD, Graphics.FONT_MEDIUM, Graphics.FONT_SMALL]);
            dc.setColor(e.phase == Phase.ARMED ? Th.accent : Th.fg, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w - pad, y + hh / 2, rf, rem, Ui.R | Ui.VC);
        } else {
            Ui.text(dc, pad, y, Graphics.FONT_SMALL, "PLAN ZROBIONY", Ui.L, Th.good);
            Ui.text(dc, pad, y + hh - xtH - 1, xt, "jazda swobodna, wysiłki liczę sam", Ui.L, Th.dim);
        }
        y += hh + 2;

        // --- B. wykres: cele (bloki) i moc (linia)
        var chH = Util.round(H * 0.44);
        var tl = timeline(e);
        var t0 = tl[0];
        var t1 = tl[1];
        var total = tl[2];
        var now = e.s + 1;
        var a = 0;
        var b = total;
        if (scr.chartZoom == 1) { a = now - 300; b = now + 900; if (a < 0) { b -= a; a = 0; } }
        var span = Util.max(60, b - a);
        var maxP = e.wk.ftp * 1.3;
        for (var j = 0; j < e.wk.steps.size(); j++) { if (e.wk.steps[j].hi > maxP) { maxP = e.wk.steps[j].hi * 1.05; } }
        var tr = r.pTrace;
        var trFrom = a / 10;
        var trTo = Util.min(tr == null ? 0 : tr.size(), b / 10 + 1);
        for (var k = trFrom; k < trTo; k++) { if (tr[k] * 4 > maxP) { maxP = tr[k] * 4; } }
        if (maxP > e.wk.ftp * 2.5) { maxP = e.wk.ftp * 2.5; }
        var x0 = pad;
        var cw = w - 2 * pad;
        var base = y + chH;
        Ui.fillRect(dc, x0, y, cw, chH, Th.card);
        for (var s2 = 0; s2 < e.wk.steps.size(); s2++) {
            if (t1[s2] <= a || t0[s2] >= b) { continue; }
            var sx0 = x0 + Util.round((Util.max(t0[s2], a) - a) * cw.toFloat() / span);
            var sx1 = x0 + Util.round((Util.min(t1[s2], b) - a) * cw.toFloat() / span);
            var wst = e.wk.steps[s2];
            var hiY = base - Util.round(chH * Util.min(1.0, wst.hi / maxP));
            var loY = base - Util.round(chH * Util.min(1.0, wst.lo / maxP));
            var col = Th.stepColor(wst.type);
            if (s2 < e.stepIdx) { col = Th.line; }
            // zakres celu jako pasek, pod nim jasne tło bloku
            Ui.fillRect(dc, sx0, loY, Util.max(1, sx1 - sx0 - 1), base - loY, s2 < e.stepIdx ? Th.card : Th.line);
            Ui.fillRect(dc, sx0, hiY, Util.max(1, sx1 - sx0 - 1), Util.max(3, loY - hiY), col);
        }
        // FTP – kreskowana linia
        var fy = base - Util.round(chH * e.wk.ftp / maxP);
        dc.setColor(Th.dim, Graphics.COLOR_TRANSPARENT);
        for (var fx = x0; fx < x0 + cw; fx += 8) { dc.drawLine(fx, fy, fx + 4, fy); }
        // moc co 10 s
        if (tr != null && trTo - trFrom >= 2) {
            dc.setColor(Th.fg, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(2);
            var px = -1;
            var py = -1;
            var stepK = (trTo - trFrom) / (cw / 2) + 1;
            for (var k2 = trFrom; k2 < trTo; k2 += stepK) {
                var qx = x0 + Util.round((k2 * 10 + 5 - a) * cw.toFloat() / span);
                var qy = base - Util.round(chH * Util.min(1.0, tr[k2] * 4.0 / maxP));
                if (px >= 0) { dc.drawLine(px, py, qx, qy); }
                px = qx; py = qy;
            }
            dc.setPenWidth(1);
        }
        // teraz
        var nx = x0 + Util.round((now - a) * cw.toFloat() / span);
        Ui.fillRect(dc, Util.clamp(nx - 1, x0, x0 + cw - 2), y - 2, 2, chH + 4, Th.accent);
        Ui.text(dc, x0 + 3, y + 1, xt, scr.chartZoom == 1 ? "20 min" : "cały plan", Ui.L, Th.dim);
        scr.addHit(["czoom", 0, y, w, chH]);
        y = base + 4;

        // --- C. kolejne kroki: start za…, nazwa, czas, cel
        var rowF = Graphics.FONT_TINY;
        var rowH = dc.getFontHeight(rowF);
        var footH = xtH + 6;
        var rows = (h - y - footH) / rowH;
        var shown = 0;
        for (var i = e.stepIdx + 1; i < e.wk.steps.size() && shown < rows; i++) {
            var ns = e.wk.steps[i];
            var inSec = t0[i] - now;
            Ui.fillRect(dc, pad, y + 3, 4, rowH - 6, Th.stepColor(ns.type));
            Ui.text(dc, pad + 8, y, rowF, Util.ellipsis(ns.name, 14), Ui.L, Th.fg);
            var tg = (ns.type == StepType.RECOVERY || ns.type == StepType.COOLDOWN) ? "luz" : "" + ns.lo + "-" + ns.hi;
            Ui.text(dc, w - pad, y, rowF, Util.durShort(ns.dur) + "  " + tg, Ui.R, ns.type == StepType.INTERVAL ? Th.warn : Th.dim);
            Ui.text(dc, w * 46 / 100, y, rowF, "+" + Util.clock(inSec < 0 ? 0 : inSec), Ui.L, Th.dim);
            y += rowH;
            shown++;
        }
        if (shown == 0 && st != null) { Ui.text(dc, w / 2, y, rowF, "ostatni krok planu", Ui.C, Th.dim); }

        // --- D. stopka
        var left = e.planLeftSec();
        var ivDone = 0;
        for (var q = 0; q < e.series.size(); q++) { ivDone = Util.max(ivDone, e.series[q]["n"]); }
        var foot = "do końca " + Util.clock(left) + (e.intervalCount > 0 ? "  ·  interwały " + ivDone + "/" + e.intervalCount : "");
        Ui.text(dc, w / 2, h - footH + 2, xt, foot, Ui.C, Th.dim);
    }

    // ------------------------------------------------------------------ WYSIŁEK
    function effort(dc as Graphics.Dc, scr, r, e, top as Number, w as Number, h as Number) as Void {
        var pad = w / 28;
        var xt = Graphics.FONT_XTINY;
        var xtH = dc.getFontHeight(xt);
        var H = h - top;
        var m = e.m;
        var y = top + 2;
        Ui.text(dc, pad, y, Graphics.FONT_SMALL, "REZERWA W'", Ui.L, Th.accent);
        Ui.text(dc, w - pad, y + 3, xt, "W' " + (m.wPrime / 1000) + " kJ, CP " + m.ftp + " W", Ui.R, Th.dim);
        y += dc.getFontHeight(Graphics.FONT_SMALL) + 2;

        // --- bateria W'bal
        var pct = Util.clamp(m.wBalPct(), 0, 100);
        var col = pct < 25 ? Th.bad : (pct < 55 ? Th.warn : Th.good);
        var bh = Util.round(H * 0.17);
        var bw = w - 2 * pad - 8;
        Ui.fillRect(dc, pad, y, bw, bh, Th.line);
        Ui.fillRect(dc, pad + bw, y + bh / 4, 8, bh / 2, Th.line);
        Ui.fillRect(dc, pad + 3, y + 3, Util.max(0, (bw - 6) * pct / 100), bh - 6, col);
        Ui.value(dc, pad + bw / 2, y + bh / 2, bw - 12, bh - 6, "" + pct + "%", pct > 45 ? Th.bg : Th.fg);
        y += bh + 4;

        // --- ile wytrzymasz / odbudowa
        var p3 = Util.round(e.hist.avgP(3));
        var line1 = "";
        var c1 = Th.fg;
        if (r.hub.power == null) { line1 = "brak pomiaru mocy"; c1 = Th.dim; }
        else if (p3 > m.ftp + 5) {
            var tte = Util.round(m.wBal / (p3 - m.ftp));
            line1 = "przy " + p3 + " W wytrzymasz " + Util.clock(tte);
            c1 = tte < 60 ? Th.bad : Th.warn;
        } else {
            var rate = (m.ftp - p3) * (m.wPrime - m.wBal) / m.wPrime * 60.0 / m.wPrime * 100.0;
            line1 = pct >= 99 ? "rezerwa pełna" : "odbudowa +" + rate.format("%.1f") + "% / min";
            c1 = Th.good;
        }
        Ui.text(dc, w / 2, y, Graphics.FONT_TINY, line1, Ui.C, c1);
        y += dc.getFontHeight(Graphics.FONT_TINY);
        Ui.text(dc, w / 2, y, xt, "najniżej dziś " + Util.round(m.wBalMin * 100.0 / m.wPrime) + "%", Ui.C, Th.dim);
        y += xtH + 6;

        // --- strefy mocy: czas w Z1–Z7
        Ui.text(dc, pad, y, xt, "STREFY MOCY", Ui.L, Th.dim);
        y += xtH + 2;
        var zs = m.zones;
        var mx = 1;
        for (var z = 0; z < 7; z++) { if (zs[z] > mx) { mx = zs[z]; } }
        var cur = m.zoneOf(p3);
        var footH = Util.round(H * 0.14);
        var rowH = Util.max(8, (h - y - footH - 4) / 7);
        var lx = pad + dc.getTextWidthInPixels("Z7 ", xt);
        var tw = dc.getTextWidthInPixels("00:00 ", xt);
        var barW = w - lx - pad - tw;
        for (var z2 = 0; z2 < 7; z2++) {
            var ry = y + z2 * rowH;
            Ui.text(dc, pad, ry + (rowH - xtH) / 2, xt, "Z" + (z2 + 1), Ui.L, z2 == cur && r.hub.power != null ? Th.fg : Th.dim);
            var bl = Util.round(barW * zs[z2].toFloat() / mx);
            Ui.fillRect(dc, lx, ry + 2, Util.max(2, bl), rowH - 4, Th.zone(z2));
            if (z2 == cur && r.hub.power != null) { Ui.fillRect(dc, lx - 6, ry + 2, 3, rowH - 4, Th.fg); }
            Ui.text(dc, w - pad, ry + (rowH - xtH) / 2, xt, Util.clock(zs[z2]), Ui.R, Th.dim);
        }
        y += 7 * rowH + 4;

        // --- NP / IF / TSS
        var labels = ["NP", "IF", "TSS"];
        var vals = [m.np().format("%d"), m.intensity().format("%.2f"), m.tss().format("%d")];
        var cw = w / 3;
        dc.setColor(Th.line, Th.line);
        dc.fillRectangle(0, y, w, 1);
        var fh = h - y;
        for (var i = 0; i < 3; i++) {
            var cx = cw * i + cw / 2;
            Ui.text(dc, cx, y + 1, xt, labels[i], Ui.C, Th.dim);
            Ui.value(dc, cx, y + xtH + (fh - xtH) / 2, cw - 8, fh - xtH - 2, vals[i], Th.fg);
        }
    }

    // ------------------------------------------------------------------ PALIWO
    function fuel(dc as Graphics.Dc, scr, r, e, top as Number, w as Number, h as Number) as Void {
        var pad = w / 28;
        var xt = Graphics.FONT_XTINY;
        var xtH = dc.getFontHeight(xt);
        var tf = Graphics.FONT_TINY;
        var tH = dc.getFontHeight(tf);
        var H = h - top;
        var y = top + 2;
        var sec = e.s + 1;
        Ui.text(dc, pad, y, Graphics.FONT_SMALL, "PALIWO", Ui.L, Th.accent);
        Ui.text(dc, w - pad, y + 3, xt, "" + e.m.kJ() + " kcal", Ui.R, Th.dim);
        y += dc.getFontHeight(Graphics.FONT_SMALL) + 2;

        // --- glikogen: zapas ~6 g na kg masy, ubywa ze spalania, wraca z jedzenia (~85% się wchłania)
        var g0 = Cfg.weightKg * 6.0;
        var lvl = Util.clamp((g0 - r.choBurn + r.choEat * 0.85) / g0, 0.0, 1.0);
        var pct = Util.round(lvl * 100);
        var col = pct < 35 ? Th.bad : (pct < 60 ? Th.warn : Th.good);
        var bh = Util.round(H * 0.13);
        var bw = w - 2 * pad - 8;
        Ui.fillRect(dc, pad, y, bw, bh, Th.line);
        Ui.fillRect(dc, pad + bw, y + bh / 4, 8, bh / 2, Th.line);
        Ui.fillRect(dc, pad + 3, y + 3, Util.max(0, (bw - 6) * pct / 100), bh - 6, col);
        Ui.value(dc, pad + bw / 2, y + bh / 2, bw - 12, bh - 6, "glikogen ~" + pct + "%", pct > 50 ? Th.bg : Th.fg);
        y += bh + 6;

        // --- bilans
        var burn = Util.round(r.choBurn);
        Ui.text(dc, pad, y, tf, "spalone węgle", Ui.L, Th.dim);
        Ui.text(dc, w - pad, y, tf, "" + burn + " g", Ui.R, Th.fg);
        y += tH;
        Ui.text(dc, pad, y, tf, "zjedzone", Ui.L, Th.dim);
        Ui.text(dc, w - pad, y, tf, "" + r.choEat + " g", Ui.R, Th.fg);
        y += tH;
        // cel: 60–90 g/h po pierwszych 30 min (przy dłuższej jeździe); liczymy 75 g/h
        var need = sec > 1800 ? Util.round((sec - 1800) / 3600.0 * 75) : 0;
        var gap = need - r.choEat;
        var advice = "";
        var ac = Th.good;
        if (sec < 1800) { advice = "pierwsze 30 min: tylko picie"; ac = Th.dim; }
        else if (gap >= 20) { advice = "zjedz teraz ~" + (gap > 40 ? 40 : Util.r5(gap)) + " g"; ac = Th.warn; }
        else { advice = "na bieżąco (cel 75 g/h)"; }
        Ui.text(dc, pad, y, tf, "cel do teraz", Ui.L, Th.dim);
        Ui.text(dc, w - pad, y, tf, "" + need + " g", Ui.R, Th.fg);
        y += tH + 2;
        var af = Ui.fit(dc, advice, w - 2 * pad, 99, [Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY]);
        Ui.text(dc, w / 2, y, af, advice, Ui.C, ac);
        y += dc.getFontHeight(af) + 2;
        Ui.text(dc, w / 2, y, xt, "jedzenie " + Util.clock(sec - e.lastEat) + " temu  ·  picie " + Util.clock(sec - e.lastDrink) + " temu", Ui.C, Th.dim);
        y += xtH + 6;

        // --- przyciski
        var btnH = Util.max(30, (h - y - pad) / 2);
        if (btnH > H / 7) { btnH = H / 7; }
        var half = (w - 3 * pad) / 2;
        Ui.button(dc, pad, y, half, btnH, "ŻEL +25 g", Th.accent, Th.onAccent);
        scr.addHit(["gel", pad, y, half, btnH]);
        Ui.button(dc, 2 * pad + half, y, half, btnH, "BATON +40", Th.card, Th.fg);
        scr.addHit(["bar", 2 * pad + half, y, half, btnH]);
        y += btnH + pad / 2;
        if (y + btnH <= h) {
            Ui.button(dc, pad, y, w - 2 * pad, btnH, "PICIE (" + r.drinks + ")", Th.card, Th.fg);
            scr.addHit(["drink", pad, y, w - 2 * pad, btnH]);
        }
    }

    // ------------------------------------------------------------------ PODJAZD
    //! Kolor nachylenia jak w ClimbPro: do 3% zielony, 3–6 żółty, 6–9 pomarańczowy, 9–12 czerwony, dalej fiolet.
    function gradeColor(g) as Number {
        if (g < 3) { return Th.good; }
        if (g < 6) { return 0xFFD23F; }
        if (g < 9) { return 0xFF8A1F; }
        if (g < 12) { return Th.bad; }
        return 0xB45CFF;
    }

    function climb(dc as Graphics.Dc, scr, r, e, top as Number, w as Number, h as Number) as Void {
        var pad = w / 28;
        var xt = Graphics.FONT_XTINY;
        var xtH = dc.getFontHeight(xt);
        var H = h - top;
        var nav = r.nav;
        var c = nav.course;
        var y = top + 2;
        var nc = nav.acquired ? nav.nextClimb() : (c.climbs.size() > 0 ? [0, c.climbs[0][0], c.climbs[0][1]] : null);
        if (nc == null) {
            Ui.text(dc, w / 2, top + H / 3, Graphics.FONT_MEDIUM, "Bez podjazdów", Ui.C, Th.good);
            Ui.text(dc, w / 2, top + H / 3 + dc.getFontHeight(Graphics.FONT_MEDIUM), xt, "do mety " + (nav.left() / 1000.0).format("%.1f") + " km", Ui.C, Th.dim);
            return;
        }
        var cl = c.climbs[nc[0]];
        var onIt = nc[1] == 0;
        var len = cl[1] - cl[0];
        // --- A. nagłówek
        Ui.text(dc, pad, y, Graphics.FONT_SMALL, "PODJAZD " + (nc[0] + 1) + "/" + c.climbs.size(), Ui.L, onIt ? Th.warn : Th.accent);
        Ui.text(dc, w - pad, y + 3, xt, (len / 1000.0).format("%.1f") + " km  " + Util.round(cl[3] / 10.0) + "%  +" + cl[2] + " m", Ui.R, Th.dim);
        y += dc.getFontHeight(Graphics.FONT_SMALL) + 2;
        var big = onIt ? Ui.meters(nc[2]) : Ui.meters(nc[1]);
        var lab = onIt ? "DO SZCZYTU" : "START ZA";
        Ui.text(dc, pad, y, xt, lab, Ui.L, Th.dim);
        var bh = Util.round(H * 0.12);
        Ui.value(dc, w / 2, y + xtH + bh / 2, w - 2 * pad, bh, big, onIt ? Th.warn : Th.fg);
        y += xtH + bh + 2;

        // --- B. profil podjazdu w kolorach nachylenia
        var ph = Util.round(H * 0.30);
        var cols = 24;
        var cwid = (w - 2 * pad) / cols;
        var seg = len.toFloat() / cols;
        var e0 = c.eleAt(cl[0]);
        var e1 = c.eleAt(cl[1]);
        if (e0 == null || e1 == null) { e0 = 0.0; e1 = cl[2].toFloat(); }
        var lo = e0;
        var hi = Util.max(e1, e0 + 30.0);
        var prevE = e0;
        for (var k = 0; k < cols; k++) {
            var ek = c.eleAt(cl[0] + seg * (k + 1));
            if (ek == null) { ek = e0 + (e1 - e0) * (k + 1) / cols; }
            var g = seg > 0 ? (ek - prevE) / seg * 100.0 : 0.0;
            var top2 = Util.round((ek - lo) * (ph - 4) / (hi - lo)) + 4;
            var done = nav.progress >= cl[0] + seg * (k + 1);
            Ui.fillRect(dc, pad + k * cwid, y + ph - top2, cwid - 1, top2, done ? Th.line : gradeColor(g));
            prevE = ek;
        }
        if (onIt) {
            var mx = pad + Util.round((nav.progress - cl[0]) * (cols * cwid) / len);
            Ui.fillRect(dc, Util.clamp(mx - 1, pad, pad + cols * cwid - 2), y - 2, 3, ph + 4, Th.fg);
        }
        Ui.text(dc, pad, y + ph + 1, xt, "" + Util.round(e0) + " m", Ui.L, Th.dim);
        Ui.text(dc, w - pad, y + ph + 1, xt, "" + Util.round(e1) + " m", Ui.R, Th.dim);
        y += ph + xtH + 4;

        // --- C. co przed nami: nachylenie najbliższych 300 m, pozostałe przewyższenie, cel mocy
        var from = onIt ? nav.progress : cl[0];
        var ea = c.eleAt(from);
        var eb = c.eleAt(from + 300);
        var ahead = (ea != null && eb != null) ? Util.round((eb - ea) / 3.0) : Util.round(cl[3] / 10.0);
        var remGain = (onIt && ea != null && e1 != null) ? Util.round(e1 - ea) : cl[2];
        var tf = Graphics.FONT_TINY;
        var tH = dc.getFontHeight(tf);
        Ui.text(dc, pad, y, tf, "najbliższe 300 m", Ui.L, Th.dim);
        Ui.text(dc, w - pad, y, tf, "" + ahead + "%", Ui.R, gradeColor(ahead));
        y += tH;
        Ui.text(dc, pad, y, tf, "w górę zostało", Ui.L, Th.dim);
        Ui.text(dc, w - pad, y, tf, "+" + (remGain < 0 ? 0 : remGain) + " m", Ui.R, Th.fg);
        y += tH;
        if (cl[4] > 0) {
            var p3 = Util.round(e.hist.avgP(3));
            Ui.text(dc, pad, y, tf, "cel " + cl[4] + "-" + cl[5] + " W", Ui.L, Th.accent);
            Ui.text(dc, w - pad, y, tf, r.hub.power == null ? "--" : "" + p3 + " W", Ui.R, Fields.powerColor(r, p3));
            y += tH;
        }
        y += 4;
        dc.setColor(Th.line, Th.line);
        dc.fillRectangle(pad, y, w - 2 * pad, 1);
        y += 4;

        // --- D. kolejne podjazdy
        for (var i = nc[0] + 1; i < c.climbs.size() && y + xtH <= h; i++) {
            var n2 = c.climbs[i];
            var inM = n2[0] - nav.progress;
            Ui.fillRect(dc, pad, y + 3, 4, xtH - 4, gradeColor(n2[3] / 10.0));
            Ui.text(dc, pad + 8, y, xt, "za " + (inM / 1000.0).format("%.1f") + " km", Ui.L, Th.fg);
            Ui.text(dc, w - pad, y, xt, ((n2[1] - n2[0]) / 1000.0).format("%.1f") + " km  " + Util.round(n2[3] / 10.0) + "%  +" + n2[2] + " m", Ui.R, Th.dim);
            y += xtH + 2;
        }
    }

    // ------------------------------------------------------------------ kolorowe krawędzie (TRENING)
    function edges(dc as Graphics.Dc, r, e, top as Number, w as Number, h as Number) as Void {
        if (r.hub.power == null) { return; }
        var p3 = Util.round(e.hist.avgP(3));
        var col = Fields.powerColor(r, p3);
        var y = top + Util.round((h - top) * 0.13);
        Ui.fillRect(dc, 0, y, 4, h - y, col);
        Ui.fillRect(dc, w - 4, y, 4, h - y, col);
    }
}
