import Toybox.Lang;
import Toybox.Math;
import Toybox.StringUtil;
import Toybox.System;

// Drobne funkcje pomocnicze (liczby, czas, tekst). Bez stanu.
module Util {

    function min(a, b) { return a < b ? a : b; }
    function max(a, b) { return a > b ? a : b; }
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function abs(v) { return v < 0 ? -v : v; }

    //! Zaokrąglenie do najbliższej liczby całkowitej (także dla ujemnych).
    function round(v) as Number {
        if (v instanceof Number) { return v; }
        return (v >= 0 ? (v + 0.5) : (v - 0.5)).toNumber();
    }

    //! Zaokrąglenie do 5 W, minimum 5 (jak r5 w silniku telefonu).
    function r5(v) as Number {
        var r = round(v / 5.0) * 5;
        return r < 5 ? 5 : r;
    }

    //! "m:ss" albo "h:mm:ss".
    function clock(sec) as String {
        if (sec == null) { return "--:--"; }
        var s = sec < 0 ? 0 : round(sec);
        var h = s / 3600;
        var m = (s % 3600) / 60;
        var r = s % 60;
        if (h > 0) { return h.format("%d") + ":" + m.format("%02d") + ":" + r.format("%02d"); }
        return m.format("%d") + ":" + r.format("%02d");
    }

    function polForm(n as Number, one as String, few as String, many as String) as String {
        if (n == 1) { return "1 " + one; }
        var l = n % 10;
        var l2 = n % 100;
        return n.format("%d") + " " + ((l >= 2 && l <= 4 && !(l2 >= 12 && l2 <= 14)) ? few : many);
    }

    //! Czas słownie po polsku: "2 minuty 30 sekund" (jak durationPl w telefonie).
    function durationPl(sec) as String {
        var t = sec < 0 ? 0 : round(sec);
        var m = t / 60;
        var s = t % 60;
        if (m == 0) { return polForm(s, "sekunda", "sekundy", "sekund"); }
        if (s == 0) { return polForm(m, "minuta", "minuty", "minut"); }
        return polForm(m, "minuta", "minuty", "minut") + " " + polForm(s, "sekunda", "sekundy", "sekund");
    }

    //! Krótko: "20 min", "4:30", "45 s".
    function durShort(sec) as String {
        var t = sec < 0 ? 0 : round(sec);
        if (t < 60) { return t.format("%d") + " s"; }
        if (t % 60 == 0) { return (t / 60).format("%d") + " min"; }
        return clock(t);
    }

    //! Podmiana {klucz} wartościami ze słownika.
    function render(tpl as String, vars as Dictionary) as String {
        var out = "";
        var rest = tpl;
        while (true) {
            var a = rest.find("{");
            if (a == null) { break; }
            var tail = rest.substring(a + 1, rest.length());
            var b = tail.find("}");
            if (b == null) { break; }
            var key = tail.substring(0, b);
            var val = vars.get(key);
            out = out + rest.substring(0, a) + (val == null ? "" : val.toString());
            rest = tail.substring(b + 1, tail.length());
        }
        return out + rest;
    }

    function num(v, dflt) {
        if (v == null) { return dflt; }
        if (v instanceof Number || v instanceof Float) { return v; }
        if (v instanceof Long || v instanceof Double) { return v.toNumber(); }
        if (v instanceof String) { var n = v.toFloat(); return n == null ? dflt : n; }
        if (v instanceof Boolean) { return v ? 1 : 0; }
        return dflt;
    }

    function int(v, dflt as Number) as Number {
        var n = num(v, null);
        if (n == null) { return dflt; }
        return round(n);
    }

    function str(v, dflt as String) as String {
        if (v == null) { return dflt; }
        return v.toString();
    }

    function b64(bytes as ByteArray) as String {
        if (bytes.size() == 0) { return ""; }
        return StringUtil.convertEncodedString(bytes, {
            :fromRepresentation => StringUtil.REPRESENTATION_BYTE_ARRAY,
            :toRepresentation => StringUtil.REPRESENTATION_STRING_BASE64
        });
    }

    function unb64(s as String) as ByteArray {
        if (s.length() == 0) { return []b; }
        return StringUtil.convertEncodedString(s, {
            :fromRepresentation => StringUtil.REPRESENTATION_STRING_BASE64,
            :toRepresentation => StringUtil.REPRESENTATION_BYTE_ARRAY
        }) as ByteArray;
    }

    //! Skrót tekstu do n znaków z wielokropkiem.
    function ellipsis(s as String, n as Number) as String {
        if (s.length() <= n) { return s; }
        return s.substring(0, n - 2) + "..";
    }
}
