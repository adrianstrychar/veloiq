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
        CAPPluginMethod(name: "cancelStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "debrief", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNavEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRecoverable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resumeRecovered", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discardRecovered", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "testVoice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getVoices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVoice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCoach", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "talk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "flicStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "flicScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "flicStopScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "flicForget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "garminStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "garminChoose", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "garminForget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "garminOpenApp", returnType: CAPPluginReturnPromise),
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
    // licznik Garmin Edge (most Connect IQ) – engineQueue
    /// Połączone czujniki Bluetooth telefonu ("power", "power2", "hr") – licznik zastępuje tylko brakujące.
    private var bleUp = Set<String>()
    /// Stan jazdy przysłany przez licznik razem z przyciskiem ENZO (gdy trening prowadzi licznik).
    private var garminState: [String: Any] = [:]
    private var garminStateAt = Date.distantPast

    public override func load() {
        setupGarmin()
        // przycisk Flic na kierownicy – konfiguracja jak najwcześniej (iOS wznawia połączenie w tle)
        let flic = FlicRemote.shared
        flic.onStatus = { [weak self] d in self?.notifyListeners("flic", data: d) }
        flic.onPress = { [weak self] kind in self?.handleFlic(kind) }
        flic.configure()
        sensors.onFound = { [weak self] id, name, kind, rssi in
            self?.notifyListeners("sensorFound", data: ["id": id, "name": name, "kind": kind, "rssi": rssi])
        }
        sensors.onStatus = { [weak self] kind, id, name, connected in
            guard let self = self else { return }
            var d: [String: Any] = ["kind": kind, "id": id, "connected": connected]
            if let n = name { d["name"] = n }
            self.notifyListeners("sensor", data: d)
            self.engineQueue.async { if connected { self.bleUp.insert(kind) } else { self.bleUp.remove(kind) } }
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
        Self.clearSavedRoute()
        if outdoor, let r = call.getObject("route"), let d = try? JSONSerialization.data(withJSONObject: r) {
            nav = makeNavigator(d)
            if nav != nil { try? d.write(to: Self.routeFile) }   // na wypadek awarii – wznowienie z trasą
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
            // falstart ucina zaległe „Start!” – inaczej Enzo mówiłby o interwale, którego już nie ma
            DispatchQueue.main.async { self.say(key, vars, text, interrupt: kind == .countdown || key == "falseStart") }
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

    /// Przycisk „Falstart” – odwołuje świeżo wykryty start interwału (wraca czekanie na start).
    @objc func cancelStart(_ call: CAPPluginCall) {
        engineQueue.async {
            guard let eng = self.engine else { return call.resolve() }
            self.cancelStartInternal(eng)
            call.resolve()
        }
    }
    /// engineQueue
    private func cancelStartInternal(_ eng: WorkoutEngine) {
        eng.advance()
        guard eng.falseStartLeft > 0 else { return }
        recorder?.appendEvent(second: eng.lastSecond, "cancel")
        eng.cancelStart()
    }

    /// Wyłączenie / włączenie nawigacji GPX w trakcie jazdy (przycisk na karcie nawigacji).
    @objc func setNavEnabled(_ call: CAPPluginCall) {
        let on = call.getBool("enabled") ?? true
        engineQueue.async { self.setNav(on); call.resolve() }
    }
    /// engineQueue
    private func setNav(_ on: Bool) {
        guard let nav = navigator else { return }
        nav.setEnabled(on)
        let key = on ? "navEnabled" : "navDisabled"
        notifier.post(key, [:])
        if voiceLevel != "off" {
            let text = EnzoNotifier.text(key, [:]) ?? ""
            DispatchQueue.main.async { self.say(key, [:], text, interrupt: false) }
        }
        notifyListeners("nav", data: nav.state())
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
        Self.clearSavedRoute()
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
                if r.outdoor, let d = try? Data(contentsOf: Self.routeFile) { self.pendingNav = self.makeNavigator(d) }
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

    @objc func discardRecovered(_ call: CAPPluginCall) { Recorder.clearRecovery(); Self.clearSavedRoute(); call.resolve() }

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

    /// Podsumowanie Enzo po jeździe (ekran podsumowania): seria po serii + rada.
    @objc func debrief(_ call: CAPPluginCall) {
        let items = (call.getArray("series") as? [[String: Any]]) ?? []
        let series = items.map { (n: ($0["n"] as? NSNumber)?.intValue ?? 0, total: ($0["total"] as? NSNumber)?.intValue ?? 0,
                                  avg: ($0["avg"] as? NSNumber)?.intValue ?? 0, vrd: ($0["vrd"] as? String) ?? "ok") }
        let tip = call.getString("tip") ?? "ok"
        let text = call.getString("text") ?? ""
        DispatchQueue.main.async {
            guard self.voiceLevel != "off" else { return call.resolve() }
            if self.voiceMode == "enzo", let d = self.director {
                let ids = d.debriefIds(series, tip: tip)
                if !ids.isEmpty { d.play(ids, interrupt: true) }
            } else if !text.isEmpty {
                self.speaker.speak(text, interrupt: true)
            }
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

    // MARK: - Nawigacja GPX

    private static var routeFile: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("veloiq-route.json")
    }
    private static func clearSavedRoute() { try? FileManager.default.removeItem(at: routeFile) }

    private func makeNavigator(_ data: Data) -> RouteNavigator? {
        guard let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let n = RouteNavigator(json: j) else { return nil }
        n.onSay = { [weak self] key, vars in
            guard let self = self else { return }
            self.notifier.post(key, vars)
            guard self.voiceLevel != "off" else { return }
            let text = EnzoNotifier.text(key, vars) ?? ""
            DispatchQueue.main.async { self.say(key, vars, text, interrupt: key == "navTurn" && vars["dist"] == "0") }
        }
        return n
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
    // MARK: - Przycisk Flic

    @objc func flicStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(FlicRemote.shared.status()) }
    }
    @objc func flicScan(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            FlicRemote.shared.scan { ok, err in
                var d = FlicRemote.shared.status(); d["ok"] = ok
                if let e = err { d["error"] = e }
                call.resolve(d)
            }
        }
    }
    @objc func flicStopScan(_ call: CAPPluginCall) {
        DispatchQueue.main.async { FlicRemote.shared.stopScan(); call.resolve() }
    }
    @objc func flicForget(_ call: CAPPluginCall) {
        DispatchQueue.main.async { FlicRemote.shared.forget { call.resolve(FlicRemote.shared.status()) } }
    }

    // MARK: - Licznik Garmin Edge (most Connect IQ)
    //
    // Czujniki są sparowane tylko z licznikiem (ANT+), a telefon dostaje z niego dane i zdarzenia.
    //  • Trening uruchomiony na liczniku (w telefonie nie ma aktywnego treningu): licznik prowadzi, telefon
    //    mówi głosem Enzo i obsługuje rozmowę przez mikrofon słuchawek (przycisk ENZO na liczniku).
    //  • Trening uruchomiony w telefonie: licznik jest źródłem mocy / tętna / kadencji tam, gdzie telefon
    //    nie ma własnego czujnika Bluetooth; komunikaty licznika są pomijane (jeden głos naraz).

    private func setupGarmin() {
        let g = GarminLink.shared
        g.onStatus = { [weak self] d in self?.notifyListeners("garmin", data: d) }
        g.onLive = { [weak self] live in self?.garminLive(live) }
        g.onCue = { [weak self] key, kind, text, vars in self?.garminCue(key, kind, text, vars) }
        g.onTalk = { [weak self] msg in self?.garminTalk(msg) }
        g.onState = { [weak self] st, info in self?.garminRideState(st, info) }
        g.configure()
    }

    @objc func garminStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async { GarminLink.shared.hello(); call.resolve(GarminLink.shared.status()) }
    }
    /// Otwiera Garmin Connect z listą urządzeń (wybór licznika); wynik wraca do aplikacji linkiem veloiq://.
    @objc func garminChoose(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            CoachTalk.requestPermissions()   // mikrofon i mowa – pytanie teraz, przy ekranie, a nie w czasie jazdy
            GarminLink.shared.chooseDevice()
            call.resolve()
        }
    }
    @objc func garminForget(_ call: CAPPluginCall) {
        DispatchQueue.main.async { GarminLink.shared.forget(); call.resolve(GarminLink.shared.status()) }
    }
    @objc func garminOpenApp(_ call: CAPPluginCall) {
        DispatchQueue.main.async { GarminLink.shared.openApp(); call.resolve() }
    }

    /// Sekunda z licznika (główny wątek).
    private func garminLive(_ l: GarminLive) {
        engineQueue.async {
            if let e = self.engine {
                var fed = false
                if !self.bleUp.contains("power") && !self.bleUp.contains("power2") {
                    if let p = l.power { e.ingestPower(p, balanceL: nil); fed = true }
                    if let c = l.cadence { e.ingestCadence(c) }
                }
                if !self.bleUp.contains("hr"), let h = l.hr { e.ingestHr(h); fed = true }
                if fed { e.advance() }
            } else {
                // podgląd na ekranie Czujniki
                if let p = l.power { self.previewPower = p }
                if let c = l.cadence { self.previewCadence = c }
                if let h = l.hr { self.previewHr = h }
                self.emitPreview()
            }
        }
    }

    /// Komunikat silnika licznika → głos Enzo (te same klucze i zmienne co w silniku telefonu). Główny wątek.
    private func garminCue(_ key: String, _ kind: String, _ text: String, _ vars: [String: String]) {
        let k = WorkoutEngine.CueKind(rawValue: kind) ?? .info
        let (phoneLeads, speak): (Bool, Bool) = engineQueue.sync { (self.engine != nil, self.shouldSpeak(k)) }
        guard !phoneLeads else { return }
        let spoken = text.replacingOccurrences(of: "\n", with: ". ")
        notifyListeners("cue", data: ["text": spoken, "kind": kind, "source": "garmin"])
        guard speak else { return }
        if key == "count" {
            // odliczanie: licznik przysyła tylko „3” – resztę telefon odlicza sam, co sekundę (bez opóźnień radia)
            let from = Int(vars["n"] ?? "") ?? 3
            for (i, n) in stride(from: from, through: 1, by: -1).enumerated() {
                DispatchQueue.main.asyncAfter(deadline: .now() + Double(i)) {
                    self.say("count", ["n": "\(n)"], "\(n)", interrupt: i == 0)
                }
            }
            return
        }
        say(key, vars, spoken, interrupt: kind == "countdown" || key == "falseStart")
    }

    /// Przycisk ENZO na liczniku (albo Flic przy treningu z licznika): stan jazdy + pytanie głosem przez
    /// mikrofon słuchawek; „q” = gotowe pytanie bez słuchania (np. raport). Główny wątek.
    private func garminTalk(_ msg: [String: Any]) {
        let phoneLeads: Bool = engineQueue.sync {
            if let st = msg["st"] as? [String: Any] { self.garminState = st; self.garminStateAt = Date() }
            return self.engine != nil
        }
        if !phoneLeads { useGarminToken(msg) }
        if let q = msg["q"] as? String, !q.isEmpty {
            _ = localAnswer(q)
            return
        }
        coach.start()
    }

    /// Token rozmowy z trenerem, który licznik dostał z serwera przy synchronizacji – dzięki niemu pytania
    /// działają także wtedy, gdy trening nie był uruchamiany w telefonie.
    private func useGarminToken(_ msg: [String: Any]) {
        guard let tk = msg["tk"] as? String, !tk.isEmpty else { return }
        coach.token = tk
        if let b = (msg["b"] as? String).flatMap({ URL(string: $0) }) { coach.baseURL = b }
    }

    /// Start / pauza / wznowienie / koniec jazdy na liczniku. Główny wątek.
    private func garminRideState(_ s: String, _ info: [String: Any]) {
        var d = GarminLink.shared.status(); d["ride"] = s
        notifyListeners("garmin", data: d)
        let phoneLeads: Bool = engineQueue.sync { self.engine != nil }
        guard !phoneLeads else { return }
        useGarminToken(info)
        let auto = (info["auto"] as? NSNumber)?.intValue == 1
        let quiet: Bool = engineQueue.sync { self.voiceLevel == "off" }
        guard !auto, !quiet else { return }   // auto-pauza na światłach: licznik pokazuje baner, Enzo milczy
        switch s {
        case "pause": say("manualPause", [:], "Pauza.", interrupt: false)
        case "resume": say("manualResume", [:], "Jedziemy dalej.", interrupt: false)
        default: break
        }
    }

    /// klik → rozmowa z Enzo · 2× klik → okrążenie (swobodna) / następny krok (plan) · przytrzymaj → raport.
    /// Poza jazdą tylko zdarzenie dla ekranu Czujniki (test przycisku). Główny wątek.
    private func handleFlic(_ kind: String) {
        notifyListeners("flic", data: ["press": kind])
        let phase: WorkoutEngine.Phase? = engineQueue.sync { self.engine?.phase }
        guard let ph = phase else {
            // trening prowadzi licznik Garmin: przycisk steruje licznikiem (ten odsyła stan jazdy do rozmowy)
            guard GarminLink.shared.isStreaming else { return }
            switch kind {
            case "click": GarminLink.shared.sendCommand("talk")
            case "double": GarminLink.shared.sendCommand("lap")
            case "hold": GarminLink.shared.sendCommand("report")
            default: break
            }
            return
        }
        switch kind {
        case "click":
            coach.start()
        case "double":
            if ph == .free { flicLap() } else { coachAction("next") }
        case "hold":
            _ = localAnswer("raport")
        default: break
        }
    }

    private func flicLap() {
        engineQueue.async {
            guard let eng = self.engine else { return }
            eng.advance()
            let sec = eng.lastSecond
            guard let r = eng.manualLap() else { return }
            self.recorder?.appendEvent(second: sec, "lap")
            let level = self.voiceLevel
            let text = "Okrążenie \(r.n). Poprzednie: \(Phrases.duration(r.prevSec)), średnio \(r.prevAvg) watów."
            DispatchQueue.main.async {
                self.notifyListeners("cue", data: ["text": text, "kind": "lap"])
                guard level != "off" else { return }
                if self.voiceMode == "enzo", let d = self.director {
                    let ids = (d.compose("doneCmd", [:]) ?? []) + (d.compose("status", ["avg": "\(r.prevAvg)", "hr": "", "hrState": ""]) ?? [])
                    if !ids.isEmpty { d.play(ids) }
                } else {
                    self.speaker.speak(text)
                }
            }
        }
    }

    @objc func talk(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.coach.start(); call.resolve() }
    }

    private func makeCoach() -> CoachTalk {
        let c = CoachTalk()
        c.onEvent = { [weak self] kind, data in
            var d = data; d["state"] = kind
            self?.notifyListeners("coach", data: d)
            // odpowiedź trenera także na ekran licznika
            if kind == "answer", let t = data["text"] as? String, GarminLink.shared.isStreaming { GarminLink.shared.sendEnzoAnswer(t) }
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

    /// „Zjadłem” / „wypiłem”: do silnika telefonu albo – gdy trening prowadzi licznik Garmin – do licznika.
    private func fuel(_ kind: String) {
        engineQueue.async {
            if let e = self.engine { e.fueled(kind) }
            else { DispatchQueue.main.async { if GarminLink.shared.isStreaming { GarminLink.shared.sendCommand(kind) } } }
        }
    }

    /// Polecenia sterujące jazdą (z mowy albo z odpowiedzi trenera AI).
    private func coachAction(_ a: String) {
        engineQueue.async {
            guard let eng = self.engine else {
                // trening prowadzi licznik Garmin → polecenie idzie do niego
                DispatchQueue.main.async { if GarminLink.shared.isStreaming { GarminLink.shared.sendCommand(a) } }
                return
            }
            switch a {
            case "next":
                eng.advance(); self.recorder?.appendEvent(second: eng.lastSecond, "skip"); eng.skipStep()
            case "cancel":
                self.cancelStartInternal(eng)
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
        // bez treningu w telefonie: stan z licznika Garmin (świeży – przychodzi razem z przyciskiem ENZO)
        if engine == nil { return Date().timeIntervalSince(garminStateAt) < 90 ? garminState : [:] }
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
            if GarminLink.shared.isStreaming { GarminLink.shared.sendEnzoAnswer(text) }
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
            fuel("eat")
            play(lead("ateOk"), "Zapisane – zjedzone."); return true
        }
        if has("wypilem", "wypilam", "pilem", "pije ") {
            fuel("drink")
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
        // --- nawigacja: wyłącz / włącz (przed „wznów”, które steruje jazdą)
        if st["route"] != nil {
            if has("wylacz nawigacj", "koniec nawigacji", "zakoncz nawigacj", "stop nawigacj", "bez nawigacji") {
                engineQueue.async { self.setNav(false) }; return true
            }
            if has("wlacz nawigacj", "wznow nawigacj", "wroc do nawigacji", "nawiguj") {
                engineQueue.async { self.setNav(true) }; return true
            }
        }
        // --- polecenia
        if has("falstart", "anuluj", "od nowa", "jeszcze nie", "nie teraz", "nie startuj"),
           ((st["falseStartLeft"] as? Int) ?? 0) > 0 {
            coachAction("cancel"); return true           // silnik sam mówi „Falstart…”
        }
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
            let avg = (last["avgPower"] as? Int) ?? 0, vrd = (last["verdict"] as? String) ?? "ok"
            var ids = lead("prevSeries")
            if let d = enzo, let c = d.compose("seriesEnd", ["avg": "\(avg)", "vrd": vrd]) { ids += c.dropFirst() }
            play(ids, "Poprzednia seria: średnio \(avg) watów – \(WorkoutEngine.verdictText(vrd)).")
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
