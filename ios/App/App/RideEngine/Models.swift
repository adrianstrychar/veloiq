import Foundation

// MARK: - Skrypt treningu (zgodny z web/workout-script.ts)

struct WorkoutScript: Codable {
    let version: Int
    let id: String
    let name: String
    let ftp: Int
    let lang: String?
    let steps: [WorkoutStep]          // pusta lista = jazda swobodna
    let rules: WorkoutRules?
    let phrases: [String: String]?
}

struct WorkoutStep: Codable {
    let name: String
    let type: String // warmup | interval | recovery | steady | cooldown
    let durationSec: Int
    let powerLow: Int
    let powerHigh: Int
    let cadenceLow: Int?
    let cadenceHigh: Int?
    let cueStart: String?
    let start: String? // "auto" | "time" – domyślnie interwały ≥ 60 s → auto
    let hrLow: Int?    // zakres tętna kroku; recovery: hrHigh = próg „zregenerowany”
    let hrHigh: Int?

    var isInterval: Bool { type == "interval" }
    var isWork: Bool { type == "interval" || type == "steady" }
}

struct WorkoutRules: Codable {
    // liczby jako Double – skrypt z JS może zawierać ułamki; zaokrąglane w ResolvedRules
    var smoothingSec: Double?
    var outOfRangeSec: Double?
    var cooldownSec: Double?
    var graceSec: Double?
    var praiseAfterSec: Double?
    var cadenceGraceSec: Double?
    var hrDriftBpm: Double?
    // tryb elastyczny
    var armLeadSec: Double?
    var autoStartPct: Double?
    var autoStartSec: Double?
    var waitRemindSec: Double?
    var autoPauseWatts: Double?
    var autoPauseSec: Double?
    var earlyStopPct: Double?
    var earlyStopSec: Double?
    var effortStartPct: Double?
    var effortEndPct: Double?
    var effortMinSec: Double?
    // korekty na średniej + tętno
    var corrWindowMinSec: Double?
    var corrWindowMaxSec: Double?
    var corrGraceMinSec: Double?
    var corrGraceMaxSec: Double?
    var cooldownMaxSec: Double?
    var deadbandW: Double?
    var deadbandPct: Double?
    var minDeltaW: Double?
    var earlyStopAvgSec: Double?
    var hrMarginBpm: Double?
    var hrAlertSec: Double?
    var hrGraceSec: Double?
    var hrCooldownSec: Double?
    var statusEverySec: Double?
    var statusMinStepSec: Double?
}

/// Reguły z domyślnymi wartościami – identyczne jak DEFAULT_FLEX_RULES w web/flex-engine.ts
/// (te same wartości, bez dodatkowych ograniczeń, żeby obie implementacje zachowywały się tak samo).
struct ResolvedRules {
    let smoothingSec: Int, outOfRangeSec: Int, cooldownSec: Int, graceSec: Int
    let praiseAfterSec: Int, cadenceGraceSec: Int, hrDriftBpm: Int
    let armLeadSec: Int, autoStartPct: Double, autoStartSec: Int, waitRemindSec: Int
    let autoPauseWatts: Int, autoPauseSec: Int, resumeSec: Int
    let earlyStopPct: Double, earlyStopSec: Int
    let effortStartPct: Double, effortEndPct: Double, effortMinSec: Int
    let corrWindowMinSec: Int, corrWindowMaxSec: Int, corrGraceMinSec: Int, corrGraceMaxSec: Int, cooldownMaxSec: Int
    let deadbandW: Double, deadbandPct: Double, minDeltaW: Int, earlyStopAvgSec: Int
    let hrMarginBpm: Int, hrAlertSec: Int, hrGraceSec: Int, hrCooldownSec: Int, statusEverySec: Int, statusMinStepSec: Int

    init(_ r: WorkoutRules?) {
        func i(_ v: Double?, _ d: Int) -> Int { v.map { Int($0.rounded()) } ?? d }
        smoothingSec = max(1, i(r?.smoothingSec, 10))
        outOfRangeSec = i(r?.outOfRangeSec, 15)
        cooldownSec = i(r?.cooldownSec, 60)
        graceSec = i(r?.graceSec, 10)
        praiseAfterSec = i(r?.praiseAfterSec, 90)
        cadenceGraceSec = i(r?.cadenceGraceSec, 20)
        hrDriftBpm = i(r?.hrDriftBpm, 5)
        armLeadSec = i(r?.armLeadSec, 60)
        autoStartPct = r?.autoStartPct ?? 0.85
        autoStartSec = max(1, i(r?.autoStartSec, 6))
        waitRemindSec = max(1, i(r?.waitRemindSec, 120))   // dzielnik w % – nie może być 0
        autoPauseWatts = i(r?.autoPauseWatts, 30)
        autoPauseSec = max(1, i(r?.autoPauseSec, 5))
        resumeSec = 2
        earlyStopPct = r?.earlyStopPct ?? 0.6
        earlyStopSec = max(1, i(r?.earlyStopSec, 40))
        effortStartPct = r?.effortStartPct ?? 0.9
        effortEndPct = r?.effortEndPct ?? 0.75
        effortMinSec = i(r?.effortMinSec, 60)
        corrWindowMinSec = max(1, i(r?.corrWindowMinSec, 20))
        corrWindowMaxSec = max(1, i(r?.corrWindowMaxSec, 60))
        corrGraceMinSec = i(r?.corrGraceMinSec, 20)
        corrGraceMaxSec = i(r?.corrGraceMaxSec, 60)
        cooldownMaxSec = i(r?.cooldownMaxSec, 180)
        deadbandW = r?.deadbandW ?? 10
        deadbandPct = r?.deadbandPct ?? 0.03
        minDeltaW = i(r?.minDeltaW, 10)
        earlyStopAvgSec = max(1, i(r?.earlyStopAvgSec, 10))
        hrMarginBpm = i(r?.hrMarginBpm, 3)
        hrAlertSec = max(1, i(r?.hrAlertSec, 60))
        hrGraceSec = i(r?.hrGraceSec, 240)
        hrCooldownSec = i(r?.hrCooldownSec, 300)
        statusEverySec = max(60, i(r?.statusEverySec, 600))   // dzielnik w % – nie może być 0
        statusMinStepSec = i(r?.statusMinStepSec, 1200)
    }
}

// MARK: - Domyślne komunikaty (pl-PL) – zgodne z FLEX_PHRASES w web/flex-engine.ts

enum Phrases {
    static let defaults: [String: String] = [
        "armNext": "Za minutę interwał {n} z {total}. {dur}, {low} do {high} watów. Zacznij, kiedy będziesz gotowy.",
        "tenSec": "Dziesięć sekund.",
        "goNow": "Możesz startować.",
        "waiting": "Czekam na start interwału {n}. Przerwa trwa już {rest}.",
        "autoStart": "Start! {dur}, trzymaj {low} do {high} watów.",
        "restInfo": "Przerwa trwała {rest}.",
        "autoPause": "Pauza interwału. Zostało {left}.",
        "autoResume": "Wznawiam. Zostało {left}.",
        "earlyStop": "Interwał przerwany po {done}.",
        "seriesEnd": "Seria {n} z {total} zrobiona. {dur}, średnio {avg} watów, {pct} procent w zakresie.",
        "seriesPrev": "Poprzednia {prev}.",
        "hrUp": "Tętno o {d} uderzeń wyżej niż w pierwszej serii.",
        "intervalStart": "Interwał {n} z {total}. {dur}, cel {low} do {high} watów. Start!",
        "recoveryStart": "Przerwa {dur}. Kręć luźno, poniżej {high} watów.",
        "warmupStart": "Rozgrzewka, {dur}. Spokojnie, {low} do {high} watów.",
        "steadyStart": "{name}. {dur}, trzymaj {low} do {high} watów.",
        "cooldownStart": "Schłodzenie, {dur}. Luźno, poniżej {high} watów.",
        "tooHigh": "Za mocno. Odpuść {delta} watów.",
        "tooLow": "Za słabo. Dodaj {delta} watów.",
        "recoveryTooHigh": "To odpoczynek. Zejdź poniżej {high} watów.",
        "cadenceLow": "Kadencja {cad}. Podnieś do {cadLow}.",
        "cadenceHigh": "Kadencja {cad}. Zejdź do {cadHigh}.",
        "half": "Połowa. Średnio {avg} watów.",
        "lastMinute": "Ostatnia minuta. Trzymaj.",
        "praise": "Idealnie. Tak trzymaj.",
        "planDone": "Plan zrobiony. Serie: {list} watów. Nagrywam dalej – zakończ w aplikacji.",
        "freeStart": "Nagrywanie rozpoczęte. Jazda swobodna, wysiłki zapiszę automatycznie.",
        "effort": "Wysiłek {dur}, średnio {avg} watów.",
        "powerLost": "Brak sygnału mocy.",
        "powerBack": "Moc znowu jest.",
        "hrLost": "Brak sygnału tętna.",
        "hrBack": "Tętno wróciło.",
        "hrHigh": "Tętno {hr}, powyżej zakresu. Zwolnij trochę.",
        "hrRecovered": "Tętno spadło do {hr}. Jesteś gotowy.",
        "status": "Średnio {avg} watów.{hrTxt}",
    ]

    static func render(_ template: String, _ vars: [String: String]) -> String {
        var out = template
        for (k, v) in vars { out = out.replacingOccurrences(of: "{\(k)}", with: v) }
        // placeholder bez wartości → pusty (jak w TS)
        return out.replacingOccurrences(of: #"\{\w+\}"#, with: "", options: .regularExpression)
    }

    /// "8 minut", "30 sekund", "1 minuta 30 sekund" – w formie do przeczytania.
    static func duration(_ secIn: Int) -> String {
        let sec = max(0, secIn)
        let m = sec / 60, s = sec % 60
        func form(_ n: Int, _ one: String, _ few: String, _ many: String) -> String {
            if n == 1 { return "1 \(one)" }
            let l = n % 10, l2 = n % 100
            return "\(n) \((2...4).contains(l) && !(12...14).contains(l2) ? few : many)"
        }
        if m == 0 { return form(s, "sekunda", "sekundy", "sekund") }
        if s == 0 { return form(m, "minuta", "minuty", "minut") }
        return "\(form(m, "minuta", "minuty", "minut")) \(form(s, "sekunda", "sekundy", "sekund"))"
    }
}

// MARK: - Wyniki

struct SeriesResult {
    let n: Int
    let durationSec: Int
    let plannedSec: Int
    let avgPower: Int
    let compliancePct: Int
    let avgHr: Int?
    let endedEarly: Bool
    let restBeforeSec: Int?
    let startSec: Int

    func toDict() -> [String: Any] {
        var d: [String: Any] = ["n": n, "durationSec": durationSec, "plannedSec": plannedSec, "avgPower": avgPower,
                                "compliancePct": compliancePct, "endedEarly": endedEarly, "startSec": startSec]
        if let v = avgHr { d["avgHr"] = v }
        if let v = restBeforeSec { d["restBeforeSec"] = v }
        return d
    }
}

struct EffortResult {
    let startSec: Int
    let durationSec: Int
    let avgPower: Int
    func toDict() -> [String: Any] { ["startSec": startSec, "durationSec": durationSec, "avgPower": avgPower] }
}

// MARK: - Dane live i podsumowanie

struct LiveSample {
    var elapsed: Int
    var phase: String        // running | armed | waiting | autoPaused | free | paused
    var stepIndex: Int
    var stepName: String
    var stepType: String
    var stepElapsed: Int
    var stepRemaining: Int
    var overrunSec: Int      // o ile przeciąga się przerwa przed interwałem
    var power: Int?
    var power3s: Int?
    var powerSmooth: Int?
    var hr: Int?
    var cadence: Int?
    var balanceL: Double?
    var targetLow: Int
    var targetHigh: Int
    var inRange: Bool?
    var lat: Double?
    var lon: Double?
    var lastSeries: SeriesResult?

    func toDict() -> [String: Any] {
        var d: [String: Any] = [
            "elapsed": elapsed, "phase": phase, "stepIndex": stepIndex, "stepName": stepName, "stepType": stepType,
            "stepElapsed": stepElapsed, "stepRemaining": stepRemaining, "overrunSec": overrunSec,
            "targetLow": targetLow, "targetHigh": targetHigh,
        ]
        if let v = power { d["power"] = v }
        if let v = power3s { d["power3s"] = v }
        if let v = powerSmooth { d["powerSmooth"] = v }
        if let v = hr { d["hr"] = v }
        if let v = cadence { d["cadence"] = v }
        if let v = balanceL { d["balanceL"] = v }
        if let v = inRange { d["inRange"] = v }
        if let v = lat { d["lat"] = v }
        if let v = lon { d["lon"] = v }
        if let v = lastSeries { d["lastSeries"] = v.toDict() }
        return d
    }
}

struct WorkoutSummary {
    var file: String
    var durationSec: Int
    var avgPower: Int
    var normalizedPower: Int
    var avgHr: Int?
    var maxHr: Int?
    var kJ: Int
    var compliancePct: Int
    var series: [SeriesResult] = []
    var efforts: [EffortResult] = []

    func toDict() -> [String: Any] {
        var d: [String: Any] = [
            "file": file, "durationSec": durationSec, "avgPower": avgPower,
            "normalizedPower": normalizedPower, "kJ": kJ, "compliancePct": compliancePct,
            "series": series.map { $0.toDict() }, "efforts": efforts.map { $0.toDict() },
        ]
        if let v = avgHr { d["avgHr"] = v }
        if let v = maxHr { d["maxHr"] = v }
        return d
    }
}
