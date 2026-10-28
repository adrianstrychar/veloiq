import Foundation

/// Serce systemu: wykonuje skrypt treningu sekunda po sekundzie i decyduje, co powiedzieć.
/// Port 1:1 logiki z web/flex-engine.ts (tam są testy scenariuszy) + obsługa czasu zegarowego.
///
/// Tryb elastyczny: interwały ze startem "auto" nie odpalają się z zegarem – silnik je zapowiada
/// (T-60 s), czuwa i wykrywa faktyczny start po mocy, cofając początek do pierwszej sekundy wzrostu.
/// Do tego auto-pauza na postojach, wykrywanie przerwania interwału, podsumowania serii i przerw,
/// a po planie jazda swobodna z automatycznym wykrywaniem wysiłków (nagrywanie trwa do stopWorkout).
///
/// Czas: advance(now:) liczy sekundy zegarowe (bez pauz). Jeśli iOS uśpi aplikację, silnik dogoni
/// brakujące sekundy bez wypowiadania zaległych komunikatów i bez przypisywania im bieżących odczytów.
final class WorkoutEngine {

    enum CueKind: String { case step, arm, countdown, correction, cadence, info, praise, summary, pause, effort, sensor }
    enum Phase: String { case running, armed, waiting, autoPaused, free }

    // Wyjścia
    var onCue: ((String, CueKind) -> Void)?
    /// Do lektora: (klucz komunikatu, zmienne, tekst, rodzaj). Klucz nil = tekst bez szablonu.
    var onSpeak: ((String?, [String: String], String, CueKind) -> Void)?
    var onLive: ((LiveSample) -> Void)?
    var onSecond: ((Int, Int?, Int?, Int?, Double?) -> Void)? // (sekunda, moc, hr, kadencja, balans) – do zapisu
    var onPlanFinished: ((WorkoutSummary) -> Void)?

    let script: WorkoutScript
    private let R: ResolvedRules
    private let phrases: [String: String]
    private let intervalNumbers: [Int?]
    private let intervalCount: Int

    // Czas
    private(set) var startDate: Date
    private var pausedTotal: TimeInterval
    private var pausedAt: Date?
    private(set) var lastSecond = -1
    private(set) var stopped = false
    var isPaused: Bool { pausedAt != nil }
    var pausedSeconds: TimeInterval { pausedTotal }
    var pausedAtDate: Date? { pausedAt }

    // Ostatnie odczyty czujników
    private var lastPower: (w: Int, at: Date)?
    private var lastHr: (bpm: Int, at: Date)?
    private var lastCadence: (rpm: Int, at: Date)?
    private var lastBalance: Double?
    var location: (lat: Double, lon: Double)?

    // Historia 1 Hz
    private(set) var P: [Int] = []
    private var HR: [Int?] = []
    private var replaying = false

    // Stan kroku
    private(set) var phase: Phase = .running
    private(set) var stepIdx = 0
    private var stepStartSec = 0
    private(set) var inStep = 0            // aktywne sekundy kroku (bez auto-pauzy)
    private var stepSecs: [Int] = []       // indeksy aktywnych sekund kroku
    private var startRun = 0, startRunAt = 0, startDips = 0
    private var lowRun = 0, easeRun = 0, resumeRun = 0
    private var outHigh = 0, outLow = 0, inRangeStreak = 0, cadLowRun = 0, cadHighRun = 0
    private var lastCorrection = -1_000_000
    private var spoke = Set<String>()
    private var lastRestSec: Int?
    private var spokeHr = false
    private var hrHighRun = 0, lastHrAlert = -1_000_000
    private var hrRecStart: Int?
    private var corrRepeat = 0, lastCorrDir = 0
    private var CADS: [Int] = []
    private var lastDrink = 0, lastEat = 0
    private var quietUntil = -1
    private static let quietAfterStopSec = 20   // cisza po postoju (światła, skrzyżowanie)

    // Wyniki
    private(set) var series: [SeriesResult] = []
    private(set) var efforts: [EffortResult] = []
    private var inEffort = false, effortStart = 0

    init(script: WorkoutScript, startDate: Date = Date(), pausedTotal: TimeInterval = 0, pausedAt: Date? = nil) {
        self.script = script
        self.R = ResolvedRules(script.rules)
        self.phrases = Phrases.defaults.merging(script.phrases ?? [:]) { _, custom in custom }
        var n = 0
        self.intervalNumbers = script.steps.map { st -> Int? in
            if st.isInterval { n += 1; return n }
            return nil
        }
        self.intervalCount = n
        self.startDate = startDate
        self.pausedTotal = pausedTotal
        self.pausedAt = pausedAt
        if script.steps.isEmpty { phase = .free }
    }

    private var step: WorkoutStep? { stepIdx < script.steps.count ? script.steps[stepIdx] : nil }

    /// Interwał startuje automatycznie (wykrywanie po mocy)? Pierwszy krok nigdy.
    func isAuto(_ idx: Int) -> Bool {
        guard idx > 0, idx < script.steps.count else { return false }
        let st = script.steps[idx]
        guard st.isInterval else { return false }
        if let s = st.start { return s == "auto" }
        return st.durationSec >= 60
    }

    // MARK: - Wejścia

    func ingestPower(_ w: Int, balanceL: Double?, at: Date = Date()) {
        lastPower = (w, at)
        if let b = balanceL { lastBalance = b }
    }
    func ingestCadence(_ rpm: Int, at: Date = Date()) { lastCadence = (rpm, at) }
    func ingestHr(_ bpm: Int, at: Date = Date()) { lastHr = (bpm, at) }

    /// Bluetooth potrafi zgubić czujnik na kilka sekund – mówimy dopiero, gdy brak trwa ≥ 60 s,
    /// a „wróciło” tylko wtedy, gdy wcześniej padło „nie widzę”.
    private var sensorDownSince: [String: Int] = [:]
    private var sensorAnnounced = Set<String>()
    private static let sensorLostAfterSec = 60

    func sensorChanged(kind: String, connected: Bool) {
        guard !stopped, lastSecond >= 0 else { return }
        if connected {
            sensorDownSince[kind] = nil
            if sensorAnnounced.remove(kind) != nil { say(kind == "power" ? "powerBack" : "hrBack", [:], .sensor, !replaying) }
        } else if sensorDownSince[kind] == nil {
            sensorDownSince[kind] = lastSecond
        }
    }

    private func checkSensors(_ s: Int, _ speak: Bool) {
        for (kind, since) in sensorDownSince where !sensorAnnounced.contains(kind) && s - since >= Self.sensorLostAfterSec {
            sensorAnnounced.insert(kind)
            say(kind == "power" ? "powerLost" : "hrLost", [:], .sensor, speak)
        }
    }

    func pause(at now: Date = Date()) {
        guard pausedAt == nil, !stopped else { return }
        advance(now: now)
        pausedAt = now
        onCue?("Pauza.", .info)
        onSpeak?("manualPause", [:], "Pauza.", .info)
        emitLive(lastSecond, nil, nil, nil, nil)
    }

    func resume(at now: Date = Date()) {
        guard let p = pausedAt else { return }
        pausedTotal += now.timeIntervalSince(p)
        pausedAt = nil
        if phase != .free, let st = step {
            let t = "Wznawiamy. \(st.name), zostało \(Phrases.duration(max(0, st.durationSec - inStep)))."
            onCue?(t, .info)
            onSpeak?("manualResume", [:], t, .info)
        } else {
            onCue?("Wznawiamy.", .info)
            onSpeak?("manualResume", [:], "Wznawiamy.", .info)
        }
    }

    /// Ręczne przejście do następnego kroku (przycisk w aplikacji).
    func skipStep() {
        guard phase != .free, !stopped else { return }
        let speak = !replaying
        if step?.isInterval == true { closeInterval(early: false, speak: speak) }
        let next = stepIdx + 1
        enterStep(next, startSec: lastSecond + 1, pre: 0, speak: speak)
        // ręczny start auto-interwału ("Start teraz") – enterStep go nie zapowiada
        if phase != .free && isAuto(next) {
            let st = script.steps[next]
            say("autoStart", ["dur": Phrases.duration(st.durationSec), "low": "\(st.powerLow)", "high": "\(st.powerHigh)"], .step, speak)
        }
    }

    func activeElapsed(_ now: Date) -> Int {
        let end = pausedAt ?? now
        return max(0, Int(end.timeIntervalSince(startDate) - pausedTotal))
    }

    /// Wznowienie po awarii: odtwarza zapisane sekundy (bez mowy i bez ponownego zapisu),
    /// więc stan kroków, serie i statystyki są dokładnie takie jak przed awarią.
    func seed(_ rec: Recorder.Recorded) {
        replaying = true
        for (i, smp) in rec.samples.enumerated() {
            process(i, smp.power, smp.hr, smp.cad, nil, speak: false)
            if rec.skips.contains(i) { skipStep() }   // ręczne "Następny krok" sprzed awarii
        }
        replaying = false
    }

    // MARK: - Pętla

    /// Wywoływane z timera 1 Hz i przy każdym pakiecie z czujnika.
    func advance(now: Date = Date()) {
        guard !stopped, pausedAt == nil else { return }
        let target = activeElapsed(now)
        while lastSecond < target && !stopped {
            let s = lastSecond + 1
            let v = readings(for: s, now: now)
            // mów tylko, jeśli to "teraz" (max 2 s opóźnienia), inaczej tylko licz
            process(s, v.p, v.hr, v.cad, v.bal, speak: target - s <= 2)
        }
    }

    private func readings(for s: Int, now: Date) -> (p: Int?, hr: Int?, cad: Int?, bal: Double?) {
        // sekunda sprzed > 3 s (doganianie po uśpieniu) nie dostaje bieżących odczytów
        let secTime = startDate.addingTimeInterval(pausedTotal + Double(s) + 1)
        guard now.timeIntervalSince(secTime) <= 3 else { return (nil, nil, nil, nil) }
        func fresh<T>(_ v: (T, Date)?, _ maxAge: TimeInterval) -> T? {
            guard let v = v, now.timeIntervalSince(v.1) <= maxAge else { return nil }
            return v.0
        }
        // moc: brak pakietu > 3 s = 0 W (pedały przestają nadawać, gdy nie kręcisz)
        let p: Int? = lastPower == nil ? nil : (fresh(lastPower.map { ($0.w, $0.at) }, 3) ?? 0)
        return (p, fresh(lastHr.map { ($0.bpm, $0.at) }, 5), fresh(lastCadence.map { ($0.rpm, $0.at) }, 4), lastBalance)
    }

    private func process(_ s: Int, _ pIn: Int?, _ hr: Int?, _ cad: Int?, _ bal: Double?, speak: Bool) {
        lastSecond = s
        let p = max(0, pIn ?? 0)
        P.append(p)
        HR.append(hr)
        CADS.append(cad ?? 0)
        if !replaying { onSecond?(s, pIn, hr, cad, bal) }
        defer { if speak && !replaying { emitLive(s, pIn, hr, cad, bal) } }

        if s == 0 {
            if phase == .free { say("freeStart", [:], .info, speak) } else { announceStep(0, speak) }
        }
        checkSensors(s, speak)
        briefingTick(s, speak)
        fuelTick(s, speak)
        if phase == .free { freeTick(s, speak); return }
        guard let st = step else { return }
        if p < R.autoPauseWatts && (cad == nil || cad == 0) { quietUntil = s + Self.quietAfterStopSec }
        let autoInterval = st.isInterval && isAuto(stepIdx)

        // --- interwał: auto-pauza i wznowienie; elastyczny dodatkowo wcześniejsze przerwanie
        if st.isInterval && st.durationSec >= 60 {
            let low = Double(st.powerLow)
            if phase == .autoPaused {
                resumeRun = Double(p) >= low * R.autoStartPct ? resumeRun + 1 : 0
                if resumeRun < R.resumeSec { return }
                phase = .running
                if R.resumeSec > 1 {
                    for k in stride(from: R.resumeSec - 1, through: 1, by: -1) { stepSecs.append(s - k); inStep += 1 }
                }
                say("autoResume", ["left": Phrases.duration(st.durationSec - inStep)], .pause, speak)
            } else {
                let isStopped = p < R.autoPauseWatts && (cad == nil || cad == 0)
                lowRun = isStopped ? lowRun + 1 : 0
                if lowRun >= R.autoPauseSec && st.durationSec - inStep > 0 {
                    let back = min(R.autoPauseSec - 1, stepSecs.count)
                    stepSecs.removeLast(back)
                    inStep -= back
                    phase = .autoPaused; lowRun = 0; resumeRun = 0; easeRun = 0
                    say("autoPause", ["left": Phrases.duration(st.durationSec - inStep)], .pause, speak)
                    return
                }
                // średnia z kilku sekund – chwilowe odpuszczenie (ruch, skrzyżowanie) nie kończy interwału
                let easeAvg = Double(P.suffix(R.earlyStopAvgSec).reduce(0, +)) / Double(max(1, min(R.earlyStopAvgSec, P.count)))
                let easing = autoInterval && !isStopped && easeAvg < low * R.earlyStopPct
                easeRun = easing ? easeRun + 1 : 0
                if easeRun >= R.earlyStopSec && st.durationSec - inStep > 20 {
                    let back = min(R.earlyStopSec - 1, stepSecs.count)
                    stepSecs.removeLast(back)
                    inStep -= back
                    say("earlyStop", ["done": Phrases.duration(inStep)], .info, speak)
                    closeInterval(early: true, speak: speak)
                    enterStep(stepIdx + 1, startSec: s - back, pre: back + 1, speak: speak)
                    return
                }
            }
        }

        inStep += 1
        stepSecs.append(s)
        let remaining = st.durationSec - inStep
        let nextAuto = stepIdx + 1 < script.steps.count && isAuto(stepIdx + 1)
        let armed = nextAuto && remaining < R.armLeadSec
        if phase != .autoPaused { phase = nextAuto && remaining < 0 ? .waiting : (armed ? .armed : .running) }

        structuralCues(st, remaining: remaining, nextAuto: nextAuto, speak: speak)
        if !armed { corrections(st, s: s, cad: cad, remaining: remaining, speak: speak) }
        hrCoach(st, s: s, remaining: remaining, speak: speak)

        // --- czuwanie: wykrycie startu kolejnego interwału
        // (przy krótkiej przerwie nie łapiemy "rozpędu" z poprzedniego interwału jako nowego startu)
        let minRest = min(20, st.durationSec / 2)
        if nextAuto && remaining < R.armLeadSec && inStep > minRest {
            let next = script.steps[stepIdx + 1]
            let thr = Double(next.powerLow) * R.autoStartPct
            // seria sekund nad progiem; jedna krótka "dziura" (szum pomiaru) nie przerywa serii
            if Double(p) >= thr {
                if startRun == 0 { startRunAt = s; startDips = 0 }
                startRun += 1
            } else if startRun > 0 && startDips == 0 {
                startDips = 1
            } else {
                startRun = 0; startDips = 0
            }
            if startRun >= R.autoStartSec {
                let startSec = startRunAt
                let rest = startSec - stepStartSec
                let wasRecovery = st.type == "recovery"
                enterStep(stepIdx + 1, startSec: startSec, pre: s - startSec + 1, speak: false)
                lastRestSec = rest
                let av = ["dur": Phrases.duration(next.durationSec), "low": "\(next.powerLow)", "high": "\(next.powerHigh)"]
                var text = Phrases.render(phrases["autoStart"] ?? "", av)
                if wasRecovery && abs(rest - st.durationSec) > 20, let ri = phrases["restInfo"] {
                    text += " " + Phrases.render(ri, ["rest": Phrases.duration(rest)])
                }
                emit(text, .step, speak, key: "autoStart", vars: av)
                return
            }
            if remaining < 0 && (-remaining) % R.waitRemindSec == 0 {
                say("waiting", ["n": "\(intervalNumbers[stepIdx + 1] ?? 0)", "rest": Phrases.duration(inStep)], .info, speak)
            }
            return // krok przed auto-interwałem nie kończy się z zegarem
        }

        // --- przejście z zegarem
        if remaining <= 0 {
            if st.isInterval { closeInterval(early: false, speak: speak) }
            enterStep(stepIdx + 1, startSec: s + 1, pre: 0, speak: speak)
        }
    }

    // MARK: - Kroki

    private func enterStep(_ idx: Int, startSec: Int, pre: Int, speak: Bool) {
        if idx >= script.steps.count { planDone(speak); return }
        stepIdx = idx; stepStartSec = startSec; inStep = pre
        stepSecs = pre > 0 ? Array(startSec..<(startSec + pre)) : []
        startRun = 0; startDips = 0; lowRun = 0; easeRun = 0; resumeRun = 0
        outHigh = 0; outLow = 0; inRangeStreak = 0; cadLowRun = 0; cadHighRun = 0
        lastCorrection = -1_000_000
        spoke.removeAll()
        hrHighRun = 0; hrRecStart = nil; corrRepeat = 0; lastCorrDir = 0
        phase = .running
        if !isAuto(idx) { announceStep(idx, speak) }
    }

    private func announceStep(_ idx: Int, _ speak: Bool) {
        let st = script.steps[idx]
        let key: String
        switch st.type {
        case "interval": key = "intervalStart"
        case "recovery": key = "recoveryStart"
        case "warmup": key = "warmupStart"
        case "cooldown": key = "cooldownStart"
        default: key = "steadyStart"
        }
        let vars = ["n": "\(intervalNumbers[idx] ?? 0)", "total": "\(intervalCount)", "name": st.name,
                    "dur": Phrases.duration(st.durationSec), "low": "\(st.powerLow)", "high": "\(st.powerHigh)"]
        // własny tekst kroku (AI) idzie na ekran, a Enzo mówi swoje wejście dla tego typu kroku
        if let c = st.cueStart, !c.isEmpty { emit(c, .step, speak, key: key, vars: vars); return }
        say(key, vars, .step, speak)
    }

    private func closeInterval(early: Bool, speak: Bool) {
        guard let st = step else { return }
        let secs = stepSecs
        let pw = secs.map { P[$0] }
        let evalEnd = max(R.graceSec, secs.count - 3)
        let evalSecs = secs.count > R.graceSec ? Array(secs[R.graceSec..<evalEnd]) : []
        let tolC = max(R.deadbandW, Double(st.powerLow + st.powerHigh) / 2 * R.deadbandPct)
        var inR = 0
        if secs.count > R.graceSec {
            for k in R.graceSec..<evalEnd {
                let a = Double(avgInt(secs[max(0, k - 29)...k].map { P[$0] }))
                if a >= Double(st.powerLow) - tolC && a <= Double(st.powerHigh) + tolC { inR += 1 }
            }
        }
        let hrs = secs.compactMap { HR[$0] }.filter { $0 > 0 }
        let res = SeriesResult(
            n: intervalNumbers[stepIdx] ?? series.count + 1, durationSec: secs.count, plannedSec: st.durationSec,
            avgPower: avgInt(pw), compliancePct: evalSecs.isEmpty ? 0 : Int((Double(inR) / Double(evalSecs.count) * 100).rounded()),
            avgHr: hrs.isEmpty ? nil : avgInt(hrs), endedEarly: early, restBeforeSec: lastRestSec, startSec: stepStartSec)
        let prev = series.last
        series.append(res)
        var sv = ["n": "\(res.n)", "total": "\(intervalCount)", "dur": Phrases.duration(res.durationSec),
                  "avg": "\(res.avgPower)", "pct": "\(res.compliancePct)"]
        var text = Phrases.render(phrases["seriesEnd"] ?? "", sv)
        if let p = prev, let t = phrases["seriesPrev"] { text += " " + Phrases.render(t, ["prev": "\(p.avgPower)"]) }
        if series.count >= 2, !spokeHr, let first = series.first, let h1 = first.avgHr, let h = res.avgHr,
           abs(Double(res.avgPower - first.avgPower)) <= Double(first.avgPower) * 0.03, h - h1 >= R.hrDriftBpm,
           let t = phrases["hrUp"] {
            text += " " + Phrases.render(t, ["d": "\(h - h1)"])
            sv["hrUp"] = "\(h - h1)"
            spokeHr = true
        }
        emit(text, .summary, speak, key: "seriesEnd", vars: sv)   // jeden komunikat Enzo, bez głosu systemowego
        lastRestSec = nil
    }

    private func planDone(_ speak: Bool) {
        phase = .free
        let list = series.map { "\($0.avgPower)" }.joined(separator: ", ")
        say("planDone", ["list": list.isEmpty ? "brak" : list], .summary, speak)
        if !replaying { onPlanFinished?(makeSummary(file: "")) }
    }

    // MARK: - Komunikaty

    private func structuralCues(_ st: WorkoutStep, remaining: Int, nextAuto: Bool, speak: Bool) {
        func once(_ k: String) -> Bool { spoke.insert(k).inserted }
        // długie kroki: raport co 10 min – średnia całego odcinka + tętno (zamiast „połowy”)
        let reports = st.isWork && st.durationSec >= R.statusMinStepSec && lastSecond >= quietUntil
        if reports && inStep > 0 && inStep % R.statusEverySec == 0 && remaining > 120 && lastSecond - lastCorrection >= 30 {
            let avg = avgInt(stepSecs.map { P[$0] }.filter { $0 >= R.autoPauseWatts })
            let hr = hrAvg(30)
            var state = ""
            if let h = hr, st.hrHigh != nil || st.hrLow != nil {
                if let hi = st.hrHigh, h > hi + R.hrMarginBpm { state = "high" }
                else if let lo = st.hrLow, h < lo - R.hrMarginBpm { state = "low" }
                else { state = "ok" }
            }
            let stateTxt = ["ok": ", w normie", "high": ", powyżej strefy", "low": ", poniżej strefy"][state] ?? ""
            let hrTxt = hr.map { " Tętno \($0)\(stateTxt)." } ?? ""
            say("status", ["avg": "\(avg)", "hr": hr.map { "\($0)" } ?? "", "hrState": state, "hrTxt": hrTxt], .info, speak)
        }
        if st.isInterval && st.durationSec >= 120 && !reports && inStep == st.durationSec / 2 && once("half") {
            say("half", ["avg": "\(avgInt(stepSecs.map { P[$0] }))"], .info, speak)
        }
        if st.isInterval && st.durationSec >= 180 && remaining == 60 && once("lastMin") {
            say("lastMinute", [:], .info, speak)
        }
        let countdown = ["", "Jeden", "Dwa", "Trzy"]
        if nextAuto {
            let next = script.steps[stepIdx + 1]
            let lead = min(R.armLeadSec, st.durationSec - 1)
            if remaining == lead && once("arm") {
                say("armNext", ["n": "\(intervalNumbers[stepIdx + 1] ?? 0)", "total": "\(intervalCount)",
                                "dur": Phrases.duration(next.durationSec), "low": "\(next.powerLow)", "high": "\(next.powerHigh)"], .arm, speak)
            }
            if remaining == 10 && lead > 15 && once("ten") { say("tenSec", [:], .countdown, speak) }
            if (1...3).contains(remaining) { say("count", ["n": "\(remaining)", "word": countdown[remaining]], .countdown, speak) }
            if remaining == 0 && once("go") { say("goNow", [:], .countdown, speak) }
        } else if stepIdx + 1 < script.steps.count, script.steps[stepIdx + 1].isInterval, (1...3).contains(remaining) {
            say("count", ["n": "\(remaining)", "word": countdown[remaining]], .countdown, speak)
        }
    }

    private func corrections(_ st: WorkoutStep, s: Int, cad: Int?, remaining: Int, speak: Bool) {
        // korekty na ŚREDNIEJ: okno rośnie z długością kroku (20–60 s), a średnia całego kroku też musi być
        // poza zakresem – krótki zryw lub chwilowe odpuszczenie (ruch, skrzyżowanie) nie wywołuje komunikatu
        let D = st.durationSec
        let grace = clampI(Int((Double(D) * 0.1).rounded()), R.corrGraceMinSec, R.corrGraceMaxSec)
        guard inStep > grace, remaining > 3, st.type != "warmup" else { return }
        if s < quietUntil { outHigh = 0; outLow = 0; inRangeStreak = 0; return }   // postój / ruszanie
        // w pracy liczymy tylko sekundy, w których naprawdę jedziesz – dziura od ruchu nie zaniża średniej
        let from = stepSecs[min(10, stepSecs.count - 1)]
        let minP = Double(st.powerLow) * R.earlyStopPct
        let act = st.isWork ? stepSecs.filter { Double(P[$0]) >= minP } : stepSecs
        let winLen = clampI(Int((Double(D) / 6).rounded()), R.corrWindowMinSec, R.corrWindowMaxSec)
        if act.count < winLen { outHigh = 0; outLow = 0; return }
        let roll = avgInt(act.suffix(winLen).map { P[$0] })
        let cum = avgInt(act.filter { $0 >= from }.map { P[$0] })
        let tol = Int(max(R.deadbandW, Double(st.powerLow + st.powerHigh) / 2 * R.deadbandPct).rounded())
        let inRange = roll >= st.powerLow - tol / 2 && roll <= st.powerHigh + tol / 2
        outHigh = roll > st.powerHigh + tol && cum > st.powerHigh ? outHigh + 1 : 0
        outLow = st.isWork && roll < st.powerLow - tol && cum < st.powerLow ? outLow + 1 : 0
        inRangeStreak = inRange ? inRangeStreak + 1 : 0
        // kolejna uwaga w tę samą stronę coraz rzadziej (1×, 2×, 3× przerwy); schłodzenie – najwyżej jedna
        let can = s - lastCorrection >= clampI(Int((Double(D) / 4).rounded()), R.cooldownSec, R.cooldownMaxSec) * (1 + corrRepeat)
            && !(st.type == "cooldown" && corrRepeat > 0)
        let dHigh = r5(roll - st.powerHigh), dLow = r5(st.powerLow - roll)
        if can && outHigh >= R.outOfRangeSec && dHigh >= R.minDeltaW {
            say(st.isWork ? "tooHigh" : "recoveryTooHigh", ["delta": "\(dHigh)", "high": "\(st.powerHigh)"], .correction, speak)
            corrRepeat = lastCorrDir == 1 ? corrRepeat + 1 : 1; lastCorrDir = 1
            lastCorrection = s; outHigh = 0; return
        }
        // wyraźne odpuszczenie w interwale elastycznym obsługuje "przerwałeś", nie "dodaj 125 W"
        let givingUp = st.isInterval && isAuto(stepIdx) && easeRun >= 3
        if can && !givingUp && outLow >= R.outOfRangeSec && dLow >= R.minDeltaW {
            say("tooLow", ["delta": "\(dLow)", "low": "\(st.powerLow)"], .correction, speak)
            corrRepeat = lastCorrDir == -1 ? corrRepeat + 1 : 1; lastCorrDir = -1
            lastCorrection = s; outLow = 0; return
        }
        if st.isInterval && inRangeStreak >= R.praiseAfterSec && remaining > 30 && spoke.insert("praise").inserted {
            say("praise", [:], .praise, speak)
        }
        if let c = cad, c > 0 {
            cadLowRun = (st.cadenceLow.map { c < $0 } ?? false) ? cadLowRun + 1 : 0
            cadHighRun = (st.cadenceHigh.map { c > $0 } ?? false) ? cadHighRun + 1 : 0
            if can && cadLowRun >= R.cadenceGraceSec, let lo = st.cadenceLow {
                say("cadenceLow", ["cad": "\(c)", "cadLow": "\(lo)"], .cadence, speak); lastCorrection = s; cadLowRun = 0
            } else if can && cadHighRun >= R.cadenceGraceSec, let hi = st.cadenceHigh {
                say("cadenceHigh", ["cad": "\(c)", "cadHigh": "\(hi)"], .cadence, speak); lastCorrection = s; cadHighRun = 0
            }
        }
    }

    // MARK: - Stan dla rozmowy z trenerem

    /// Migawka jazdy dla pytań „jak mi idzie?” (lokalnie i na serwer). Tylko wartości nie-nil (JSON).
    func coachState() -> [String: Any] {
        var d: [String: Any] = ["elapsedSec": max(0, lastSecond), "phase": isPaused ? "paused" : phase.rawValue,
                                "ftp": script.ftp, "workout": script.name]
        d["power3s"] = avgInt(Array(P.suffix(3)))
        d["power30s"] = avgInt(Array(P.suffix(30)))
        d["avgPowerRide"] = avgInt(P.filter { $0 >= R.autoPauseWatts })
        if let h = hrAvg(10) { d["hr"] = h }
        let cads = CADS.suffix(10).filter { $0 > 0 }
        if !cads.isEmpty { d["cadence"] = avgInt(Array(cads)) }
        d["kJ"] = P.reduce(0, +) / 1000
        d["sinceEatSec"] = max(0, lastSecond - lastEat)
        d["sinceDrinkSec"] = max(0, lastSecond - lastDrink)
        let ivNos = intervalNumbers.enumerated().compactMap { i, n in n == nil ? nil : i }
        d["intervalsLeft"] = ivNos.filter { $0 > stepIdx }.count
        d["inInterval"] = phase != .free && step?.isInterval == true
        if phase != .free, let st = step {
            var sd: [String: Any] = ["name": st.name, "type": st.type, "elapsedSec": inStep,
                                     "remainingSec": max(0, st.durationSec - inStep), "durationSec": st.durationSec,
                                     "targetLow": st.powerLow, "targetHigh": st.powerHigh,
                                     "avgPower": avgInt(stepSecs.map { P[$0] }.filter { $0 >= R.autoPauseWatts })]
            if let v = st.hrLow { sd["hrLow"] = v }
            if let v = st.hrHigh { sd["hrHigh"] = v }
            if let n = intervalNumbers[stepIdx] { sd["intervalNo"] = n; sd["intervalCount"] = intervalCount }
            d["step"] = sd
            let rest = script.steps.dropFirst(stepIdx + 1)
            d["planRemainingSec"] = rest.reduce(0) { $0 + $1.durationSec } + max(0, st.durationSec - inStep)
            if let n = rest.first {
                var nd: [String: Any] = ["name": n.name, "type": n.type, "durationSec": n.durationSec, "targetLow": n.powerLow, "targetHigh": n.powerHigh]
                if let no = intervalNumbers[stepIdx + 1] { nd["intervalNo"] = no; nd["intervalCount"] = intervalCount }
                d["nextStep"] = nd
            }
        }
        d["series"] = series.map { x -> [String: Any] in
            var o: [String: Any] = ["n": x.n, "durationSec": x.durationSec, "avgPower": x.avgPower, "compliancePct": x.compliancePct]
            if let h = x.avgHr { o["avgHr"] = h }
            return o
        }
        if let b = script.briefing {
            if let r = b.readiness { d["readiness"] = Int(r.rounded()) }
            if let s = b.readyState { d["readyState"] = s }
        }
        return d
    }

    // MARK: - Jedzenie i picie

    /// „Zjadłem” / „wypiłem” (głosem) – przesuwa przypomnienia.
    func fueled(_ kind: String) {
        if kind == "eat" { lastEat = max(0, lastSecond) }
        lastDrink = max(0, lastSecond)
    }

    /// Przypomnienia na dłuższych jazdach: pić co 20 min, jeść co 40 min (co 30 przy mocnym planie).
    /// Nie w trakcie interwału – poczekamy na przerwę (najdłużej 10 min). Tak samo jak flex-engine.ts.
    private func fuelTick(_ s: Int, _ speak: Bool) {
        guard phase != .autoPaused, s > 0 else { return }
        let total = script.steps.reduce(0) { $0 + $1.durationSec }
        let free = script.steps.isEmpty
        let drinkOn = free ? s >= 1200 : total >= 2700
        let eatOn = free ? s >= 3600 : total >= 4500
        let hard = script.steps.contains { $0.isInterval && script.ftp > 0 && Double($0.powerLow) >= Double(script.ftp) * 0.88 }
        let eatEvery = hard ? 1800 : 2400
        let st = phase == .free ? nil : step
        let working = st?.isInterval == true   // w trakcie pracy nie przeszkadzamy
        func due(_ last: Int, _ every: Int) -> Bool { s - last >= every && (!working || s - last >= every + 600) }
        if eatOn && due(lastEat, eatEvery) {
            lastEat = s; lastDrink = s
            say("eat", [:], .info, speak)
        } else if drinkOn && due(lastDrink, 1200) {
            lastDrink = s
            say("drink", [:], .info, speak)
        }
    }

    // MARK: - Odprawa na rozgrzewce

    private static let briefReadySec = 150, briefCondFrom = 360, briefCondSec = 600

    /// Gotowość dziś (z PMC) po 2,5 min i „kondycja” jak w Garminie po 10 min: tętno przy tej mocy
    /// względem Twoich ostatnich jazd (model HR = hrA + hrB·W liczony na serwerze).
    private func briefingTick(_ s: Int, _ speak: Bool) {
        guard let b = script.briefing else { return }
        if s == Self.briefReadySec, let r = b.readiness {
            say("readiness", ["pct": "\(Int(r.rounded()))", "level": b.readyColor ?? "yellow", "state": b.readyState ?? "",
                              "heavy": (b.yTss ?? 0) >= 150 ? "1" : "0"], .info, speak)
        }
        if s == Self.briefCondSec, let a = b.hrA, let k = b.hrB {
            var pw = 0.0, hr = 0.0, n = 0
            for i in Self.briefCondFrom...s where i < P.count {
                if P[i] >= 50, let h = HR[i], h > 0 { pw += Double(P[i]); hr += Double(h); n += 1 }
            }
            guard Double(n) >= Double(s - Self.briefCondFrom) * 0.6 else { return }
            pw /= Double(n); hr /= Double(n)
            let exp = a + k * pw
            guard exp > 60 else { return }
            let c = max(-10, min(10, Int(((exp - hr) / exp * 100).rounded())))
            say("condition", ["n": "\(c)", "sign": c > 0 ? "+" : "", "level": c >= 3 ? "good" : (c <= -3 ? "bad" : "ok")], .info, speak)
        }
    }

    // MARK: - Tętno

    /// Średnie tętno z ostatnich n s (nil = brak pasa / za mało odczytów).
    private func hrAvg(_ n: Int) -> Int? {
        let a = HR.suffix(n).compactMap { $0 }.filter { $0 > 0 }
        return a.count >= max(1, n / 2) ? avgInt(a) : nil
    }

    private func hrCoach(_ st: WorkoutStep, s: Int, remaining: Int, speak: Bool) {
        // przerwa: potwierdzenie regeneracji, gdy tętno zejdzie poniżej progu (raz na przerwę)
        if st.type == "recovery" {
            guard let thr = st.hrHigh, !spoke.contains("hrRec") else { return }
            if inStep == 15 { hrRecStart = hrAvg(10) }
            let quiet = (remaining > 12 && abs(remaining - R.armLeadSec) > 8) || remaining < -3  // nie wchodź w zapowiedź/odliczanie
            if inStep >= 45, let h = hrAvg(10), h <= thr, (hrRecStart ?? 0) > thr + 5, quiet {
                spoke.insert("hrRec")
                say("hrRecovered", ["hr": "\(h)"], .info, speak)
            }
            return
        }
        // tętno ponad zakresem (jazda w strefie, rozgrzewka, schłodzenie – w interwałach decyduje moc)
        guard !st.isInterval, st.type != "cooldown", let hi = st.hrHigh, inStep > R.hrGraceSec, remaining > 30, s >= quietUntil else { hrHighRun = 0; return }
        let hr = hrAvg(30)
        hrHighRun = (hr.map { $0 > hi + R.hrMarginBpm } ?? false) ? hrHighRun + 1 : 0
        if hrHighRun >= R.hrAlertSec, s - lastHrAlert >= R.hrCooldownSec, s - lastCorrection >= 60, let h = hr {
            say("hrHigh", ["hr": "\(h)", "high": "\(hi)"], .correction, speak)
            lastHrAlert = s; lastCorrection = s; hrHighRun = 0
        }
    }

    // MARK: - Jazda swobodna: automatyczne wysiłki

    private func freeTick(_ s: Int, _ speak: Bool) {
        let ftp = Double(script.ftp)
        guard ftp > 0, s >= 9 else { return }
        let avg10 = Double(P[(s - 9)...s].reduce(0, +)) / 10
        if !inEffort && avg10 >= ftp * R.effortStartPct {
            inEffort = true; effortStart = s - 9
        } else if inEffort && avg10 < ftp * R.effortEndPct {
            inEffort = false
            var a = effortStart, b = s
            let thr = ftp * 0.8
            while a < b && Double(P[a]) < thr { a += 1 }
            while b > a && Double(P[b]) < thr { b -= 1 }
            let dur = b - a + 1
            if dur >= R.effortMinSec {
                let avg = avgInt(Array(P[a...b]))
                efforts.append(EffortResult(startSec: a, durationSec: dur, avgPower: avg))
                say("effort", ["dur": Phrases.duration(dur), "avg": "\(avg)"], .effort, speak)
            }
        }
    }

    // MARK: - Podsumowanie

    func makeSummary(file: String) -> WorkoutSummary {
        let n = P.count
        let total = P.reduce(0, +)
        let hrs = HR.compactMap { $0 }.filter { $0 > 0 }
        let evalSec = series.reduce(0) { $0 + $1.durationSec }
        let weighted = series.reduce(0) { $0 + $1.compliancePct * $1.durationSec }
        return WorkoutSummary(
            file: file, durationSec: n, avgPower: n > 0 ? total / n : 0, normalizedPower: normalizedPower(),
            avgHr: hrs.isEmpty ? nil : avgInt(hrs), maxHr: hrs.max(), kJ: total / 1000,
            compliancePct: evalSec > 0 ? weighted / evalSec : 0, series: series, efforts: efforts)
    }

    /// Ręczne zakończenie (przycisk Stop) – w dowolnym momencie, także po planie.
    func stop() -> WorkoutSummary {
        if !stopped {
            if phase != .free, step?.isInterval == true, inStep >= 30 { closeInterval(early: true, speak: false) }
            stopped = true
        }
        return makeSummary(file: "")
    }

    /// Dla symulatora: co "zawodnik" powinien teraz robić.
    func simState() -> SimState {
        guard phase != .free, let st = step else {
            return SimState(phase: .free, stepIdx: stepIdx, type: "free", low: 0, high: 0, durationSec: 0, inStep: 0, next: nil, ftp: script.ftp)
        }
        let next = stepIdx + 1 < script.steps.count ? script.steps[stepIdx + 1] : nil
        return SimState(phase: phase, stepIdx: stepIdx, type: st.type, low: st.powerLow, high: st.powerHigh,
                        durationSec: st.durationSec, inStep: inStep, next: next, ftp: script.ftp)
    }

    struct SimState {
        let phase: Phase; let stepIdx: Int; let type: String; let low: Int; let high: Int
        let durationSec: Int; let inStep: Int; let next: WorkoutStep?; let ftp: Int
    }

    // MARK: - Pomocnicze

    private func emitLive(_ s: Int, _ p: Int?, _ hr: Int?, _ cad: Int?, _ bal: Double?) {
        let st = phase == .free ? nil : step
        let win = stepSecs.suffix(min(R.smoothingSec, stepSecs.count))
        let ps = win.isEmpty ? nil : avgInt(win.map { P[$0] })
        let p3 = avgInt(Array(P.suffix(3)))
        let dur = st?.durationSec ?? 0
        onLive?(LiveSample(
            elapsed: s, phase: isPaused ? "paused" : phase.rawValue, stepIndex: stepIdx,
            stepName: st?.name ?? "Jazda swobodna", stepType: st?.type ?? "free",
            stepElapsed: st == nil ? 0 : inStep, stepRemaining: max(0, dur - inStep),
            overrunSec: phase == .waiting ? max(0, inStep - dur) : 0,
            power: p, power3s: p == nil ? nil : p3, powerSmooth: st == nil ? nil : ps, hr: hr, cadence: cad, balanceL: bal,
            targetLow: st?.powerLow ?? 0, targetHigh: st?.powerHigh ?? 0,
            inRange: (st != nil && ps != nil) ? (ps! >= st!.powerLow && ps! <= st!.powerHigh) : nil,
            lat: location?.lat, lon: location?.lon, lastSeries: series.last))
    }

    private func avgInt(_ a: [Int]) -> Int { a.isEmpty ? 0 : Int((Double(a.reduce(0, +)) / Double(a.count)).rounded()) }
    private func clampI(_ v: Int, _ lo: Int, _ hi: Int) -> Int { min(hi, max(lo, v)) }
    private func r5(_ v: Int) -> Int { max(5, Int((Double(v) / 5).rounded()) * 5) }

    private func normalizedPower() -> Int {
        guard P.count >= 30 else { return avgInt(P) }
        var sum = 0, acc4 = 0.0, cnt = 0
        for i in 0..<P.count {
            sum += P[i]
            if i >= 30 { sum -= P[i - 30] }
            if i >= 29 {
                let r = Double(sum) / 30.0
                acc4 += r * r * r * r
                cnt += 1
            }
        }
        return Int(pow(acc4 / Double(cnt), 0.25).rounded())
    }

    private func say(_ key: String, _ vars: [String: String], _ kind: CueKind, _ speak: Bool) {
        guard let t = phrases[key] else { return }
        emit(Phrases.render(t, vars), kind, speak, key: key, vars: vars)
    }

    private func emit(_ text: String, _ kind: CueKind, _ speak: Bool, key: String? = nil, vars: [String: String] = [:]) {
        guard speak, !replaying, !text.isEmpty else { return }
        onCue?(text, kind)
        onSpeak?(key, vars, text, kind)
    }
}
