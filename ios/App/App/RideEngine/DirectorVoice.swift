import AVFoundation

/// „Dyrektor Enzo” – lektor z nagranych klipów (offline, w paczce aplikacji: Voice/<id>/).
/// Komunikat silnika (klucz + zmienne) → emocjonalne wejście + liczby. Ta sama logika co lib/ride/director.ts.
/// Działa przy zgaszonym ekranie (UIBackgroundModes: audio) i ścisza muzykę na czas komunikatu.
final class DirectorVoice: NSObject {
    struct Clip: Decodable { let file: String; let dur: Double; let it: Bool? }
    struct Pack: Decodable { let id: String; let name: String; let clips: [String: Clip] }

    let pack: Pack
    private let dir: URL
    private let player = AVQueuePlayer()
    private let session = AVAudioSession.sharedInstance()
    private var last: [String: Int] = [:]
    private var lastIt = Date.distantPast     // włoskie wtrącenie – nie częściej niż co 3 min
    private var lastName = Date.distantPast   // imię – nie częściej niż co 8 min
    private var nameIds: [String] = []
    /// Imię zawodnika – jeśli paczka ma jego nagrania (name.<imię>.N).
    var name: String? {
        didSet {
            let slug = (name ?? "").folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
                .replacingOccurrences(of: "ł", with: "l").lowercased().split(separator: " ").first.map(String.init) ?? ""
            nameIds = slug.isEmpty ? [] : pack.clips.keys.filter { $0.hasPrefix("name.\(slug).") }.sorted()
        }
    }
    private var leadIds: [String: [String]] = [:]
    private var endObserver: NSObjectProtocol?

    /// nil, jeśli paczki nie ma w aplikacji.
    init?(id: String = "enzo") {
        guard let dir = Bundle.main.url(forResource: id, withExtension: nil, subdirectory: "Voice"),
              let data = try? Data(contentsOf: dir.appendingPathComponent("manifest.json")),
              let pack = try? JSONDecoder().decode(Pack.self, from: data) else { return nil }
        self.dir = dir
        self.pack = pack
        super.init()
        for k in pack.clips.keys where k.hasPrefix("lead.") {
            let ev = k.split(separator: ".")[1]
            leadIds[String(ev), default: []].append(k)
        }
        for k in leadIds.keys { leadIds[k]?.sort() }
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak self] _ in
            self?.releaseIfIdle()
        }
    }

    deinit { if let o = endObserver { NotificationCenter.default.removeObserver(o) } }

    private static let leadFor: [String: String] = [
        "armNext": "arm", "autoStart": "go", "intervalStart": "go", "warmupStart": "warmup", "recoveryStart": "recovery",
        "cooldownStart": "cooldown", "steadyStart": "steady", "tenSec": "ten", "goNow": "goNow", "waiting": "waiting",
        "autoPause": "pause", "autoResume": "resume", "manualPause": "pause", "manualResume": "resume", "earlyStop": "early",
        "seriesEnd": "seriesEnd", "hrUp": "hr", "tooHigh": "tooHigh", "tooLow": "tooLow", "recoveryTooHigh": "recTooHigh",
        "cadenceLow": "cadLow", "cadenceHigh": "cadHigh", "half": "half", "lastMinute": "last", "praise": "praise",
        "planDone": "done", "freeStart": "free", "effort": "effort",
        "powerLost": "powerLost", "powerBack": "powerBack", "hrLost": "hrLost", "hrBack": "hrBack",
    ]
    private static let silent: Set<String> = ["seriesPrev", "restInfo"]

    private func has(_ id: String) -> Bool { pack.clips[id] != nil }
    private func r5(_ v: Double) -> Int { Int((v / 5).rounded()) * 5 }
    private func num(_ s: String?) -> Double? { s.flatMap { Double($0.replacingOccurrences(of: ",", with: ".")) } }

    private func lead(_ ev: String) -> String? {
        guard var ids = leadIds[ev], !ids.isEmpty else { return nil }
        // włoskie „Forza / Bravissimo / Dai” to przyprawa – świeżo użyte → wybierz polski wariant
        let plain = ids.filter { pack.clips[$0]?.it != true }
        if Date().timeIntervalSince(lastIt) < 180 && !plain.isEmpty { ids = plain }
        var i = Int.random(in: 0..<ids.count)
        if ids.count > 1 && i == last[ev] { i = (i + 1) % ids.count }   // nigdy ten sam wariant dwa razy z rzędu
        last[ev] = i
        if pack.clips[ids[i]]?.it == true { lastIt = Date() }
        return ids[i]
    }

    private func dur(_ d: String?) -> [String] {
        guard let t = d else { return [] }
        func grab(_ word: String) -> Int? {
            guard let r = t.range(of: #"(\d+)\s*"# + word, options: .regularExpression) else { return nil }
            return Int(t[r].prefix { $0.isNumber })
        }
        var out: [String] = []
        if let m = grab("minut"), has("min.\(m)") { out.append("min.\(m)") }
        if let s = grab("sekund") {
            let near = [5, 10, 15, 20, 30, 40, 45].min { abs($0 - s) < abs($1 - s) }!
            if has("sec.\(near)") { out.append("sec.\(near)") }
        }
        return out
    }
    private func range(_ low: String?, _ high: String?) -> [String] {
        guard let l = num(low), let h = num(high) else { return [] }
        let a = "from.\(r5(l))", b = "to.\(r5(h))"
        if has(a) && has(b) { return [a, b] }
        return has("w.\(r5(h))") ? ["w.\(r5(h))"] : []
    }
    private func watts(_ v: String?) -> [String] {
        guard let w = num(v) else { return [] }
        return has("w.\(r5(w))") ? ["w.\(r5(w))"] : []
    }

    /// nil = nic nie mów; [] = brak nagrania (użyj głosu systemowego).
    func compose(_ key: String, _ vars: [String: String]) -> [String]? {
        if Self.silent.contains(key) { return nil }
        guard let ev = Self.leadFor[key], let first = lead(ev) else { return [] }
        var seg = [first]
        switch key {
        case "armNext":
            if let n = vars["n"], let t = vars["total"], has("int.\(n).\(t)") { seg.append("int.\(n).\(t)") }
            seg += dur(vars["dur"]) + range(vars["low"], vars["high"])
        case "autoStart", "intervalStart", "steadyStart":
            seg += dur(vars["dur"]) + range(vars["low"], vars["high"])
        case "warmupStart", "recoveryStart":
            seg += dur(vars["dur"])
        case "seriesEnd":
            seg += watts(vars["avg"])
            if let p = num(vars["pct"]), has("pct.\(Int(p.rounded()))") { seg.append("pct.\(Int(p.rounded()))") }
        case "hrUp":
            if let d = num(vars["d"]), has("hr.\(Int(d.rounded()))") { seg = ["hr.\(Int(d.rounded()))", first] }
        case "tooHigh":
            if let d = num(vars["delta"]), has("sub.\(r5(d))") { seg.append("sub.\(r5(d))") }
        case "tooLow":
            if let d = num(vars["delta"]), has("add.\(r5(d))") { seg.append("add.\(r5(d))") }
        case "half":
            seg += watts(vars["avg"])
        case "effort":
            seg += dur(vars["dur"]) + watts(vars["avg"])
        default: break
        }
        // imię tylko w kluczowych momentach i rzadko – wtedy działa
        let peak: Set<String> = ["autoStart", "intervalStart", "lastMinute", "seriesEnd", "planDone", "praise", "effort"]
        if peak.contains(key), !nameIds.isEmpty, Date().timeIntervalSince(lastName) > 480, Bool.random() {
            lastName = Date()
            seg.insert(nameIds.randomElement()!, at: 0)
        }
        return seg
    }

    /// Wywoływać na głównym wątku. interrupt: odliczanie przerywa zaległe komunikaty.
    func play(_ ids: [String], interrupt: Bool = false) {
        // piknięcie radia przed każdym komunikatem
        let ids = (has("fx.beep") ? ["fx.beep"] : []) + ids
        let items = ids.compactMap { id -> AVPlayerItem? in
            guard let c = pack.clips[id] else { return nil }
            return AVPlayerItem(url: dir.appendingPathComponent(c.file))
        }
        guard !items.isEmpty else { return }
        try? session.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        try? session.setActive(true)
        if interrupt { player.removeAllItems() }
        for it in items { player.insert(it, after: nil) }
        player.play()
    }

    func stop() { player.removeAllItems(); releaseIfIdle() }

    private func releaseIfIdle() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let self = self, self.player.items().isEmpty || self.player.currentItem == nil else { return }
            try? self.session.setActive(false, options: .notifyOthersOnDeactivation)
        }
    }
}
