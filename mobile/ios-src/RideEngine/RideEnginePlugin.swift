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
    private static let modeKey = "veloiq.voice.mode"
    private var voiceMode: String {
        get { UserDefaults.standard.string(forKey: Self.modeKey) ?? "enzo" }
        set { UserDefaults.standard.set(newValue, forKey: Self.modeKey) }
    }
    /// Główny wątek: Dyrektor, gdy ma nagranie; inaczej synteza iOS.
    private func say(_ key: String?, _ vars: [String: String], _ text: String, interrupt: Bool) {
        if voiceMode == "enzo", let d = director, let k = key {
            guard let seg = d.compose(k, vars) else { return }   // nil: tego dyrektor nie mówi (jest na ekranie)
            if !seg.isEmpty { d.play(seg, interrupt: interrupt); return }
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
    /// "full" – wszystko | "struct" – bez korekt/pochwał | "off" – bez głosu (tekst nadal idzie do UI)
    private var voiceLevel = "full"
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
        let rec = try Recorder(workoutId: script.id, resumeFileName: resumeFileName)
        let eng = WorkoutEngine(script: script, startDate: startDate, pausedTotal: pausedTotal, pausedAt: pausedAt)
        if let f = resumeFileName { eng.seed(Recorder.readSamples(fileName: f)) }
        lastLat = nil; lastLon = nil
        let lang = script.lang ?? "pl-PL"
        DispatchQueue.main.async {
            if self.speakerLanguage != lang { self.speaker = Speaker(language: lang); self.speakerLanguage = lang }
        }

        eng.onCue = { [weak self] text, kind in
            self?.notifyListeners("cue", data: ["text": text, "kind": kind.rawValue])
        }
        eng.onSpeak = { [weak self] key, vars, text, kind in
            guard let self = self, self.shouldSpeak(kind) else { return }
            DispatchQueue.main.async { self.say(key, vars, text, interrupt: kind == .countdown) }
        }
        eng.onLive = { [weak self] live in self?.notifyListeners("live", data: live.toDict()) }
        // seed() ustawił lastSecond, więc sekundy już zapisane w pliku nie zostaną dopisane ponownie
        eng.onSecond = { [weak self] s, p, hr, cad, bal in
            guard let self = self else { return }
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
        tm.setEventHandler { [weak self] in self?.engine?.advance() }
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
