import Toybox.Lang;
import Toybox.Math;

//! Liczniki całej jazdy liczone przyrostowo co sekundę aktywnego czasu:
//! średnie, NP/IF/TSS, praca, krzywa mocy (5 s – 60 min), W'bal, czas w strefach.
class Metrics {
    var ftp as Number;
    var n as Number = 0;             // sekundy aktywne
    var sumP as Long = 0l;
    var maxP as Number = 0;
    var sumHr as Number = 0;
    var nHr as Number = 0;
    var maxHr as Number = 0;
    var sumCad as Number = 0;
    var nCad as Number = 0;

    hidden var _roll30 as Number = 0;
    hidden var _acc4 as Double = 0.0d;
    hidden var _cnt4 as Number = 0;

    var windows as Array<Number> = [5, 60, 300, 1200, 3600] as Array<Number>;
    hidden var _wSum as Array<Number> = [0, 0, 0, 0, 0] as Array<Number>;
    var best as Array<Number> = [0, 0, 0, 0, 0] as Array<Number>;

    // W'bal (model Skiby, CP ≈ FTP)
    var wPrime as Number = 20000;    // J
    var wBal as Float = 20000.0;
    var wBalMin as Float = 20000.0;

    var zones as Array<Number> = [0, 0, 0, 0, 0, 0, 0] as Array<Number>;   // s w strefach Z1–Z7

    function initialize(ftpW as Number, wPrimeJ as Number) {
        ftp = ftpW > 0 ? ftpW : 250;
        wPrime = wPrimeJ > 1000 ? wPrimeJ : 20000;
        wBal = wPrime.toFloat();
        wBalMin = wBal;
    }

    //! Wołane PO hist.push – s = hist.last.
    function add(hist as Hist, p as Number, hr, cad) as Void {
        var s = hist.last;
        n++;
        sumP += p;
        if (p > maxP) { maxP = p; }
        if (hr != null && hr > 0) { sumHr += hr; nHr++; if (hr > maxHr) { maxHr = hr; } }
        if (cad != null && cad > 0) { sumCad += cad; nCad++; }

        // NP: średnia krocząca 30 s do czwartej potęgi
        _roll30 += p;
        if (s >= 30) { _roll30 -= hist.p(s - 30); }
        if (s >= 29) {
            var r = _roll30.toDouble() / 30.0d;
            _acc4 += r * r * r * r;
            _cnt4++;
        }

        // krzywa mocy
        for (var j = 0; j < windows.size(); j++) {
            var w = windows[j];
            _wSum[j] += p;
            if (s >= w) { _wSum[j] -= hist.p(s - w); }
            if (s >= w - 1) {
                var a = Util.round(_wSum[j].toFloat() / w);
                if (a > best[j]) { best[j] = a; }
            }
        }

        // W'bal
        if (p > ftp) {
            wBal -= (p - ftp);
        } else {
            wBal += (ftp - p) * (wPrime - wBal) / wPrime;
        }
        if (wBal > wPrime) { wBal = wPrime.toFloat(); }
        if (wBal < wBalMin) { wBalMin = wBal; }

        zones[zoneOf(p)]++;
    }

    //! Strefa mocy Coggana 0..6 (Z1–Z7).
    function zoneOf(p as Number) as Number {
        var r = p.toFloat() / ftp;
        if (r < 0.56) { return 0; }
        if (r < 0.76) { return 1; }
        if (r < 0.91) { return 2; }
        if (r < 1.06) { return 3; }
        if (r < 1.21) { return 4; }
        if (r < 1.51) { return 5; }
        return 6;
    }

    function avgPower() as Number {
        return n > 0 ? Util.round(sumP.toDouble() / n) : 0;
    }

    function np() as Number {
        if (_cnt4 <= 0) { return avgPower(); }
        return Util.round(Math.pow(_acc4 / _cnt4, 0.25d));
    }

    function intensity() as Float {
        return np().toFloat() / ftp;
    }

    function tss() as Number {
        var x = np();
        return Util.round((n.toFloat() * x * x) / (ftp.toFloat() * ftp * 3600.0) * 100.0);
    }

    function kJ() as Number {
        return (sumP / 1000l).toNumber();
    }

    function avgHr() as Number {
        return nHr > 0 ? Util.round(sumHr.toFloat() / nHr) : 0;
    }

    function avgCad() as Number {
        return nCad > 0 ? Util.round(sumCad.toFloat() / nCad) : 0;
    }

    function wBalPct() as Number {
        return Util.round(wBal * 100.0 / wPrime);
    }
}
