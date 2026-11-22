import Toybox.Lang;
import Toybox.System;

//! Historia 1 Hz ostatniej godziny (moc, tętno, kadencja) w pierścieniu bajtów.
//! Silnik zagląda wstecz najwyżej o HIST_CAP sekund (okno 60 min do krzywej mocy).
class Hist {
    const CAP = 3700;
    hidden var _buf as ByteArray;
    var last as Number = -1;     // indeks (sekunda) ostatniego wpisu

    function initialize() {
        _buf = new [CAP * 4]b;
    }

    function push(p as Number, hr, cad) as Void {
        last++;
        var o = (last % CAP) * 4;
        if (p < 0) { p = 0; }
        if (p > 65534) { p = 65534; }
        _buf[o] = p & 0xFF;
        _buf[o + 1] = (p >> 8) & 0xFF;
        _buf[o + 2] = (hr == null || hr <= 0) ? 0 : (hr > 255 ? 255 : hr);
        _buf[o + 3] = (cad == null || cad < 0) ? 255 : (cad > 254 ? 254 : cad);
    }

    function has(i as Number) as Boolean {
        return i >= 0 && i <= last && (last - i) < CAP;
    }

    //! Moc w sekundzie i (0, gdy poza historią).
    function p(i as Number) as Number {
        if (!has(i)) { return 0; }
        var o = (i % CAP) * 4;
        return _buf[o] | (_buf[o + 1] << 8);
    }

    //! Tętno w sekundzie i albo 0 (brak).
    function hr(i as Number) as Number {
        if (!has(i)) { return 0; }
        return _buf[(i % CAP) * 4 + 2];
    }

    //! Kadencja w sekundzie i albo -1 (brak).
    function cad(i as Number) as Number {
        if (!has(i)) { return -1; }
        var c = _buf[(i % CAP) * 4 + 3];
        return c == 255 ? -1 : c;
    }

    //! Średnia moc z ostatnich n sekund (do sekundy `last` włącznie).
    function avgP(n as Number) as Float {
        if (last < 0) { return 0.0; }
        if (n > last + 1) { n = last + 1; }
        if (n > CAP) { n = CAP; }
        if (n <= 0) { return 0.0; }
        var sum = 0;
        for (var i = last - n + 1; i <= last; i++) { sum += p(i); }
        return sum.toFloat() / n;
    }

    //! Średnie tętno z ostatnich n sekund; null, gdy mniej niż połowa odczytów.
    function avgHr(n as Number) {
        var sum = 0;
        var cnt = 0;
        for (var i = last - n + 1; i <= last; i++) {
            var h = hr(i);
            if (h > 0) { sum += h; cnt++; }
        }
        var need = n / 2;
        if (need < 1) { need = 1; }
        if (cnt < need) { return null; }
        return Util.round(sum.toFloat() / cnt);
    }
}

//! Rosnący zapis rekordów o stałej długości w blokach bajtów. Jeden blok = jedna paczka wysyłki
//! (2250 B → 3000 znaków base64), więc po jeździe nic nie trzeba przepakowywać.
class BlockStore {
    hidden var _rec as Number;
    hidden var _perBlock as Number;
    hidden var _blocks as Array<ByteArray>;
    hidden var _cur as ByteArray;
    var count as Number = 0;
    var full as Boolean = false;     // brak pamięci – kolejne rekordy są pomijane

    function initialize(recSize as Number, blockBytes as Number) {
        _rec = recSize;
        _perBlock = blockBytes / recSize;
        _blocks = [] as Array<ByteArray>;
        _cur = []b;
    }

    function add(rec as ByteArray) as Void {
        if (full) { return; }
        if (_cur.size() >= _perBlock * _rec) {
            // brak pamięci nie jest w Monkey C wyjątkiem do złapania – sprawdzamy zapas przed nowym blokiem
            if (System.getSystemStats().freeMemory < 48000) { full = true; return; }
            _blocks.add(_cur);
            _cur = []b;
        }
        _cur.addAll(rec);
        count++;
    }

    function blockCount() as Number {
        return _blocks.size() + (_cur.size() > 0 ? 1 : 0);
    }

    function block(i as Number) as ByteArray {
        if (i < _blocks.size()) { return _blocks[i]; }
        return _cur;
    }
}
