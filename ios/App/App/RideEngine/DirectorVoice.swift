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
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak self] n in
            if let it = n.object as? AVPlayerItem { self?.itemEnded(it) }
        }
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted(_:)),
                                               name: AVAudioSession.interruptionNotification, object: nil)
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
        "hrHigh": "hrHigh", "hrRecovered": "hrRec", "status": "status",
        "rideAutoPause": "pause", "rideAutoResume": "resume",
        "navStart": "navStart", "navToStart": "navToStart", "navOff": "navOff", "navBack": "navBack",
        "navTop": "navTop", "navDone": "navDone",
        "listen": "listen", "repeat": "repeat", "think": "think", "offline": "offline", "doneCmd": "doneCmd",
        "left": "left", "power": "power",
        "nextInfo": "nextInfo", "planEnd": "planEnd", "ivlLeft": "ivlLeft", "lastIvl": "lastIvl", "ivlDone": "ivlDone", "prevSeries": "prevSeries", "noSeries": "noSeries", "planLeft": "planLeft", "fuelAdvice": "fuelAdvice", "eatNow": "eatNow", "eatLater": "eatLater", "ateOk": "ateOk", "drankOk": "drankOk", "motivate": "motivate", "drink": "drink", "eat": "eat",
    ]
    private static let silent: Set<String> = ["seriesPrev", "restInfo"]

    private func has(_ id: String) -> Bool { pack.clips[id] != nil }
    func hasClip(_ id: String) -> Bool { pack.clips[id] != nil }
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
    private func bpm(_ v: String?) -> [String] {
        guard let h = num(v) else { return [] }
        let id = "hrv.\(Int(h.rounded()))"
        return has(id) ? [id] : []
    }
    /// Losowy wariant z grupy (np. hrs.ok.*), bez powtórzenia pod rząd.
    private func pick(_ prefix: String) -> [String] {
        let ids = pack.clips.keys.filter { $0.hasPrefix(prefix + ".") }.sorted()
        guard !ids.isEmpty else { return [] }
        var i = Int.random(in: 0..<ids.count)
        if ids.count > 1 && i == last[prefix] { i = (i + 1) % ids.count }
        last[prefix] = i
        return [ids[i]]
    }
    private func watts(_ v: String?) -> [String] {
        guard let w = num(v) else { return [] }
        return has("w.\(r5(w))") ? ["w.\(r5(w))"] : []
    }

    /// nil = nic nie mów; [] = brak nagrania (użyj głosu systemowego).
    func compose(_ key: String, _ vars: [String: String]) -> [String]? {
        if Self.silent.contains(key) { return nil }
        // komunikaty bez stałego wejścia: odliczanie, odprawa
        // nawigacja po trasie
        if key == "navTurn" {
            let out = ["dist.\(vars["dist"] ?? "0")", "dir.\(vars["dir"] ?? "")"].filter { has($0) }
            return out.count == 2 ? out : []
        }
        if key == "navClimb" || key == "navClimbStart" {
            var out: [String] = []
            if let l = lead(key) { out.append(l) }
            let len = num(vars["len"]) ?? 0
            let c = len < 0.75 ? "clen.0.5" : "clen.\(min(25, Int(len.rounded())))"
            if has(c) { out.append(c) }
            let g = "grade.\(min(15, max(2, Int((num(vars["grade"]) ?? 0).rounded()))))"
            if has(g) { out.append(g) }
            return out
        }
        if key == "navLeft" {
            var out: [String] = []
            if let l = lead("navLeft") { out.append(l) }
            if let k = vars["km"], has("kmLeft.\(k)") { out.append("kmLeft.\(k)") }
            return out.count == 2 ? out : []
        }
        if key == "count" { let id = "cnt.\(vars["n"] ?? "")"; return has(id) ? [id] : nil }
        if key == "readiness" {
            let r = min(100, max(20, r5(num(vars["pct"]) ?? 0)))
            let lv = vars["level"] ?? "yellow"
            var out: [String] = has("rd.\(r)") ? ["rd.\(r)"] : []
            if let l = lead(lv == "green" ? "readyGreen" : (lv == "red" ? "readyRed" : "readyYellow")) { out.append(l) }
            if vars["heavy"] == "1", let l = lead("yHeavy") { out.append(l) }
            return out
        }
        if key == "condition" {
            let id = "cond.\(Int((num(vars["n"]) ?? 0).rounded()))"
            let lv = vars["level"] ?? "ok"
            var out: [String] = has(id) ? [id] : []
            if let l = lead(lv == "good" ? "condGood" : (lv == "bad" ? "condBad" : "condOk")) { out.append(l) }
            return out
        }
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
            if let d = num(vars["hrUp"]), has("hr.\(Int(d.rounded()))") {
                seg.append("hr.\(Int(d.rounded()))")
                if let l = lead("hr") { seg.append(l) }
            }
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
        case "hrHigh":
            seg += bpm(vars["hr"])
        case "hrRecovered":
            seg = bpm(vars["hr"]) + seg
        case "status":
            seg += watts(vars["avg"])
            let b = bpm(vars["hr"])
            if !b.isEmpty {
                seg += b
                if let st = vars["hrState"], !st.isEmpty { seg += pick("hrs." + st) }
            }
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

    // MARK: - Odtwarzanie: komunikat po komunikacie, bez zaległości

    private struct Msg { let ids: [String]; let at: Date }
    private var queue: [Msg] = []
    private var current: Msg?
    private var startedAt = Date.distantPast
    private var watchdog: Timer?
    /// Komunikat starszy niż tyle sekund nie jest już aktualny – nie gramy go.
    private static let maxAge: TimeInterval = 20

    /// Wywoływać na głównym wątku. interrupt: odliczanie przerywa zaległe komunikaty.
    func play(_ ids: [String], interrupt: Bool = false) {
        let all = ((has("fx.beep") ? ["fx.beep"] : []) + ids).filter { pack.clips[$0] != nil }
        guard all.count > (has("fx.beep") ? 1 : 0) else { return }
        if interrupt { queue.removeAll(); if current != nil { player.removeAllItems(); current = nil } }
        queue.append(Msg(ids: all, at: Date()))
        if current == nil { next() }
    }

    func stop() { queue.removeAll(); player.removeAllItems(); current = nil; releaseIfIdle() }

    private func next() {
        let now = Date()
        queue.removeAll { now.timeIntervalSince($0.at) > Self.maxAge }   // nieaktualne – precz
        guard !queue.isEmpty else { current = nil; stopWatchdog(); releaseIfIdle(); return }
        let m = queue.removeFirst()
        // sesja MIESZANA: Spotify gra dalej, tylko ściszony na czas komunikatu
        do {
            // w trakcie pytania do Enzo (mikrofon) nie zmieniamy kategorii – zepsułoby nagrywanie
            if session.category != .playAndRecord {
                try session.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
            }
            try session.setActive(true)
        } catch {
            // nie da się teraz grać (np. rozmowa telefoniczna) – nie kolejkujemy zaległości
            queue.removeAll(); current = nil; stopWatchdog(); return
        }
        player.removeAllItems()
        for id in m.ids { player.insert(AVPlayerItem(url: dir.appendingPathComponent(pack.clips[id]!.file)), after: nil) }
        current = m; startedAt = now
        player.play()
        startWatchdog()
    }

    /// Koniec klipu: jeśli to był ostatni klip komunikatu – następny komunikat.
    private func itemEnded(_ item: AVPlayerItem) {
        guard current != nil, player.items().contains(item) else { return }
        if player.items().count <= 1 {
            DispatchQueue.main.async { [weak self] in self?.current = nil; self?.next() }
        }
    }

    /// Jeśli system wstrzymał odtwarzanie (przerwanie, inna aplikacja) – porzuć, zamiast trzymać zaległości.
    private func startWatchdog() {
        guard watchdog == nil else { return }
        watchdog = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self = self, self.current != nil else { return }
            let stuck = self.player.timeControlStatus != .playing && Date().timeIntervalSince(self.startedAt) > 3
            if stuck || Date().timeIntervalSince(self.startedAt) > 30 {
                self.player.removeAllItems(); self.current = nil; self.next()
            }
        }
    }
    private func stopWatchdog() { watchdog?.invalidate(); watchdog = nil }

    /// Przerwanie sesji audio (połączenie, Siri, inna aplikacja) – czyścimy kolejkę.
    @objc private func interrupted(_ n: Notification) {
        guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
        DispatchQueue.main.async { [weak self] in
            self?.queue.removeAll(); self?.player.removeAllItems(); self?.current = nil; self?.stopWatchdog()
        }
    }

    /// Łączny czas klipów (z piknięciem) – do „Słucham!” → dopiero potem mikrofon.
    func duration(_ ids: [String]) -> Double {
        (["fx.beep"] + ids).compactMap { pack.clips[$0]?.dur }.reduce(0, +)
    }
    /// Ile jeszcze potrwają komunikaty w kolejce – rozmowa czeka, aż Enzo skończy.
    var pendingDuration: Double {
        var left = 0.0
        if current != nil, let cur = player.currentItem {
            left = max(0, cur.duration.seconds.isFinite ? cur.duration.seconds - cur.currentTime().seconds : 0)
            left += player.items().dropFirst().map { $0.asset.duration.seconds }.filter { $0.isFinite }.reduce(0, +)
        }
        return left + queue.map { m in m.ids.compactMap { pack.clips[$0]?.dur }.reduce(0, +) }.reduce(0, +)
    }

    private func releaseIfIdle() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let self = self, self.current == nil, self.queue.isEmpty,
                  self.session.category != .playAndRecord else { return }   // trwa rozmowa – mikrofon nie do ruszania
            try? self.session.setActive(false, options: .notifyOthersOnDeactivation)   // Spotify wraca do pełnej głośności
        }
    }
}
