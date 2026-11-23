import Toybox.Lang;

//! Fazy silnika (jak RidePhase w telefonie; pauzę ręczną trzyma kontroler jazdy).
module Phase {
    const RUNNING = 0;      // krok trwa
    const ARMED = 1;        // za chwilę interwał, czekam na start
    const WAITING = 2;      // przerwa się przeciąga
    const AUTOPAUSED = 3;   // postój w interwale
    const FREE = 4;         // po planie / jazda swobodna

    function key(p as Number) as String {
        if (p == ARMED) { return "armed"; }
        if (p == WAITING) { return "waiting"; }
        if (p == AUTOPAUSED) { return "autoPaused"; }
        if (p == FREE) { return "free"; }
        return "running";
    }
}

//! Silnik treningu VeloIQ w trybie elastycznym – port lib/ride/flex-engine.ts (ta sama logika,
//! te same progi), przepisany na liczniki przyrostowe, żeby zmieścić się w pamięci i limicie
//! czasu wykonania Connect IQ. tick() = jedna sekunda aktywnego czasu.
//!
//! Interwały ze startem „auto” nie ruszają z zegarem: silnik je zapowiada, czuwa i wykrywa
//! faktyczny start po mocy (cofając początek do pierwszej sekundy wzrostu). Do tego: falstart,
//! auto-pauza w interwale, wcześniejsze przerwanie, podsumowania serii, a po planie i w jeździe
//! swobodnej – automatyczne wykrywanie wysiłków.
class Engine {
    // ---- reguły (DEFAULT_FLEX_RULES)
    var armLeadSec = 60;
    var autoStartPct = 0.85;
    var autoStartSec = 6;
    var waitRemindSec = 120;
    var autoPauseWatts = 30;
    var autoPauseSec = 5;
    var resumeSec = 2;
    var earlyStopPct = 0.6;
    var earlyStopSec = 40;
    var earlyStopAvgSec = 10;
    var effortStartPct = 0.88;
    var effortEndPct = 0.72;
    var effortMinSec = 120;
    var effortGapSec = 45;
    var outOfRangeSec = 15;
    var cooldownSec = 60;
    var graceSec = 10;
    var praiseAfterSec = 90;
    var cadenceGraceSec = 20;
    var hrDriftBpm = 5;
    var corrWindowMinSec = 20;
    var corrWindowMaxSec = 60;
    var corrGraceMinSec = 20;
    var corrGraceMaxSec = 60;
    var cooldownMaxSec = 180;
    var deadbandW = 10;
    var deadbandPct = 0.03;
    var minDeltaW = 10;
    var hrMarginBpm = 3;
    var hrAlertSec = 60;
    var hrGraceSec = 240;
    var hrCooldownSec = 300;
    var statusEverySec = 600;
    var statusMinStepSec = 1200;

    const QUIET_AFTER_STOP_SEC = 20;
    const FS_MAX_SEC = 60;
    const FS_PCT = 0.6;
    const FS_STOP_SEC = 15;
    const FS_EASE_SEC = 15;
    const FS_AVG_SEC = 10;
    const FUEL_DRINK_SEC = 1200;
    const BRIEF_READY_SEC = 150;
    const BRIEF_COND_FROM = 360;
    const BRIEF_COND_SEC = 600;
    const WIN = 128;
    const ACT = 64;

    // ---- dane
    var wk as Workout;
    var hist as Hist;
    var m as Metrics;
    var listener = null;         // onCue(kind, key, text, vars), onStepLap(stepType), onPlanDone()
    hidden var _phr;

    // ---- stan kroku
    var s as Number = -1;
    var phase as Number = 0;
    var stepIdx as Number = 0;
    var stepStartSec as Number = 0;
    var inStep as Number = 0;            // aktywne sekundy w kroku (bez auto-pauzy)
    hidden var _stepCnt as Number = 0;   // sekundy faktycznie zsumowane w licznikach
    hidden var _stepSum as Number = 0;
    hidden var _movSum as Number = 0;
    hidden var _movN as Number = 0;
    hidden var _hrSum as Number = 0;
    hidden var _hrN as Number = 0;
    hidden var _winP as Array<Number>;
    hidden var _winF as ByteArray;
    hidden var _inR as Number = 0;
    hidden var _tolC as Float = 10.0;
    hidden var _act as Array<Number>;
    hidden var _actN as Number = 0;
    hidden var _cumSum as Number = 0;
    hidden var _cumN as Number = 0;

    hidden var _startRun = 0;
    hidden var _startRunAt = 0;
    hidden var _startDips = 0;
    hidden var _lowRun = 0;
    hidden var _easeRun = 0;
    hidden var _resumeRun = 0;
    hidden var _outHigh = 0;
    hidden var _outLow = 0;
    hidden var _inRangeStreak = 0;
    hidden var _cadLowRun = 0;
    hidden var _cadHighRun = 0;
    hidden var _lastCorrection = -1000000;
    hidden var _spoke;
    hidden var _lastRestSec = null;

    // falstart
    hidden var _snapOn as Boolean = false;
    hidden var _snapIdx = 0;
    hidden var _snapStart = 0;
    hidden var _snapRest = null;
    hidden var _fsStopRun = 0;
    hidden var _fsEaseRun = 0;
    hidden var _needRearm as Boolean = false;
    hidden var _rearmLow = 0;

    // serie, wysiłki, lapy
    var series;      // wyniki serii (te same pola co SeriesResult w telefonie)
    var efforts;     // wysiłki wykryte w jeździe swobodnej
    var laps;        // znaczniki lapów: { startSec, name, type }
    hidden var _inEffort as Boolean = false;
    hidden var _effortStart = 0;
    hidden var _effortPending = -1;
    hidden var _effSum = 0;
    hidden var _ivNo;
    hidden var _total as Number = 0;
    var intervalCount as Number = 0;
    hidden var _chainAnnounced as Boolean = false;
    hidden var _chainStart = 0;
    hidden var _spokeHr as Boolean = false;

    // tętno / korekty / jedzenie
    hidden var _hrHighRun = 0;
    hidden var _quietUntil = -1;
    hidden var _corrRepeat = 0;
    hidden var _lastCorrDir = 0;
    hidden var _lastHrAlert = -1000000;
    hidden var _hrRecStart = null;
    var lastDrink as Number = 0;
    var lastEat as Number = 0;

    function initialize(workout as Workout, wPrimeJ as Number) {
        wk = workout;
        hist = new Hist();
        m = new Metrics(workout.ftp, wPrimeJ);
        _phr = Phrases.table();
        _winP = new [WIN] as Array<Number>;
        for (var i = 0; i < WIN; i++) { _winP[i] = 0; }
        _winF = new [WIN]b;
        _act = new [ACT] as Array<Number>;
        for (var j = 0; j < ACT; j++) { _act[j] = 0; }
        _spoke = {};
        series = [];
        efforts = [];
        laps = [];
        _total = wk.totalSec();

        // numeracja po SERIACH: interwał tuż po interwale (over-under, 3 min → 20 s) ma numer poprzedniego
        var cnt = 0;
        _ivNo = [];
        for (var k = 0; k < wk.steps.size(); k++) {
            if (wk.steps[k].type == StepType.INTERVAL) {
                if (!isChained(k)) { cnt++; }
                _ivNo.add(cnt);
            } else {
                _ivNo.add(0);
            }
        }
        intervalCount = cnt;
        if (wk.steps.size() == 0) {
            phase = Phase.FREE;
        } else {
            laps.add({ "startSec" => 0, "name" => wk.steps[0].name, "type" => StepType.key(wk.steps[0].type) });
            resetStepStats();
        }
    }

    // ------------------------------------------------------------------ zapytania
    function step() {
        if (phase == Phase.FREE || stepIdx >= wk.steps.size()) { return null; }
        return wk.steps[stepIdx];
    }

    function nextStep() {
        if (phase == Phase.FREE || stepIdx + 1 >= wk.steps.size()) { return null; }
        return wk.steps[stepIdx + 1];
    }

    //! Czy interwał startuje automatycznie (wykrywanie po mocy). Pierwszy krok nigdy; domyślnie każdy
    //! interwał poza interwałem tuż po innym interwale (tam zmiana z zegarem).
    function isAuto(idx as Number) as Boolean {
        if (idx <= 0 || idx >= wk.steps.size()) { return false; }
        var st = wk.steps[idx];
        if (st.type != StepType.INTERVAL) { return false; }
        if (st.start != 0) { return st.start == 1; }
        return wk.steps[idx - 1].type != StepType.INTERVAL;
    }

    //! Interwał tuż po interwale, z zegarem – bez przerwy między nimi.
    function isChained(idx as Number) as Boolean {
        if (idx <= 0 || idx >= wk.steps.size()) { return false; }
        return wk.steps[idx].type == StepType.INTERVAL && wk.steps[idx - 1].type == StepType.INTERVAL && !isAuto(idx);
    }

    function intervalNo(idx as Number) as Number {
        if (idx < 0 || idx >= _ivNo.size()) { return 0; }
        return _ivNo[idx];
    }

    hidden function startNeedSec(dur as Number) as Number {
        if (dur < 30) { return Util.min(autoStartSec, Util.max(2, dur / 4)); }
        return autoStartSec;
    }

    hidden function fsWindow(st as WStep) as Number {
        return Util.min(FS_MAX_SEC, Util.max(10, st.dur / 3));
    }

    //! Ile sekund jeszcze można odwołać start interwału (0 = już nie).
    function falseStartLeft() as Number {
        var st = step();
        if (!_snapOn || st == null) { return 0; }
        return Util.max(0, fsWindow(st) - inStep);
    }

    function stepRemaining() as Number {
        var st = step();
        if (st == null) { return 0; }
        return Util.max(0, st.dur - inStep);
    }

    function overrunSec() as Number {
        var st = step();
        if (st == null || phase != Phase.WAITING) { return 0; }
        return inStep - st.dur;
    }

    function stepAvgPower() as Number {
        return _stepCnt > 0 ? Util.round(_stepSum.toFloat() / _stepCnt) : 0;
    }

    function stepAvgHr() as Number {
        return _hrN > 0 ? Util.round(_hrSum.toFloat() / _hrN) : 0;
    }

    //! Planowany czas do końca planu (bieżący krok + następne).
    function planLeftSec() as Number {
        var st = step();
        if (st == null) { return 0; }
        var t = Util.max(0, st.dur - inStep);
        for (var i = stepIdx + 1; i < wk.steps.size(); i++) { t += wk.steps[i].dur; }
        return t;
    }

    function lastSeries() {
        return series.size() > 0 ? series[series.size() - 1] : null;
    }

    function inEffort() as Boolean { return _inEffort; }
    function effortSec() as Number { return _inEffort ? (s - _effortStart + 1) : 0; }
    function effortAvg() as Number {
        var d = effortSec();
        return d > 0 ? Util.round(_effSum.toFloat() / d) : 0;
    }

    //! % czasu serii w zakresie (ważone długością) – „pierścień realizacji” na żywo.
    function compliancePct() as Number {
        var dur = 0;
        var wsum = 0;
        for (var i = 0; i < series.size(); i++) {
            var d = series[i]["durationSec"];
            dur += d;
            wsum += series[i]["compliancePct"] * d;
        }
        return dur > 0 ? wsum / dur : 0;
    }

    // ------------------------------------------------------------------ liczniki kroku
    hidden function resetStepStats() as Void {
        inStep = 0; _stepCnt = 0; _stepSum = 0; _movSum = 0; _movN = 0; _hrSum = 0; _hrN = 0;
        _inR = 0; _actN = 0; _cumSum = 0; _cumN = 0;
        var st = (stepIdx < wk.steps.size()) ? wk.steps[stepIdx] : null;
        if (st != null) {
            var mid = (st.lo + st.hi) / 2.0;
            _tolC = Util.max(deadbandW.toFloat(), mid * deadbandPct);
        }
    }

    hidden function isWork(st as WStep) as Boolean {
        return st.type == StepType.INTERVAL || st.type == StepType.STEADY;
    }

    //! Dolicza sekundę i (z historii) do bieżącego kroku.
    hidden function stepPush(i as Number) as Void {
        var st = wk.steps[stepIdx];
        var p = hist.p(i);
        var h = hist.hr(i);
        var k = inStep;
        _winP[k % WIN] = p;
        var n30 = k + 1 < 30 ? k + 1 : 30;
        var sum = 0;
        for (var j = 0; j < n30; j++) { sum += _winP[(k - j) % WIN]; }
        var a = sum.toFloat() / n30;
        var flag = (a >= st.lo - _tolC && a <= st.hi + _tolC) ? 1 : 0;
        _winF[k % WIN] = flag;
        if (k >= graceSec) { _inR += flag; }
        inStep++;
        _stepCnt++;
        _stepSum += p;
        if (p >= autoPauseWatts) { _movSum += p; _movN++; }
        if (h > 0) { _hrSum += h; _hrN++; }
        if (!isWork(st) || p >= st.lo * earlyStopPct) {
            _act[_actN % ACT] = p;
            _actN++;
            if (k >= 10) { _cumSum += p; _cumN++; }
        }
    }

    //! Cofa n ostatnich sekund kroku (sekundy s-1 … s-n; bieżąca jeszcze nie jest doliczona).
    hidden function stepPop(n as Number) as Void {
        var st = wk.steps[stepIdx];
        for (var j = 1; j <= n && inStep > 0; j++) {
            var k = inStep - 1;
            var p = _winP[k % WIN];
            if (k >= graceSec) { _inR -= _winF[k % WIN]; }
            inStep--;
            _stepCnt--;
            _stepSum -= p;
            if (p >= autoPauseWatts) { _movSum -= p; _movN--; }
            var h = hist.hr(s - j);
            if (h > 0) { _hrSum -= h; _hrN--; }
            if (!isWork(st) || p >= st.lo * earlyStopPct) {
                if (_actN > 0) { _actN--; }
                if (k >= 10 && _cumN > 0) { _cumSum -= p; _cumN--; }
            }
        }
    }

    hidden function addLap(startSec as Number, name as String, type as Number) as Void {
        for (var i = laps.size() - 1; i >= 0; i--) {
            if (laps[i]["startSec"] >= startSec) { laps.remove(laps[i]); }
        }
        laps.add({ "startSec" => Util.max(0, startSec), "name" => name, "type" => StepType.key(type) });
    }

    // ------------------------------------------------------------------ główna pętla
    //! Jedna sekunda aktywnego czasu. hr / cad mogą być null (brak czujnika).
    function tick(pIn, hr, cad) as Void {
        var p = (pIn == null || pIn < 0) ? 0 : pIn;
        hist.push(p, hr, cad);
        s = hist.last;
        m.add(hist, p, hr, cad);

        if (s == 0) {
            if (phase == Phase.FREE) { say("freeStart", {}, "info"); }
            else { announceStep(0); }
        }
        briefingTick();
        fuelTick();
        if (phase == Phase.FREE) { freeTick(p); return; }

        var st = wk.steps[stepIdx];
        var autoInterval = st.type == StepType.INTERVAL && isAuto(stepIdx);
        var stopped = p < autoPauseWatts && (cad == null || cad == 0);
        if (stopped) { _quietUntil = s + QUIET_AFTER_STOP_SEC; }

        // --- falstart: odpuszczenie albo postój tuż po auto-starcie = interwał się nie liczy
        if (_snapOn) {
            var lowNow = p < st.lo * FS_PCT;
            if (!autoInterval || (inStep >= fsWindow(st) && _fsStopRun == 0 && _fsEaseRun == 0 && !lowNow)) {
                _snapOn = false;
            } else {
                _fsStopRun = stopped ? _fsStopRun + 1 : 0;
                var avgFs = hist.avgP(FS_AVG_SEC);
                _fsEaseRun = (!stopped && avgFs < st.lo * FS_PCT) ? _fsEaseRun + 1 : 0;
                if (_fsStopRun >= FS_STOP_SEC || _fsEaseRun >= FS_EASE_SEC) { cancelFalseStart(); return; }
            }
        }

        // --- interwał: auto-pauza i wznowienie; elastyczny dodatkowo wcześniejsze przerwanie
        if (st.type == StepType.INTERVAL && st.dur >= 60) {
            var low = st.lo;
            if (phase == Phase.AUTOPAUSED) {
                _resumeRun = p >= low * autoStartPct ? _resumeRun + 1 : 0;
                if (_resumeRun < resumeSec) { return; }
                phase = Phase.RUNNING;
                // sekundy rozbiegu wliczamy do interwału
                for (var k = resumeSec - 1; k >= 1; k--) { stepPush(s - k); }
                say("autoResume", leftVars(st.dur - inStep), "pause");
            } else {
                _lowRun = stopped ? _lowRun + 1 : 0;
                if (_lowRun >= autoPauseSec && st.dur - inStep > 0) {
                    // poprzednie sekundy postoju nie liczą się do interwału
                    stepPop(autoPauseSec - 1);
                    phase = Phase.AUTOPAUSED; _lowRun = 0; _resumeRun = 0; _easeRun = 0;
                    say("autoPause", leftVars(st.dur - inStep), "pause");
                    return;
                }
                var easeAvg = hist.avgP(earlyStopAvgSec);
                var easing = autoInterval && !stopped && easeAvg < low * earlyStopPct;
                _easeRun = easing ? _easeRun + 1 : 0;
                if (_easeRun >= earlyStopSec && st.dur - inStep > 20) {
                    var back = earlyStopSec - 1;
                    stepPop(back);
                    say("earlyStop", { "done" => Util.durationPl(inStep), "doneS" => Util.durShort(inStep) }, "info");
                    closeInterval(true);
                    enterStep(stepIdx + 1, s - back, back + 1, true);
                    return;
                }
            }
        }

        stepPush(s);
        var remaining = st.dur - inStep;
        var nextAuto = stepIdx + 1 < wk.steps.size() && isAuto(stepIdx + 1);
        var armed = nextAuto && remaining < armLeadSec;
        if (phase != Phase.AUTOPAUSED) {
            phase = (nextAuto && remaining < 0) ? Phase.WAITING : (armed ? Phase.ARMED : Phase.RUNNING);
        }

        structuralCues(st, remaining, nextAuto);
        if (!armed) { corrections(st, p, cad, remaining); }
        hrCoach(st, remaining);

        // --- czuwanie: wykrycie startu kolejnego interwału
        // (przy krótkiej przerwie nie łapiemy „rozpędu” z poprzedniego interwału jako nowego startu)
        var minRest = Util.min(20, st.dur / 2);
        if (nextAuto && remaining < armLeadSec && inStep > minRest) {
            var next = wk.steps[stepIdx + 1];
            var thr = next.lo * autoStartPct;
            // seria sekund nad progiem; jedna krótka „dziura” (szum pomiaru) nie przerywa serii
            if (_needRearm) {
                _rearmLow = p < thr ? _rearmLow + 1 : 0;
                if (_rearmLow >= 5) { _needRearm = false; }
                _startRun = 0; _startDips = 0;
            } else if (p >= thr) {
                if (_startRun == 0) { _startRunAt = s; _startDips = 0; }
                _startRun++;
            } else if (_startRun > 0 && _startDips == 0) {
                _startDips = 1;
            } else {
                _startRun = 0; _startDips = 0;
            }
            if (_startRun >= startNeedSec(next.dur)) {
                var startSec = _startRunAt;
                var snapIdx = stepIdx;
                var snapStart = stepStartSec;
                var snapRest = _lastRestSec;
                var rest = startSec - stepStartSec;
                var plannedRest = st.dur;
                var wasRecovery = st.type == StepType.RECOVERY;
                _lastRestSec = rest;
                enterStep(stepIdx + 1, startSec, s - startSec + 1, false);
                _snapOn = true; _snapIdx = snapIdx; _snapStart = snapStart; _snapRest = snapRest;
                _fsStopRun = 0; _fsEaseRun = 0;
                var vars = stepVars(stepIdx);
                var text = Util.render(_phr["autoStart"], vars);
                if (wasRecovery && Util.abs(rest - plannedRest) > 20) {
                    vars.put("rest", Util.durationPl(rest));
                    vars.put("restS", Util.durShort(rest));
                    text = text + "\n" + Util.render(_phr["restInfo"], vars);
                }
                emit(text, "step", "autoStart", vars);
                return;
            }
            if (remaining < 0 && (-remaining) % waitRemindSec == 0) {
                say("waiting", { "n" => intervalNo(stepIdx + 1), "rest" => Util.durationPl(inStep), "restS" => Util.durShort(inStep) }, "info");
            }
            return; // krok przed auto-interwałem nie kończy się z zegarem
        }

        // --- przejście z zegarem
        if (remaining <= 0) {
            if (st.type == StepType.INTERVAL) { closeInterval(false); }
            enterStep(stepIdx + 1, s + 1, 0, true);
        }
    }

    hidden function leftVars(left as Number) {
        return { "left" => Util.durationPl(left), "leftS" => Util.durShort(left) } as Dictionary;
    }

    hidden function stepVars(idx as Number) {
        var st = wk.steps[idx];
        var v = {} as Dictionary;
        v.put("n", intervalNo(idx));
        v.put("total", intervalCount);
        v.put("name", st.name);
        v.put("dur", Util.durationPl(st.dur));
        v.put("durS", Util.durShort(st.dur));
        v.put("low", st.lo);
        v.put("high", st.hi);
        return v;
    }

    //! Odwołanie startu auto-interwału (falstart): sekundy wracają do przerwy, interwał czeka na prawdziwy start.
    hidden function cancelFalseStart() as Void {
        if (!_snapOn) { return; }
        var n = intervalNo(stepIdx);
        var ivStart = stepStartSec;
        for (var i = laps.size() - 1; i >= 0; i--) {
            var ls = laps[i]["startSec"];
            if (ls >= ivStart && ls > _snapStart) { laps.remove(laps[i]); }
        }
        stepIdx = _snapIdx;
        stepStartSec = _snapStart;
        // cała jazda od początku przerwy (także sekundy „interwału”) wraca do przerwy
        resetStepStats();
        var from = Util.max(_snapStart, s - (WIN - 1));
        inStep = from - _snapStart;
        for (var j = from; j <= s; j++) { stepPush(j); }
        _lastRestSec = _snapRest;
        _snapOn = false; _fsStopRun = 0; _fsEaseRun = 0;
        _needRearm = true; _rearmLow = 0;
        _startRun = 0; _startDips = 0; _lowRun = 0; _easeRun = 0; _resumeRun = 0;
        _lastCorrection = s;
        var st = wk.steps[stepIdx];
        var rem = st.dur - inStep;
        phase = rem < 0 ? Phase.WAITING : (rem < armLeadSec ? Phase.ARMED : Phase.RUNNING);
        say("falseStart", { "n" => n }, "info");
        if (listener != null) { listener.onFalseStart(); }
    }

    //! Przycisk „Falstart”.
    function cancelStart() as Void {
        if (_snapOn) { cancelFalseStart(); }
    }

    //! Ręczne przejście do następnego kroku (przycisk Lap / menu). W czekaniu = „start teraz”.
    function skipStep() as Void {
        if (phase == Phase.FREE || s < 0) { return; }
        if (wk.steps[stepIdx].type == StepType.INTERVAL) { closeInterval(false); }
        var next = stepIdx + 1;
        enterStep(next, s + 1, 0, true);
        // ręczny start auto-interwału – enterStep go nie zapowiada
        if (phase != Phase.FREE && isAuto(next)) {
            say("autoStart", stepVars(next), "step");
        }
    }

    // ------------------------------------------------------------------ kroki
    hidden function enterStep(idx as Number, startSec as Number, pre as Number, speak as Boolean) as Void {
        if (idx >= wk.steps.size()) { planDone(); return; }
        _snapOn = false; _needRearm = false;
        var st = wk.steps[idx];
        addLap(startSec, st.name, st.type);
        stepIdx = idx; stepStartSec = startSec;
        resetStepStats();
        for (var k = 0; k < pre; k++) { stepPush(startSec + k); }
        _startRun = 0; _startDips = 0; _lowRun = 0; _easeRun = 0; _resumeRun = 0;
        _outHigh = 0; _outLow = 0; _inRangeStreak = 0; _cadLowRun = 0; _cadHighRun = 0;
        _lastCorrection = -1000000; _spoke = {}; _hrHighRun = 0; _hrRecStart = null;
        _corrRepeat = 0; _lastCorrDir = 0;
        phase = Phase.RUNNING;
        if (listener != null) { listener.onStepLap(idx); }
        if (speak && !isAuto(idx)) { announceStep(idx); }
    }

    hidden function announceStep(idx as Number) as Void {
        var st = wk.steps[idx];
        // kolejny interwał bez przerwy, zapowiedziany w trakcie poprzedniego → tylko krótkie „Teraz!”
        var chainGo = isChained(idx) && _chainAnnounced;
        _chainAnnounced = false;
        if (chainGo) { say("chainGo", stepVars(idx), "step"); return; }
        var key = "steadyStart";
        if (st.type == StepType.INTERVAL) { key = "intervalStart"; }
        else if (st.type == StepType.RECOVERY) { key = "recoveryStart"; }
        else if (st.type == StepType.WARMUP) { key = "warmupStart"; }
        else if (st.type == StepType.COOLDOWN) { key = "cooldownStart"; }
        say(key, stepVars(idx), "step");
    }

    hidden function closeInterval(early as Boolean) as Void {
        var st = wk.steps[stepIdx];
        if (!isChained(stepIdx)) { _chainStart = series.size(); } // początek serii (np. 3 min + 20 s)
        var len = inStep;
        // zgodność: sekundy [grace, len-3), średnia krocząca 30 s w zakresie (z tolerancją)
        var inR = _inR;
        for (var k = len - 1; k >= len - 3 && k >= 0; k--) {
            if (k >= graceSec) { inR -= _winF[k % WIN]; }
        }
        var evalN = Util.max(0, len - 3 - graceSec);
        var avg = stepAvgPower();
        var res = {} as Dictionary;
        res.put("n", intervalNo(stepIdx) > 0 ? intervalNo(stepIdx) : series.size() + 1);
        res.put("durationSec", len);
        res.put("plannedSec", st.dur);
        res.put("avgPower", avg);
        res.put("compliancePct", evalN > 0 ? Util.round(inR * 100.0 / evalN) : 0);
        res.put("endedEarly", early);
        res.put("startSec", stepStartSec);
        if (_hrN > 0) { res.put("avgHr", stepAvgHr()); }
        if (_lastRestSec != null) { res.put("restBeforeSec", _lastRestSec); }
        // ocena prosta dla człowieka: w zakresie / mocniej / słabiej (±5 W – „idealnie” znaczy idealnie)
        var tolV = Util.max(5.0, ((st.lo + st.hi) / 2.0) * 0.015);
        if (avg > st.hi + tolV) { res.put("verdict", "high"); res.put("deltaW", avg - st.hi); }
        else if (avg < st.lo - tolV) { res.put("verdict", "low"); res.put("deltaW", st.lo - avg); }
        else { res.put("verdict", "ok"); res.put("deltaW", 0); }
        series.add(res);
        if (listener != null) { listener.onSeries(res); }
        // od razu kolejny interwał (bez przerwy) → teraz cisza, podsumowanie dopiero po całej serii
        if (isChained(stepIdx + 1)) { _lastRestSec = 0; return; }

        // najdłuższy w serii
        var main = series[_chainStart];
        for (var c = _chainStart + 1; c < series.size(); c++) {
            if (series[c]["plannedSec"] > main["plannedSec"]) { main = series[c]; }
        }
        var chainLen = series.size() - _chainStart;
        var prev = null;
        if (chainLen == 1) {
            if (_chainStart > 0) { prev = series[_chainStart - 1]; }
        } else {
            for (var b = _chainStart - 1; b >= 0; b--) {
                if (series[b]["plannedSec"] == main["plannedSec"]) { prev = series[b]; break; }
            }
        }
        var sv = {} as Dictionary;
        sv.put("n", main["n"]);
        sv.put("total", intervalCount);
        sv.put("dur", Util.durationPl(main["durationSec"]));
        sv.put("durS", Util.durShort(main["durationSec"]));
        sv.put("avg", main["avgPower"]);
        sv.put("vrd", main["verdict"]);
        sv.put("dW", main["deltaW"]);
        sv.put("verdict", Phrases.verdictText(main["verdict"]));
        var text = Util.render(_phr["seriesEnd"], sv);
        for (var x = _chainStart; x < series.size(); x++) {
            if (series[x] != main) {
                text = text + "\npotem " + Util.durShort(series[x]["durationSec"]) + ": " + series[x]["avgPower"] + " W";
            }
        }
        if (prev != null) {
            sv.put("prev", prev["avgPower"]);
            text = text + "\n" + Util.render(_phr["seriesPrev"], sv);
        }
        var first = series[0];
        if (series.size() >= 2 && first != main && !_spokeHr && first.hasKey("avgHr") && main.hasKey("avgHr")) {
            // porównanie tylko przy podobnej mocy (±3%)
            var dHr = main["avgHr"] - first["avgHr"];
            if (Util.abs(main["avgPower"] - first["avgPower"]) <= first["avgPower"] * 0.03 && dHr >= hrDriftBpm) {
                sv.put("d", dHr);
                sv.put("hrUp", dHr);
                text = text + "\n" + Util.render(_phr["hrUp"], sv);
                _spokeHr = true;
            }
        }
        emit(text, "summary", "seriesEnd", sv);
        _lastRestSec = null;
    }

    hidden function planDone() as Void {
        phase = Phase.FREE;
        addLap(s + 1, "Po planie", StepType.FREE);
        var list = "";
        for (var i = 0; i < series.size(); i++) {
            list = list + (i > 0 ? ", " : "") + series[i]["avgPower"];
        }
        say("planDone", { "list" => (list.length() > 0 ? list : "-") }, "summary");
        if (listener != null) { listener.onPlanDone(); }
    }

    // ------------------------------------------------------------------ komunikaty
    hidden function once(k as String) as Boolean {
        if (_spoke.hasKey(k)) { return false; }
        _spoke.put(k, true);
        return true;
    }

    hidden function structuralCues(st as WStep, remaining as Number, nextAuto as Boolean) as Void {
        var reports = isWork(st) && st.dur >= statusMinStepSec && s >= _quietUntil;
        if (reports && inStep % statusEverySec == 0 && remaining > 120 && s - _lastCorrection >= 30) {
            var avg = _movN > 0 ? Util.round(_movSum.toFloat() / _movN) : 0;
            var hr = hist.avgHr(30);
            var state = "";
            if (hr != null && (st.hrHi > 0 || st.hrLo > 0)) {
                if (st.hrHi > 0 && hr > st.hrHi + hrMarginBpm) { state = "high"; }
                else if (st.hrLo > 0 && hr < st.hrLo - hrMarginBpm) { state = "low"; }
                else { state = "ok"; }
            }
            var hrTxt = "";
            if (hr != null) {
                hrTxt = "\ntętno " + hr;
                if (state.equals("ok")) { hrTxt = hrTxt + ", w normie"; }
                else if (state.equals("high")) { hrTxt = hrTxt + ", powyżej strefy"; }
                else if (state.equals("low")) { hrTxt = hrTxt + ", poniżej strefy"; }
            }
            say("status", { "avg" => avg, "hr" => (hr == null ? "" : hr), "hrState" => state, "hrTxt" => hrTxt }, "info");
        }
        if (st.type == StepType.INTERVAL && st.dur >= 120 && !reports && inStep == st.dur / 2 && once("half")) {
            say("half", { "avg" => stepAvgPower() }, "info");
        }
        if (st.type == StepType.INTERVAL && st.dur >= 180 && remaining == 60 && once("lastMin")) {
            say("lastMinute", {}, "info");
        }
        if (isChained(stepIdx + 1)) {
            // zapowiedź W TRAKCIE: po tym interwale od razu kolejny – 30 s przed końcem (krótkie: 15 s)
            var lead = st.dur >= 60 ? 30 : (st.dur >= 30 ? 15 : 0);
            if (lead > 0 && remaining == lead && once("chain")) {
                _chainAnnounced = true;
                say("chainNext", stepVars(stepIdx + 1), "arm");
            }
        }
        if (nextAuto) {
            var lead2 = Util.min(armLeadSec, st.dur - 1);
            if (remaining == lead2 && once("arm")) { say("armNext", stepVars(stepIdx + 1), "arm"); }
            if (remaining == 10 && lead2 > 15 && once("ten")) { say("tenSec", {}, "countdown"); }
            if (remaining >= 1 && remaining <= 3) { countdown(remaining); }
            if (remaining == 0 && once("go")) { say("goNow", {}, "countdown"); }
        } else if (remaining >= 1 && remaining <= 3) {
            if (stepIdx + 1 < wk.steps.size() && wk.steps[stepIdx + 1].type == StepType.INTERVAL) {
                // 3-2-1 przed interwałem ruszającym z zegarem
                countdown(remaining);
            } else if (st.type == StepType.INTERVAL && st.dur >= 10) {
                // 3-2-1 przed końcem interwału: tylko sygnał na liczniku (osobny klucz – telefon tego nie mówi)
                say("endCount", { "n" => remaining }, "countdown");
            }
        }
    }

    hidden function countdown(n as Number) as Void {
        var words = ["", "Jeden", "Dwa", "Trzy"];
        say("count", { "n" => n, "word" => words[n] }, "countdown");
    }

    hidden function corrections(st as WStep, p as Number, cad, remaining as Number) as Void {
        var D = st.dur;
        // korekty oceniamy na ŚREDNIEJ: okno rośnie z długością kroku (20–60 s), a średnia całego kroku musi
        // się zgadzać – krótki zryw lub chwilowe odpuszczenie (ruch, skrzyżowanie) nie wywołuje komunikatu
        var grace = Util.clamp(Util.round(D * 0.1), corrGraceMinSec, corrGraceMaxSec);
        if (inStep <= grace || remaining <= 3 || st.type == StepType.WARMUP) { return; }
        if (s < _quietUntil) { _outHigh = 0; _outLow = 0; _inRangeStreak = 0; return; } // postój / ruszanie
        var work = isWork(st);
        var winLen = Util.clamp(Util.round(D / 6.0), corrWindowMinSec, corrWindowMaxSec);
        if (_actN < winLen) { _outHigh = 0; _outLow = 0; return; }
        var sum = 0;
        for (var j = 1; j <= winLen; j++) { sum += _act[(_actN - j) % ACT]; }
        var roll = Util.round(sum.toFloat() / winLen);
        var cum = _cumN > 0 ? Util.round(_cumSum.toFloat() / _cumN) : roll;
        var tol = Util.max(deadbandW.toFloat(), ((st.lo + st.hi) / 2.0) * deadbandPct);
        var inRange = roll >= st.lo - tol / 2 && roll <= st.hi + tol / 2;
        _outHigh = (roll > st.hi + tol && cum > st.hi) ? _outHigh + 1 : 0;
        _outLow = (work && roll < st.lo - tol && cum < st.lo) ? _outLow + 1 : 0;
        _inRangeStreak = inRange ? _inRangeStreak + 1 : 0;
        // kolejna uwaga w tę samą stronę coraz rzadziej (1×, 2×, 3× przerwy); schłodzenie – najwyżej jedna
        var gap = Util.clamp(Util.round(D / 4.0), cooldownSec, cooldownMaxSec) * (1 + _corrRepeat);
        var can = (s - _lastCorrection >= gap) && !(st.type == StepType.COOLDOWN && _corrRepeat > 0);
        var dHigh = Util.r5(roll - st.hi);
        var dLow = Util.r5(st.lo - roll);
        if (can && _outHigh >= outOfRangeSec && dHigh >= minDeltaW) {
            say(work ? "tooHigh" : "recoveryTooHigh", { "delta" => dHigh, "high" => st.hi }, "correction");
            _corrRepeat = _lastCorrDir == 1 ? _corrRepeat + 1 : 1; _lastCorrDir = 1;
            _lastCorrection = s; _outHigh = 0; return;
        }
        // wyraźne odpuszczenie w interwale elastycznym obsługuje „przerwałeś”, nie „dodaj 125 W”
        var givingUp = st.type == StepType.INTERVAL && isAuto(stepIdx) && _easeRun >= 3;
        if (can && !givingUp && _outLow >= outOfRangeSec && dLow >= minDeltaW) {
            say("tooLow", { "delta" => dLow, "low" => st.lo }, "correction");
            _corrRepeat = _lastCorrDir == -1 ? _corrRepeat + 1 : 1; _lastCorrDir = -1;
            _lastCorrection = s; _outLow = 0; return;
        }
        if (st.type == StepType.INTERVAL && _inRangeStreak >= praiseAfterSec && remaining > 30 && !_spoke.hasKey("praise")) {
            _spoke.put("praise", true);
            say("praise", {}, "praise");
        }
        if (cad != null && cad > 0) {
            _cadLowRun = (st.cadLo > 0 && cad < st.cadLo) ? _cadLowRun + 1 : 0;
            _cadHighRun = (st.cadHi > 0 && cad > st.cadHi) ? _cadHighRun + 1 : 0;
            if (can && _cadLowRun >= cadenceGraceSec) {
                say("cadenceLow", { "cad" => cad, "cadLow" => st.cadLo }, "cadence"); _lastCorrection = s; _cadLowRun = 0;
            } else if (can && _cadHighRun >= cadenceGraceSec) {
                say("cadenceHigh", { "cad" => cad, "cadHigh" => st.cadHi }, "cadence"); _lastCorrection = s; _cadHighRun = 0;
            }
        }
    }

    // ------------------------------------------------------------------ jedzenie i picie
    //! „Zjadłem” / „wypiłem” – przesuwa przypomnienia.
    function fueled(eat as Boolean) as Void {
        var now = Util.max(0, s);
        if (eat) { lastEat = now; }
        lastDrink = now;
    }

    hidden function fuelTick() as Void {
        if (phase == Phase.AUTOPAUSED || s <= 0) { return; }
        var free = wk.steps.size() == 0;
        var total = _total;
        var drinkOn = free ? s >= FUEL_DRINK_SEC : total >= 2700;
        var eatOn = free ? s >= 3600 : total >= 4500;
        if (!drinkOn && !eatOn) { return; }
        var st = step();
        // po planie i na schłodzeniu nic
        if (!free && (phase == Phase.FREE || st == null || st.type == StepType.COOLDOWN)) { return; }
        var every = FUEL_DRINK_SEC;
        if (s - lastDrink < every * 0.6 && s - lastEat < 1800 * 0.6) { return; }   // szybkie wyjście – nic nie jest bliskie
        if (!fuelWindow(st, free)) { return; }
        var hard = false;
        for (var i = 0; i < wk.steps.size(); i++) {
            if (wk.steps[i].type == StepType.INTERVAL && wk.steps[i].lo >= wk.ftp * 0.88) { hard = true; break; }
        }
        var eatEvery = hard ? 1800 : 2400;
        var left = free ? 1000000 : planLeftSec();
        // przerwa przed długim interwałem (≥ 10 min) → zjedz / napij się teraz, wcześniej niż wynika z zegara
        var next = free ? null : nextStep();
        var preLong = st != null && st.type != StepType.INTERVAL && next != null && next.type == StepType.INTERVAL && next.dur >= 600;
        var k = preLong ? 0.6 : 1.0;
        if (eatOn && left >= 1500 && s - lastEat >= Util.round(eatEvery * k)) {
            lastEat = s; lastDrink = s;
            say("eat", {}, "info");
        } else if (drinkOn && left >= 600 && s - lastDrink >= Util.round(FUEL_DRINK_SEC * k)) {
            lastDrink = s;
            say("drink", {}, "info");
        }
    }

    //! Czy to dobry moment na jedzenie/picie: nie w trakcie wysiłku i nie tuż przed interwałem.
    hidden function fuelWindow(st, free as Boolean) as Boolean {
        if (free) { return !_inEffort || s - _effortStart >= 1200; }
        if (st == null) { return false; }
        var remaining = st.dur - inStep;
        var hardSteady = st.type == StepType.STEADY && st.lo >= wk.ftp * 0.85;
        if (st.type == StepType.INTERVAL || hardSteady) { return st.dur >= 1800 && inStep >= 300 && remaining >= 300; }
        if (inStep < 15) { return false; }
        if (st.type == StepType.RECOVERY && st.dur < 90) { return false; }
        var next = nextStep();
        if (next != null && next.type == StepType.INTERVAL) {
            if (phase == Phase.WAITING) { return hist.avgP(10) < next.lo * 0.7; }
            if (remaining < 45) { return false; }
        }
        return true;
    }

    // ------------------------------------------------------------------ odprawa (rozgrzewka)
    hidden function briefingTick() as Void {
        if (s == BRIEF_READY_SEC && wk.readiness != null) {
            say("readiness", { "pct" => Util.round(wk.readiness), "state" => wk.readyState,
                "heavy" => (wk.yTss >= 150 ? 1 : 0), "rec" => (wk.recovery == null ? "" : Util.round(wk.recovery)) }, "info");
        }
        if (s == BRIEF_COND_SEC && wk.hrA != null && wk.hrB != null) {
            var sp = 0; var sh = 0; var cnt = 0;
            for (var i = BRIEF_COND_FROM; i <= s; i++) {
                var pw = hist.p(i);
                var h = hist.hr(i);
                if (pw >= 50 && h > 0) { sp += pw; sh += h; cnt++; }
            }
            if (cnt < (s - BRIEF_COND_FROM) * 0.6) { return; } // za mało jazdy z tętnem
            var exp = wk.hrA + wk.hrB * (sp.toFloat() / cnt);
            if (exp <= 60) { return; }
            var n = Util.clamp(Util.round((exp - sh.toFloat() / cnt) / exp * 100.0), -10, 10);
            say("condition", { "n" => n, "sign" => (n > 0 ? "+" : ""), "level" => (n >= 3 ? "good" : (n <= -3 ? "bad" : "ok")) }, "info");
        }
    }

    // ------------------------------------------------------------------ tętno
    hidden function hrCoach(st as WStep, remaining as Number) as Void {
        // przerwa: potwierdzenie regeneracji, gdy tętno zejdzie poniżej progu (raz na przerwę)
        if (st.type == StepType.RECOVERY) {
            if (st.hrHi <= 0 || _spoke.hasKey("hrRec")) { return; }
            if (inStep == 15) { _hrRecStart = hist.avgHr(10); }
            if (inStep < 45) { return; }
            var hr = hist.avgHr(10);
            // nie wchodź w zapowiedź / odliczanie
            var quiet = (remaining > 12 && Util.abs(remaining - armLeadSec) > 8) || remaining < -3;
            if (hr != null && hr <= st.hrHi && _hrRecStart != null && _hrRecStart > st.hrHi + 5 && quiet) {
                _spoke.put("hrRec", true);
                say("hrRecovered", { "hr" => hr }, "info");
            }
            return;
        }
        // tętno ponad zakresem (jazda w strefie, rozgrzewka – w interwałach decyduje moc)
        if (st.type == StepType.INTERVAL || st.type == StepType.COOLDOWN || st.hrHi <= 0 || inStep <= hrGraceSec
            || remaining <= 30 || s < _quietUntil) { _hrHighRun = 0; return; }
        var hr30 = hist.avgHr(30);
        _hrHighRun = (hr30 != null && hr30 > st.hrHi + hrMarginBpm) ? _hrHighRun + 1 : 0;
        if (_hrHighRun >= hrAlertSec && s - _lastHrAlert >= hrCooldownSec && s - _lastCorrection >= 60) {
            say("hrHigh", { "hr" => hr30, "high" => st.hrHi }, "correction");
            _lastHrAlert = s; _lastCorrection = s; _hrHighRun = 0;
        }
    }

    // ------------------------------------------------------------------ jazda swobodna
    //! Wykrywanie DŁUŻSZYCH wysiłków (≥ 2 min). Start i koniec po średniej z 30 s, a koniec dopiero po 45 s
    //! słabszej jazdy – chwilowe odpuszczenie (światła, zakręt) nie dzieli wysiłku.
    hidden function freeTick(p as Number) as Void {
        var ftp = wk.ftp;
        if (_inEffort) { _effSum += p; }
        if (ftp <= 0 || s < 29) { return; }
        var avg30 = hist.avgP(30);
        if (!_inEffort) {
            if (avg30 >= ftp * effortStartPct) {
                _inEffort = true; _effortStart = s - 29; _effortPending = -1;
                _effSum = Util.round(avg30 * 30);
                if (listener != null) { listener.onEffort(true, null); }
            }
            return;
        }
        if (_effortPending < 0) {
            if (avg30 < ftp * effortEndPct) { _effortPending = s; }
            return;
        }
        if (hist.avgP(10) >= ftp * 0.8) { _effortPending = -1; return; }  // wrócił do mocy → ten sam wysiłek
        if (s - _effortPending < effortGapSec) { return; }
        var e = effortBetween(_effortStart, s);
        _inEffort = false; _effortPending = -1;
        if (e != null) {
            efforts.add(e);
            say("effort", { "dur" => Util.durationPl(e["durationSec"]), "durS" => Util.durShort(e["durationSec"]), "avg" => e["avgPower"] }, "effort");
        }
        if (listener != null) { listener.onEffort(false, e); }
    }

    //! Wysiłek w [a, b] przycięty do sekund ≥ 80% FTP; null = krótszy niż minimum.
    hidden function effortBetween(a as Number, b as Number) {
        var thr = wk.ftp * 0.8;
        var sum = _effSum;
        // _effSum obejmuje [a, s]; b == s
        while (a < b && hist.valid(a) && hist.p(a) < thr) { sum -= hist.p(a); a++; }
        while (b > a && hist.p(b) < thr) { sum -= hist.p(b); b--; }
        var dur = b - a + 1;
        if (dur < effortMinSec) { return null; }
        return { "startSec" => a, "durationSec" => dur, "avgPower" => Util.round(sum.toFloat() / dur) };
    }

    // ------------------------------------------------------------------ pomocnicze
    hidden function say(key as String, vars, kind as String) as Void {
        var t = _phr.get(key);
        if (t != null) { emit(Util.render(t, vars), kind, key, vars); }
    }

    hidden function emit(text as String, kind as String, key as String, vars) as Void {
        if (listener != null && text.length() > 0) { listener.onCue(kind, key, text, vars); }
    }

    //! Wysiłki łącznie z trwającym w chwili zakończenia jazdy.
    function allEfforts() {
        var out = [];
        out.addAll(efforts);
        if (_inEffort && wk.ftp > 0) {
            var e = effortBetween(_effortStart, s);
            if (e != null) { out.add(e); }
        }
        return out;
    }
}
