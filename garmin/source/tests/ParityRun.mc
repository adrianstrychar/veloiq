import Toybox.Lang;
import Toybox.Test;

// Testy zgodności silnika na Garmina z silnikiem referencyjnym z telefonu (lib/ride/flex-engine.ts).
// Dane oczekiwane generuje garmin/ci/parity/gen.ts → ParityData.mc.

(:test)
class ParityListener {
    var eng = null;
    var cues = [];      // płasko: [s, klucz, s, klucz, …]

    function initialize() {}

    function onCue(kind, key, text, vars) {
        // „endCount” to sygnał 3-2-1 dodany tylko na liczniku – silnik telefonu go nie ma
        if (!key.equals("endCount")) { cues.add(eng.s); cues.add(key); }
    }
    function onStepLap(idx) {}
    function onPlanDone() {}
    function onFalseStart() {}
    function onSeries(r) {}
    function onEffort(on, e) {}
}

(:test)
module ParityRun {

    function flat(a) as String {
        var s = "";
        for (var i = 0; i < a.size(); i++) { s = s + (i > 0 ? " " : "") + a[i]; }
        return s;
    }

    function check(logger as Test.Logger, ftp, steps, segs, actions, expCues, expSeries, expEfforts, expLaps, expSum) as Boolean {
        var wk;
        if (steps.size() > 0) {
            wk = Workout.fromDict({ "id" => "t", "name" => "t", "steps" => steps }, ftp, 75);
        } else {
            wk = new Workout();
        }
        wk.ftp = ftp;
        var eng = new Engine(wk, 20000);
        var lis = new ParityListener();
        lis.eng = eng;
        eng.listener = lis;

        var i = 0;
        for (var g = 0; g < segs.size(); g++) {
            var seg = segs[g];
            var dur = seg[0];
            var pw = seg[1];
            var cad = seg[2] >= 0 ? seg[2] : null;
            var hr = seg[3] > 0 ? seg[3] : null;
            for (var k = 0; k < dur; k++) {
                var p = 0;
                if (pw > 0) {
                    p = pw + (seg[4] == 1 ? ((i * 7919) % 11) - 5 : 0);
                    if (p < 0) { p = 0; }
                }
                eng.tick(p, hr, cad);
                for (var a = 0; a < actions.size(); a += 2) {
                    if (actions[a] == i) {
                        if (actions[a + 1] == 1) { eng.skipStep(); } else { eng.cancelStart(); }
                    }
                }
                i++;
            }
        }

        var ok = true;

        // --- komunikaty (sekunda + klucz)
        var cues = lis.cues;
        var same = cues.size() == expCues.size();
        for (var c = 0; same && c < cues.size(); c += 2) {
            if (cues[c] != expCues[c] || !cues[c + 1].equals(expCues[c + 1])) { same = false; }
        }
        if (!same) {
            ok = false;
            logger.debug("CUES got: " + flat(cues));
            logger.debug("CUES exp: " + flat(expCues));
        }

        // --- serie
        var ser = eng.series;
        if (ser.size() != expSeries.size()) {
            ok = false;
            logger.debug("SERIES count " + ser.size() + " exp " + expSeries.size());
        }
        var vrd = { "ok" => 0, "high" => 1, "low" => 2 };
        for (var x = 0; x < ser.size() && x < expSeries.size(); x++) {
            var r = ser[x];
            var got = [r["n"], r["durationSec"], r["plannedSec"], r["avgPower"], r["compliancePct"], r["startSec"],
                vrd[r["verdict"]], r["deltaW"], r["endedEarly"] ? 1 : 0,
                r.hasKey("restBeforeSec") ? r["restBeforeSec"] : -1, r.hasKey("avgHr") ? r["avgHr"] : -1];
            var e = expSeries[x];
            var eq = true;
            for (var f = 0; f < got.size(); f++) { if (got[f] != e[f]) { eq = false; } }
            if (!eq) {
                ok = false;
                logger.debug("SERIES " + x + " got: " + flat(got));
                logger.debug("SERIES " + x + " exp: " + flat(e));
            }
        }

        // --- wysiłki
        var eff = eng.allEfforts();
        var effFlat = [];
        for (var y = 0; y < eff.size(); y++) {
            effFlat.add(eff[y]["startSec"]); effFlat.add(eff[y]["durationSec"]); effFlat.add(eff[y]["avgPower"]);
        }
        var expEffFlat = [];
        for (var z = 0; z < expEfforts.size(); z++) { expEffFlat.addAll(expEfforts[z]); }
        if (!flat(effFlat).equals(flat(expEffFlat))) {
            ok = false;
            logger.debug("EFFORTS got: " + flat(effFlat));
            logger.debug("EFFORTS exp: " + flat(expEffFlat));
        }

        // --- lapy
        var lapFlat = [];
        for (var l = 0; l < eng.laps.size(); l++) { lapFlat.add(eng.laps[l]["startSec"]); lapFlat.add(eng.laps[l]["type"]); }
        if (!flat(lapFlat).equals(flat(expLaps))) {
            ok = false;
            logger.debug("LAPS got: " + flat(lapFlat));
            logger.debug("LAPS exp: " + flat(expLaps));
        }

        // --- podsumowanie
        var sum = [eng.m.n, eng.m.avgPower(), eng.m.np(), eng.m.kJ(), eng.compliancePct(), eng.m.avgHr(), eng.m.maxHr];
        if (!flat(sum).equals(flat(expSum))) {
            ok = false;
            logger.debug("SUMMARY got: " + flat(sum));
            logger.debug("SUMMARY exp: " + flat(expSum));
        }
        return ok;
    }
}
