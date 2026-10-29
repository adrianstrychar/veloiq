import Foundation
import Capacitor

/// Plugin Capacitor "RideEngine" – most między UI (Next.js w WebView) a natywnym silnikiem.
/// Cała pętla treningu działa natywnie, więc nie zależy od tego, czy WebView jest uśpiony.
@objc(RideEnginePlugin)
public class RideEnginePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RideEnginePlugin"
    public let jsName = "RideEngine"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSavedSensors", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "zeroOffset", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "skipStep", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRecoverable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resumeRecovered", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discardRecovered", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "testVoice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getVoices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVoice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCoach", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "talk", returnType: CAPPluginReturnPromise),
    ]

    private let engineQueue = DispatchQueue(label: "veloiq.engine")
    private lazy var sensors = SensorManager()
    // speaker i speakerLanguage są używane wyłącznie na głównym wątku
    private var speaker = Speaker()
    /// Dyrektor Enzo (klipy w paczce aplikacji). nil = paczki brak → głos systemowy.
    private lazy var director: DirectorVoice? = {
        let d = DirectorVoice(id: "enzo")
        d?.name = UserDefaults.standard.string(forKey: "veloiq.voice.name")
        return d
    }()
    /// Rozmowa z Enzo (dotknięcie słuchawki / przycisk na ekranie). Główny wątek.
    private lazy var coach: CoachTalk = makeCoach()
    private static let modeKey = "veloiq.voice.mode"
    private var voiceMode: String {
        get { UserDefaults.standard.string(forKey: Self.modeKey) ?? "enzo" }
        set { UserDefaults.standard.set(newValue, forKey: Self.modeKey) }
    }
    /// Główny wątek. Tryb Enzo: mówi WYŁĄCZNIE Enzo (bez nagrania = tylko tekst na ekranie), żeby dwa
    /// głosy nigdy nie nakładały się na siebie. Tryb systemowy: synteza iOS.
    private func say(_ key: String?, _ vars: [String: String], _ text: String, interrupt: Bool) {
        if voiceMode == "enzo", let d = director {
            guard let k = key, let seg = d.compose(k, vars), !seg.isEmpty else { return }
            d.play(seg, interrupt: interrupt)
            return
        }
        speaker.speak(text, interrupt: interrupt)
    }
    private var speakerLanguage = "pl-PL"
    private let location = LocationTracker()

    private var engine: WorkoutEngine?
    private var recorder: Recorder?
    private var simulator: SensorSimulator?
    private var ticker: DispatchSourceTimer?
    private var outdoor = false
    private var scriptJSON: Data?
    private var lastLat: Double?, lastLon: Double?
    /// Dystans i prędkość z GPS (do pytań „ile km?”) – liczone na engineQueue.
    private var distKm = 0.0, speedKmh = 0.0, prevFix: (lat: Double, lon: Double, s: Int)?
    /// "full" – wszystko | "struct" – bez korekt/pochwał | "off" – bez głosu (tekst nadal idzie do UI)
    private var voiceLevel = "full"
    // auto-pauza jazdy + powiadomienia na licznik (engineQueue)
    private var autoPauseOn = true, stillRun = 0, moveRun = 0, spokePause = false
    private var lastAutoPauseVoice = Date.distantPast
    private var lastSpeed: (kmh: Double, at: Date)?
    private let notifier = EnzoNotifier()
    /// Nawigacja po trasie GPX (engineQueue).
    private var navigator: RouteNavigator?, pendingNav: RouteNavigator?
    private var lastNavEmit = Date.distantPast
    // podgląd czujników poza treningiem
    private var previewPower: Int?, previewCadence: Int?, previewHr: Int?, previewBalance: Double?
    private var lastPreview = Date.distantPast

    private func emitPreview() {
        let now = Date()
        guard now.timeIntervalSince(lastPreview) >= 1 else { return }
        lastPreview = now
        var d: [String: Any] = [:]
        if let v = previewPower { d["power"] = v }
        if let v = previewCadence { d["cadence"] = v }
        if let v = previewHr { d["hr"] = v }
        if let v = previewBalance { d["balanceL"] = v }
        notifyListeners("sensorData", data: d)
    }
    private var announceArm = true

    public override func load() {
        sensors.onFound = { [weak self] id, name, kind, rssi in
            self?.notifyListeners("sensorFound", data: ["id": id, "name": name, "kind": kind, "rssi": rssi])
        }
        sensors.onStatus = { [weak self] kind, id, name, connected in
            guard let self = self else { return }
            var d: [String: Any] = ["kind": kind, "id": id, "connected": connected]
            if let n = name { d["name"] = n }
            self.notifyListeners("sensor", data: d)
            // druga strona mocy: zgubienie jednej korby nie jest "utratą mocy" (druga ×2 trzyma pomiar)
            if kind != "power2" { self.engineQueue.async { self.engine?.sensorChanged(kind: kind, connected: connected) } }
        }
        sensors.onHeartRate = { [weak self] hr in
            guard let self = self else { return }
            self.engineQueue.async {
                if let e = self.engine {
                    e.ingestHr(hr.bpm)
                    e.advance()
                } else {
                    // podgląd na ekranie czujników (bez treningu), max 1 Hz
                    self.previewHr = hr.bpm
                    self.emitPreview()
                }
            }
        }
        sensors.onPower = { [weak self] pw, cad in
            guard let self = self else { return }
            self.engineQueue.async {
                if let e = self.engine {
                    e.ingestPower(pw.watts, balanceL: pw.balanceL)
                    if let c = cad { e.ingestCadence(c) }
                    e.advance()
                } else {
                    self.previewPower = pw.watts
                    if let c = cad { self.previewCadence = c }
                    if let b = pw.balanceL { self.previewBalance = b }
                    self.emitPreview()
                }
            }
        }
        sensors.onLog = { msg in CAPLog.print("[RideEngine] \(msg)") }
        location.onLocation = { [weak self] loc in
            guard let self = self else { return }
            self.engineQueue.async {
                self.lastLat = loc.coordinate.latitude
                self.lastLon = loc.coordinate.longitude
                self.engine?.location = (loc.coordinate.latitude, loc.coordinate.longitude)
                if loc.speed >= 0 { self.lastSpeed = (loc.speed * 3.6, Date()) }
                if let nav = self.navigator, self.engine != nil {
                    nav.update(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude,
                               speedKmh: loc.speed >= 0 ? loc.speed * 3.6 : nil)
                    if Date().timeIntervalSince(self.lastNavEmit) >= 1 {
                        self.lastNavEmit = Date()
                        self.notifyListeners("nav", data: nav.state())
                    }
                }
                self.engine?.advance()
            }
        }
        sensors.connectSaved()
    }

    // MARK: - Czujniki

    @objc func scan(_ call: CAPPluginCall) {
        let kinds = call.getArray("kinds", String.self) ?? ["hr", "power"]
        sensors.scan(kinds: kinds)
        call.resolve()
    }

    @objc func stopScan(_ call: CAPPluginCall) { sensors.stopScan(); call.resolve() }

    @objc func connect(_ call: CAPPluginCall) {
        sensors.connect(hrId: call.getString("hrId"), powerId: call.getString("powerId"), power2Id: call.getString("power2Id"))
        call.resolve()
    }

    @objc func disconnect(_ call: CAPPluginCall) { sensors.disconnectAll(); call.resolve() }

    @objc func getSavedSensors(_ call: CAPPluginCall) {
        let s = sensors.savedSensors
        var d: [String: Any] = [:]
        if let h = s.hr { d["hrId"] = h }
        if let p = s.power { d["powerId"] = p }
        if let p2 = s.power2 { d["power2Id"] = p2 }
        call.resolve(d)
    }

    @objc func zeroOffset(_ call: CAPPluginCall) { sensors.zeroOffset(); call.resolve() }

    // MARK: - Trening

    @objc func startWorkout(_ call: CAPPluginCall) {
        guard let scriptObj = call.getObject("script") else { return call.reject("Brak script") }
        let outdoor = call.getBool("outdoor") ?? false
        let simulate = call.getBool("simulate") ?? false
        let level = call.getString("voiceLevel") ?? "full"
        let arm = call.getBool("announceArm") ?? true
        let autoPause = call.getBool("autoPause") ?? true
        let notify = call.getBool("notifications") ?? true
        // trasa GPX (tylko na zewnątrz) – ta sama droga przez JSON co skrypt
        var nav: RouteNavigator?
        if outdoor, let r = call.getObject("route"), let d = try? JSONSerialization.data(withJSONObject: r),
           let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { nav = RouteNavigator(json: j) }
        if let n = nav {
            n.onSay = { [weak self] key, vars in
                guard let self = self else { return }
                self.notifier.post(key, vars)
                guard self.voiceLevel != "off" else { return }
                let text = EnzoNotifier.text(key, vars) ?? ""
                DispatchQueue.main.async { self.say(key, vars, text, interrupt: key == "navTurn" && vars["dist"] == "0") }
            }
        }
        engineQueue.async { self.pendingNav = nav }   // begin() podłączy po stopInternal
        engineQueue.async { self.autoPauseOn = autoPause; self.stillRun = 0; self.moveRun = 0; self.lastSpeed = nil }
        notifier.enabled = notify
        if notify { notifier.requestPermission() }
        engineQueue.async { self.voiceLevel = level; self.announceArm = arm }
        do {
            let json = try JSONSerialization.data(withJSONObject: scriptObj)
            let script = try JSONDecoder().decode(WorkoutScript.self, from: json)
            // pusta lista kroków = jazda swobodna (samo nagrywanie + wykrywanie wysiłków)
            engineQueue.async {
                do {
                    try self.begin(script: script, json: json, outdoor: outdoor, simulate: simulate,
                                   startDate: Date(), pausedTotal: 0, pausedAt: nil, resumeFileName: nil)
                    call.resolve()
                } catch {
                    call.reject("Nie udało się rozpocząć: \(error.localizedDescription)")
                }
            }
        } catch {
            call.reject("Nieprawidłowy skrypt: \(error.localizedDescription)")
        }
    }

    private func begin(script: WorkoutScript, json: Data, outdoor: Bool, simulate: Bool,
                       startDate: Date, pausedTotal: TimeInterval, pausedAt: Date?, resumeFileName: String?) throws {
        stopInternal(speakSummary: false)
        navigator = pendingNav; pendingNav = nil; lastNavEmit = .distantPast
        let rec = try Recorder(workoutId: script.id, resumeFileName: resumeFileName)
        let eng = WorkoutEngine(script: script, startDate: startDate, pausedTotal: pausedTotal, pausedAt: pausedAt)
        if let f = resumeFileName { eng.seed(Recorder.readSamples(fileName: f)) }
        lastLat = nil; lastLon = nil
        distKm = 0; speedKmh = 0; prevFix = nil
        let lang = script.lang ?? "pl-PL"
        DispatchQueue.main.async {
            if self.speakerLanguage != lang { self.speaker = Speaker(language: lang); self.speakerLanguage = lang }
        }

        eng.onCue = { [weak self] text, kind in
            self?.notifyListeners("cue", data: ["text": text, "kind": kind.rawValue])
        }
        eng.onSpeak = { [weak self] key, vars, text, kind in
            guard let self = self else { return }
            self.notifier.post(key, vars)              // krótko na licznik (Garmin), niezależnie od głosu
            guard self.shouldSpeak(kind) else { return }
            DispatchQueue.main.async { self.say(key, vars, text, interrupt: kind == .countdown) }
        }
        eng.onLive = { [weak self] live in self?.notifyListeners("live", data: live.toDict()) }
        // seed() ustawił lastSecond, więc sekundy już zapisane w pliku nie zostaną dopisane ponownie
        eng.onSecond = { [weak self] s, p, hr, cad, bal in
            guard let self = self else { return }
            if self.outdoor, let la = self.lastLat, let lo = self.lastLon {
                if let f = self.prevFix, s > f.s {
                    let r = 6371.0, k = Double.pi / 180
                    let dLa = (la - f.lat) * k, dLo = (lo - f.lon) * k
                    let a = sin(dLa / 2) * sin(dLa / 2) + cos(f.lat * k) * cos(la * k) * sin(dLo / 2) * sin(dLo / 2)
                    let d = 2 * r * asin(min(1, sqrt(a)))
                    let v = d / (Double(s - f.s) / 3600)
                    if v < 120 { self.distKm += d; self.speedKmh = self.speedKmh * 0.8 + v * 0.2 }
                }
                self.prevFix = (la, lo, s)
            }
            self.recorder?.append(second: s, power: p, hr: hr, cadence: cad, balance: bal,
                                  lat: self.outdoor ? self.lastLat : nil, lon: self.outdoor ? self.lastLon : nil)
        }
        // koniec planu ≠ koniec nagrywania: aktywność trwa (jazda swobodna) aż do stopWorkout
        eng.onPlanFinished = { [weak self] summary in
            self?.notifyListeners("planFinished", data: summary.toDict())
        }

        engine = eng
        recorder = rec
        scriptJSON = json
        self.outdoor = outdoor
        Recorder.saveRecovery(.init(scriptJSON: json, startDate: startDate, pausedTotal: pausedTotal,
                                    pausedAt: pausedAt, fileName: rec.fileName, outdoor: outdoor))

        if outdoor { DispatchQueue.main.async { self.location.start() } }

        if simulate {
            let sim = SensorSimulator { [weak self] in self?.engine?.simState() }
            sim.onPower = { [weak self] p, c in
                self?.engine?.ingestPower(p, balanceL: 50)
                self?.engine?.ingestCadence(c)
            }
            sim.onHr = { [weak self] h in self?.engine?.ingestHr(h) }
            sim.start(queue: engineQueue)
            simulator = sim
        }

        let tm = DispatchSource.makeTimerSource(queue: engineQueue)
        tm.schedule(deadline: .now() + 0.5, repeating: 1.0, leeway: .milliseconds(100))
        tm.setEventHandler { [weak self] in self?.engine?.advance(); self?.autoPauseTick() }
        tm.resume()
        ticker = tm
    }

    @objc func pause(_ call: CAPPluginCall) {
        engineQueue.async {
            self.engine?.pause()
            self.saveRecoveryState()
            call.resolve()
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        engineQueue.async {
            self.engine?.resume()
            self.saveRecoveryState()
            call.resolve()
        }
    }

    /// Przycisk "Następny krok" – np. gdy zawodnik chce pominąć przerwę albo interwał.
    @objc func skipStep(_ call: CAPPluginCall) {
        engineQueue.async {
            guard let eng = self.engine else { return call.resolve() }
            eng.advance()
            self.recorder?.appendEvent(second: eng.lastSecond, "skip")
            eng.skipStep()
            call.resolve()
        }
    }

    @objc func stopWorkout(_ call: CAPPluginCall) {
        engineQueue.async {
            guard self.engine != nil else { return call.reject("Brak aktywnego treningu") }
            let summary = self.finishWorkout()
            self.notifyListeners("finished", data: summary.toDict())
            call.resolve(summary.toDict())
        }
    }

    /// Zamyka trening (na engineQueue): zatrzymuje timery, zapisuje plik, czyści stan odzyskiwania.
    private func finishWorkout() -> WorkoutSummary {
        guard let eng = engine else { return WorkoutSummary(file: "", durationSec: 0, avgPower: 0, normalizedPower: 0, kJ: 0, compliancePct: 0) }
        var summary = eng.stop()
        summary.file = recorder?.fileName ?? "" // tylko nazwa pliku – ścieżka kontenera się zmienia
        stopInternal(speakSummary: false)
        return summary
    }

    private func stopInternal(speakSummary: Bool) {
        navigator = nil
        DispatchQueue.main.async { self.coach.setTapMode(false) }
        ticker?.cancel(); ticker = nil
        simulator?.stop(); simulator = nil
        recorder?.close(); recorder = nil
        engine = nil
        if outdoor { DispatchQueue.main.async { self.location.stop() } }
        Recorder.clearRecovery()
    }

    private func saveRecoveryState() {
        guard let eng = engine, let json = scriptJSON, let rec = recorder else { return }
        Recorder.saveRecovery(.init(scriptJSON: json, startDate: eng.startDate, pausedTotal: eng.pausedSeconds,
                                    pausedAt: eng.pausedAtDate, fileName: rec.fileName, outdoor: outdoor))
    }

    /// Filtr głosu wg ustawień użytkownika (wywoływany na engineQueue).
    private func shouldSpeak(_ kind: WorkoutEngine.CueKind) -> Bool {
        if !announceArm && kind == .arm { return false }
        switch voiceLevel {
        case "off": return false
        case "struct":
            let quiet: [WorkoutEngine.CueKind] = [.correction, .cadence, .praise]
            return !quiet.contains(kind)
        default: return true
        }
    }

    // MARK: - Odzyskiwanie po awarii

    @objc func getRecoverable(_ call: CAPPluginCall) {
        engineQueue.async {
            guard self.engine == nil, let r = Recorder.loadRecovery(),
                  let script = try? JSONDecoder().decode(WorkoutScript.self, from: r.scriptJSON) else {
                return call.resolve(["available": false])
            }
            // wykonany czas = sekundy zapisane w pliku (czas od awarii/pauzy się nie liczy)
            let elapsed = Recorder.readSamples(fileName: r.fileName).count
            // po planie nagrywanie trwa dalej (jazda swobodna), więc limitem jest tylko czas od startu
            if elapsed == 0 || Date().timeIntervalSince(r.startDate) > 12 * 3600 {
                return call.resolve(["available": false])
            }
            call.resolve(["available": true, "name": script.name, "elapsed": elapsed])
        }
    }

    @objc func resumeRecovered(_ call: CAPPluginCall) {
        guard let r = Recorder.loadRecovery(),
              let script = try? JSONDecoder().decode(WorkoutScript.self, from: r.scriptJSON) else {
            return call.reject("Brak treningu do wznowienia")
        }
        engineQueue.async {
            guard self.engine == nil else { return call.reject("Trening w toku") }
            do {
                // Wznawiamy w pauzie od ostatniej zapisanej sekundy: czas od awarii się nie liczy,
                // zawodnik sam wciska "Wznów".
                let recorded = Recorder.readSamples(fileName: r.fileName).count
                let now = Date()
                let pausedTotal = max(r.pausedTotal, now.timeIntervalSince(r.startDate) - Double(recorded))
                try self.begin(script: script, json: r.scriptJSON, outdoor: r.outdoor, simulate: false,
                               startDate: r.startDate, pausedTotal: pausedTotal, pausedAt: now,
                               resumeFileName: r.fileName)
                // UI musi pokazać przycisk "Wznów" – silnik czeka w pauzie
                self.notifyListeners("paused", data: ["elapsed": recorded, "recovered": true])
                call.resolve(["paused": true, "elapsed": recorded])
            } catch {
                call.reject("Nie udało się wznowić: \(error.localizedDescription)")
            }
        }
    }

    @objc func discardRecovered(_ call: CAPPluginCall) { Recorder.clearRecovery(); call.resolve() }

    // MARK: - Inne

    /// Głosy pl-PL zainstalowane w iOS + aktualny wybór (lepsze głosy: Ustawienia → Dostępność → Treść mówiona → Głosy).
    @objc func getVoices(_ call: CAPPluginCall) {
        let lang = call.getString("language") ?? speakerLanguage
        DispatchQueue.main.async {
            var d: [String: Any] = ["voices": Speaker.voices(language: lang), "rate": self.speaker.rate, "mode": self.voiceMode]
            if let p = self.director?.pack { d["packs"] = [["id": p.id, "name": p.name]] } else { d["packs"] = [] }
            if let id = self.speaker.currentVoiceId { d["current"] = id }
            call.resolve(d)
        }
    }

    @objc func setVoice(_ call: CAPPluginCall) {
        let id = call.getString("id")
        let rate = call.getDouble("rate").map { Float($0) }
        let mode = call.getString("mode")
        let name = call.getString("name")
        DispatchQueue.main.async {
            if let m = mode { self.voiceMode = m }
            if let n = name { UserDefaults.standard.set(n, forKey: "veloiq.voice.name"); self.director?.name = n }
            self.speaker.configure(voiceId: id, rate: rate)
            call.resolve()
        }
    }

    @objc func testVoice(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? "Interwał 1 z 4. 8 minut, cel 305 do 320 watów. Start!"
        DispatchQueue.main.async {
            if self.voiceMode == "enzo", let d = self.director {
                d.play(["lead.arm.0", "int.2.4", "min.8", "from.305", "to.320"], interrupt: true)
            } else { self.speaker.speak(text) }
        }
        call.resolve()
    }

    // MARK: - Auto-pauza jazdy (engineQueue)

    private func autoPauseTick() {
        guard autoPauseOn, let eng = engine, !eng.stopped, eng.lastSecond > 10 else { return }
        if eng.isPaused && !eng.autoPaused { stillRun = 0; moveRun = 0; return }   // ręczna pauza – nie ruszamy
        let m = eng.motion
        let spd: Double? = outdoor ? lastSpeed.flatMap { Date().timeIntervalSince($0.at) <= 5 ? $0.kmh : nil } : nil
        let pedaling = (m.power ?? 0) > 0 || (m.cadence ?? 0) > 0
        let moving = pedaling || (spd ?? 0) >= 3
        // stoimy: zero mocy i kadencji, a na zewnątrz dodatkowo GPS < 3 km/h (zjazd bez pedałowania to nie postój)
        let still = !pedaling && (outdoor ? (spd.map { $0 < 3 } ?? false) : m.hasPower)
        if eng.autoPaused {
            moveRun = moving ? moveRun + 1 : 0
            if moveRun >= 2 {
                eng.autoResume(speak: spokePause)
                moveRun = 0; spokePause = false
                saveRecoveryState()
                notifyListeners("resumed", data: ["elapsed": eng.lastSecond, "auto": true])
            }
        } else {
            stillRun = still ? stillRun + 1 : 0
            if stillRun >= 3 {
                // głos najwyżej co 5 min – na światłach w mieście bez gadania
                let speak = Date().timeIntervalSince(lastAutoPauseVoice) > 300
                if speak { lastAutoPauseVoice = Date() }
                spokePause = speak
                eng.autoPause(speak: speak)
                stillRun = 0
                saveRecoveryState()
                notifyListeners("paused", data: ["elapsed": eng.lastSecond, "auto": true])
            }
        }
    }

    // MARK: - Rozmowa z Enzo

    /// JS po starcie treningu: token do /api/ride/ask, adres serwera, czy dotknięcie słuchawki = pytanie.
    @objc func setCoach(_ call: CAPPluginCall) {
        let token = call.getString("token"), base = call.getString("baseUrl").flatMap { URL(string: $0) }
        let tap = call.getBool("tapMode") ?? true
        DispatchQueue.main.async {
            CoachTalk.requestPermissions()
            self.coach.token = token
            self.coach.baseURL = base
            self.coach.setTapMode(false)   // tryb dotyku wyłączony – blokował Spotify
            _ = tap
            call.resolve()
        }
    }

    /// Przycisk „Zapytaj Enzo” na ekranie.
    @objc func talk(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.coach.start(); call.resolve() }
    }

    private func makeCoach() -> CoachTalk {
        let c = CoachTalk()
        c.onEvent = { [weak self] kind, data in
            var d = data; d["state"] = kind
            self?.notifyListeners("coach", data: d)
        }
        c.playLead = { [weak self] ev, done in
            guard let self = self else { return }
            if self.voiceMode == "enzo", let d = self.director, let seg = d.compose(ev, [:]), !seg.isEmpty {
                // poczekaj na zaległe komunikaty Enzo, potem klip
                let wait = d.pendingDuration
                d.play(seg)
                if let done = done { DispatchQueue.main.asyncAfter(deadline: .now() + wait + d.duration(seg) + 0.15, execute: done) }
            } else {
                let t = ["listen": "Słucham.", "repeat": "Nie zrozumiałem, powtórz.", "think": "Chwileczkę.",
                         "offline": "Nie mam zasięgu.", "doneCmd": "Zrobione."][ev] ?? ""
                if !t.isEmpty { self.speaker.speak(t) }
                if let done = done { DispatchQueue.main.asyncAfter(deadline: .now() + 1.0, execute: done) }
            }
        }
        c.speakAnswer = { [weak self] text in self?.speaker.speak(text) }
        c.stateProvider = { [weak self] in
            guard let self = self else { return [:] }
            return self.engineQueue.sync { self.stateForCoach() }
        }
        c.runAction = { [weak self] a in self?.coachAction(a) }
        c.localAnswer = { [weak self] q in self?.localAnswer(q) ?? false }
        return c
    }

    /// Polecenia sterujące jazdą (z mowy albo z odpowiedzi trenera AI).
    private func coachAction(_ a: String) {
        engineQueue.async {
            guard let eng = self.engine else { return }
            switch a {
            case "next":
                eng.advance(); self.recorder?.appendEvent(second: eng.lastSecond, "skip"); eng.skipStep()
            case "pause":
                eng.pause(); self.saveRecoveryState()
                self.notifyListeners("paused", data: ["elapsed": eng.lastSecond])
            case "resume":
                eng.resume(); self.saveRecoveryState()
                self.notifyListeners("resumed", data: ["elapsed": eng.lastSecond])
            default: break
            }
        }
    }

    /// Stan jazdy + dystans (na engineQueue).
    private func stateForCoach() -> [String: Any] {
        var d = engine?.coachState() ?? [:]
        if outdoor { d["distanceKm"] = (distKm * 10).rounded() / 10; d["speedKmh"] = Int(speedKmh.rounded()) }
        if let n = navigator { d["route"] = n.state() }
        return d
    }

    /// Proste pytania i polecenia bez internetu, głosem Enzo. Główny wątek.
    private func localAnswer(_ q: String) -> Bool {
        let t = q.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pl_PL"))
            .replacingOccurrences(of: "ł", with: "l")
        func has(_ ws: String...) -> Bool { ws.contains { t.contains($0) } }
        let st: [String: Any] = engineQueue.sync { self.stateForCoach() }
        let step = st["step"] as? [String: Any]
        let enzo = voiceMode == "enzo" ? director : nil
        func play(_ ids: [String], _ text: String) {
            notifyListeners("coach", data: ["state": "answer", "text": text])
            if let d = enzo, !ids.isEmpty { d.play(ids) } else { speaker.speak(text) }
        }
        func lead(_ ev: String) -> [String] { enzo?.compose(ev, [:]) ?? [] }
        /// klipy samego czasu („piętnaście minut. trzydzieści sekund.”) – sekundy tylko poniżej 3 min
        func durIds(_ sec: Int) -> [String] {
            guard let d = enzo else { return [] }
            let m = sec / 60, s = sec % 60
            var v = m > 0 ? "\(m) minut" : ""
            if m < 3 && s > 0 { v += " \(s) sekund" }
            return Array((d.compose("warmupStart", ["dur": v]) ?? []).dropFirst())
        }
        let typeName = ["warmup": "Rozgrzewka", "interval": "Interwał", "recovery": "Przerwa", "steady": "Równe tempo", "cooldown": "Schłodzenie"]

        // --- jedzenie i picie
        if has("zjadlem", "zjadlam", "zjadl ", "zjedzone", "mam zel", "zjadlem zel") {
            engineQueue.async { self.engine?.fueled("eat") }
            play(lead("ateOk"), "Zapisane – zjedzone."); return true
        }
        if has("wypilem", "wypilam", "pilem", "pije ") {
            engineQueue.async { self.engine?.fueled("drink") }
            play(lead("drankOk"), "Zapisane – wypite."); return true
        }
        if has("co jesc", "kiedy jesc", "ile jesc", "co zjesc", "jedzen", "co pic", "ile pic", "picie", "wegl", "zel ", "glodn") {
            let since = (st["sinceEatSec"] as? Int) ?? 0
            let now = since >= 1500
            var ids = has("kiedy", "teraz", "czy mam") ? [] : lead("fuelAdvice")
            ids += lead(now ? "eatNow" : "eatLater")
            play(ids, now ? "Teraz dobry moment – zjedz coś i popij." : "Jadłeś niedawno – teraz tylko pij.")
            return true
        }
        // --- motywacja
        if has("zmotywuj", "motywuj", "motywac", "nie mam sily", "ciezko mi", "nie dam rady", "dodaj mi", "pomoz mi") {
            play(lead("motivate"), "Dasz radę! Forca!"); return true
        }
        // --- co dalej (informacja) – przed poleceniem „następny krok”
        if has("co dalej", "co teraz", "co mnie czeka", "jaki nastepny", "jaki jest nastepny", "co bedzie", "co po tym", "co potem") {
            guard let n = st["nextStep"] as? [String: Any], let ty = n["type"] as? String else {
                play(lead("planEnd"), "Potem koniec planu."); return true
            }
            var ids = lead("nextInfo")
            if let d = enzo {
                if d.hasClip("st.\(ty)") { ids.append("st.\(ty)") }
                if ty == "interval", let no = n["intervalNo"] as? Int, let tot = n["intervalCount"] as? Int,
                   let c = d.compose("armNext", ["n": "\(no)", "total": "\(tot)"]), c.count > 1 {
                    ids += c.dropFirst().filter { $0.hasPrefix("int.") }
                }
                ids += durIds((n["durationSec"] as? Int) ?? 0)
                if ty == "interval" || ty == "steady",
                   let c = d.compose("steadyStart", ["dur": "", "low": "\(n["targetLow"] ?? 0)", "high": "\(n["targetHigh"] ?? 0)"]) {
                    ids += c.dropFirst().filter { $0.hasPrefix("from.") || $0.hasPrefix("to.") || $0.hasPrefix("w.") }
                }
            }
            let dur = Phrases.duration((n["durationSec"] as? Int) ?? 0)
            play(ids, "Następnie: \(typeName[ty] ?? ty), \(dur), \(n["targetLow"] ?? 0)–\(n["targetHigh"] ?? 0) W.")
            return true
        }
        // --- polecenia
        if has("nastepny krok", "pomin", "przejdz dalej", "kolejny krok", "nastepny etap") {
            coachAction("next"); play(lead("doneCmd"), "Następny krok."); return true
        }
        if has("pauza", "zatrzymaj") && !has("ile") {
            coachAction("pause"); return true            // silnik sam mówi „Pauza”
        }
        if has("wznow", "jedziemy dalej", "ruszam") {
            coachAction("resume"); return true
        }
        // --- interwały
        if has("ile interwal", "ile serii", "ile powtorz", "ile jeszcze interwal", "ktory interwal", "ile zostalo interwal") {
            let left = (st["intervalsLeft"] as? Int) ?? 0
            let inIv = (st["inInterval"] as? Bool) ?? false
            if left == 0 {
                play(lead(inIv ? "lastIvl" : "ivlDone"), inIv ? "To ostatni interwał!" : "Interwały zrobione.")
            } else {
                play(lead("ivlLeft") + ((enzo?.hasClip("n.\(left)") ?? false) ? ["n.\(left)"] : []),
                     "Zostało interwałów: \(left).")
            }
            return true
        }
        if has("poprzedni", "ostatnia seria", "ostatni interwal", "jak poszl", "jak mi poszl", "poprzednia seria") {
            guard let last = (st["series"] as? [[String: Any]])?.last else { play(lead("noSeries"), "Jeszcze nie było serii."); return true }
            let avg = (last["avgPower"] as? Int) ?? 0, pct = (last["compliancePct"] as? Int) ?? 0
            var ids = lead("prevSeries")
            if let d = enzo, let c = d.compose("seriesEnd", ["avg": "\(avg)", "pct": "\(pct)"]) { ids += c.dropFirst() }
            play(ids, "Poprzednia seria: średnio \(avg) watów, \(pct)% w zakresie.")
            return true
        }
        // --- trasa GPX
        if let r = st["route"] as? [String: Any] {
            if has("do mety", "do konca trasy", "ile kilometr", "ile km", "ile jeszcze trasy") {
                let left = (r["left"] as? Int) ?? 0
                let km = max(1, Int((Double(left) / 1000).rounded()))
                let marks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] + Array(stride(from: 15, through: 100, by: 5)) + Array(stride(from: 110, through: 200, by: 10))
                let near = marks.min { abs($0 - km) < abs($1 - km) } ?? km
                play(enzo?.compose("navLeft", ["km": "\(near)"]) ?? [], "Do mety \(String(format: "%.1f", Double(left) / 1000)) km.")
                return true
            }
            if has("podjazd", "gora", "wspinaczk") {
                guard let c = r["nextClimb"] as? [String: Any] else { play([], "Na trasie nie ma już podjazdów."); return true }
                let len = Double((c["len"] as? Int) ?? 0) / 1000, grade = (c["grade"] as? Double) ?? 0
                let onIt = (c["onIt"] as? Bool) ?? false
                let v = ["len": String(format: "%.1f", len), "grade": "\(Int(grade.rounded()))"]
                var ids: [String] = []
                if !onIt, let inM = c["in"] as? Int, let d = enzo {
                    // „Za kilometr / pięćset / trzysta metrów” + podjazd
                    let dist = inM >= 750 ? "1000" : inM >= 400 ? "500" : inM >= 250 ? "300" : inM >= 150 ? "200" : "100"
                    if inM < 1500, d.hasClip("dist.\(dist)") { ids.append("dist.\(dist)") }
                }
                ids += enzo?.compose(onIt ? "navClimbStart" : "navClimb", v) ?? []
                play(ids, onIt ? "Jesteś na podjeździe: \(v["len"]!) km, \(v["grade"]!)%." : "Podjazd za \(((c["in"] as? Int) ?? 0) / 100 * 100) m: \(v["len"]!) km, \(v["grade"]!)%.")
                return true
            }
            if has("gdzie skrec", "jaki skret", "nastepny skret", "kiedy skret") {
                guard let t = r["nextTurn"] as? [String: Any], let dir = t["dir"] as? String, let inM = t["in"] as? Int else {
                    play([], "Na razie prosto."); return true
                }
                let dist = inM <= 60 ? "0" : inM <= 150 ? "100" : inM <= 250 ? "200" : inM <= 400 ? "300" : inM <= 750 ? "500" : "1000"
                play(enzo?.compose("navTurn", ["dist": dist, "dir": dir]) ?? [], "Za \(inM) m: \(dir).")
                return true
            }
        }
        // --- czas
        if (has("ile") && has("trening", "planu", "calego", "calosc", "jazdy")) || has("do konca treningu", "do konca planu") {
            let sec = (st["planRemainingSec"] as? Int) ?? 0
            play(lead("planLeft") + durIds(sec), "Do końca treningu: \(Phrases.duration(sec)).")
            return true
        }
        if has("ile zostal", "ile jeszcze", "do konca", "ile minut") {
            let sec = (step?["remainingSec"] as? Int) ?? (st["planRemainingSec"] as? Int) ?? 0
            play(lead("left") + durIds(sec), "Zostało \(Phrases.duration(sec)).")
            return true
        }
        // --- odczyty
        if has("kadencj", "obroty", "obrotow") {
            guard let c = st["cadence"] as? Int else { play([], "Nie widzę kadencji."); return true }
            let r = min(120, max(50, Int((Double(c) / 5).rounded()) * 5))
            play((enzo?.hasClip("cad.\(r)") ?? false) ? ["cad.\(r)"] : [], "Kadencja \(c).")
            return true
        }
        if has("tetno", "puls") {
            guard let hr = st["hr"] as? Int else { play(lead("hrLost"), "Nie widzę tętna."); return true }
            var ids: [String] = []
            var state = ""
            if let lo = step?["hrLow"] as? Int, hr < lo - 3 { state = "low" }
            else if let hi = step?["hrHigh"] as? Int, hr > hi + 3 { state = "high" }
            else if step?["hrHigh"] != nil { state = "ok" }
            if let d = enzo, let c = d.compose("status", ["avg": "0", "hr": "\(hr)", "hrState": state]) {
                ids = c.filter { $0.hasPrefix("hrv.") || $0.hasPrefix("hrs.") }
            }
            play(ids, "Tętno \(hr)\(["ok": ", w normie", "high": ", powyżej strefy", "low": ", poniżej strefy"][state] ?? "").")
            return true
        }
        if has("sredni", "jak idzie", "jak mi idzie", "raport") {
            let avg = (step?["avgPower"] as? Int) ?? (st["avgPowerRide"] as? Int) ?? 0
            var v: [String: String] = ["avg": "\(avg)", "hr": "", "hrState": ""]
            if let hr = st["hr"] as? Int { v["hr"] = "\(hr)" }
            play(enzo?.compose("status", v) ?? [], "Średnio \(avg) watów.")
            return true
        }
        if has("jaka moc", "ile watow", "moc teraz", "jaka mam moc") {
            let p = (st["power30s"] as? Int) ?? 0
            var ids = lead("power")
            if let d = enzo, let c = d.compose("half", ["avg": "\(p)"]), c.count > 1 { ids += Array(c.dropFirst()) }
            play(ids, "Moc \(p) watów.")
            return true
        }
        return false   // reszta (km, prędkość, kalorie, technika, zdrowie…) → trener AI
    }

    @objc func readRecording(_ call: CAPPluginCall) {
        guard let f = call.getString("file") else { return call.reject("Brak file") }
        do {
            let url = try Recorder.ridesDir().appendingPathComponent(URL(fileURLWithPath: f).lastPathComponent)
            let s = try String(contentsOf: url, encoding: .utf8)
            call.resolve(["data": s])
        } catch {
            call.reject("Nie można odczytać pliku: \(error.localizedDescription)")
        }
    }
}
