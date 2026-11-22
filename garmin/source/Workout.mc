import Toybox.Lang;

//! Rodzaje kroków – kolejność jak w API (/api/garmin/sync) i w telefonie (StepType).
module StepType {
    const WARMUP = 0;
    const INTERVAL = 1;
    const RECOVERY = 2;
    const STEADY = 3;
    const COOLDOWN = 4;
    const FREE = 5;       // tylko do opisu lapów / ekranu (jazda swobodna, po planie)

    function key(t as Number) as String {
        if (t == WARMUP) { return "warmup"; }
        if (t == INTERVAL) { return "interval"; }
        if (t == RECOVERY) { return "recovery"; }
        if (t == STEADY) { return "steady"; }
        if (t == COOLDOWN) { return "cooldown"; }
        return "free";
    }

    function label(t as Number) as String {
        if (t == WARMUP) { return "Rozgrzewka"; }
        if (t == INTERVAL) { return "Interwał"; }
        if (t == RECOVERY) { return "Przerwa"; }
        if (t == STEADY) { return "Jazda"; }
        if (t == COOLDOWN) { return "Schłodzenie"; }
        return "Jazda swobodna";
    }
}

class WStep {
    var name as String = "";
    var type as Number = 3;
    var dur as Number = 0;       // s
    var lo as Number = 0;        // W
    var hi as Number = 0;        // W
    var cadLo as Number = 0;     // 0 = bez zakresu kadencji
    var cadHi as Number = 0;
    var start as Number = 0;     // 0 domyślnie, 1 auto (po mocy), 2 z zegarem
    var hrLo as Number = 0;      // 0 = brak
    var hrHi as Number = 0;

    function initialize() {}
}

//! Skrypt treningu wykonywany przez silnik. Pusta lista kroków = jazda swobodna.
class Workout {
    var id as String = "free";
    var name as String = "Jazda swobodna";
    var type as String = "";
    var date as String = "";
    var ftp as Number = 250;
    var tss as Number = 0;
    var weightKg as Number = 75;
    var steps as Array<WStep>;
    // odprawa (gotowość z PMC / WHOOP, model tętna HR = hrA + hrB·W)
    var readiness = null;
    var readyState as String = "";
    var yTss as Number = 0;
    var recovery = null;
    var hrA = null;
    var hrB = null;

    function initialize() {
        steps = [] as Array<WStep>;
    }

    function totalSec() as Number {
        var t = 0;
        for (var i = 0; i < steps.size(); i++) { t += steps[i].dur; }
        return t;
    }

    function isFree() as Boolean {
        return steps.size() == 0;
    }

    //! Dodanie kroku „z ręki” (testy, trening awaryjny bez synchronizacji).
    function add(name as String, type as Number, dur as Number, lo as Number, hi as Number) as WStep {
        var st = new WStep();
        st.name = name; st.type = type; st.dur = dur; st.lo = lo; st.hi = hi;
        steps.add(st);
        return st;
    }

    //! Z odpowiedzi serwera: { id, name, type, date, tss, steps: [[name,type,dur,lo,hi,cadLo,cadHi,start,hrLo,hrHi], …] }.
    //! Zwraca null, gdy dane są nie do użycia.
    static function fromDict(d, ftp as Number, weightKg as Number) {
        if (d == null || !(d instanceof Dictionary)) { return null; }
        var w = new Workout();
        w.id = Util.str(d.get("id"), "plan");
        w.name = Util.str(d.get("name"), "Trening");
        w.type = Util.str(d.get("type"), "");
        w.date = Util.str(d.get("date"), "");
        w.tss = Util.int(d.get("tss"), 0);
        w.ftp = Util.int(d.get("ftp"), ftp);
        if (w.ftp < 50) { w.ftp = ftp; }
        w.weightKg = weightKg;
        var arr = d.get("steps");
        if (arr == null || !(arr instanceof Array)) { return null; }
        for (var i = 0; i < arr.size(); i++) {
            var a = arr[i];
            if (a == null || !(a instanceof Array) || a.size() < 5) { continue; }
            var st = new WStep();
            st.name = Util.str(a[0], "Krok");
            st.type = Util.int(a[1], StepType.STEADY);
            if (st.type < 0 || st.type > 4) { st.type = StepType.STEADY; }
            st.dur = Util.int(a[2], 0);
            st.lo = Util.int(a[3], 0);
            st.hi = Util.int(a[4], 0);
            if (a.size() > 6) { st.cadLo = Util.int(a[5], 0); st.cadHi = Util.int(a[6], 0); }
            if (a.size() > 7) { st.start = Util.int(a[7], 0); }
            if (a.size() > 9) { st.hrLo = Util.int(a[8], 0); st.hrHi = Util.int(a[9], 0); }
            if (st.dur <= 0 || st.lo > st.hi) { continue; }
            w.steps.add(st);
        }
        return w;
    }

    function applyBrief(b) as Void {
        if (b == null || !(b instanceof Dictionary)) { return; }
        readiness = Util.num(b.get("readiness"), null);
        readyState = Util.str(b.get("state"), "");
        yTss = Util.int(b.get("yTss"), 0);
        recovery = Util.num(b.get("recovery"), null);
        hrA = Util.num(b.get("hrA"), null);
        hrB = Util.num(b.get("hrB"), null);
    }
}
