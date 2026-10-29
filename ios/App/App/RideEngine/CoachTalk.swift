import AVFoundation
import Speech
import MediaPlayer

/// Wspólna „blokada” sesji audio: gdy rozmowa przez dotknięcie słuchawki jest włączona, aplikacja
/// trzyma sesję odtwarzania (żeby iOS kierował do nas przyciski słuchawek/okularów), a Enzo i głos
/// systemowy nie przełączają kategorii ani nie zwalniają sesji po każdym komunikacie.
enum AudioGate {
    static var hold = false
    static func restoreDefault() {
        let s = AVAudioSession.sharedInstance()
        if hold {
            try? s.setCategory(.playback, mode: .default, options: [])
            try? s.setActive(true)
        } else {
            try? s.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
            try? s.setActive(false, options: .notifyOthersOnDeactivation)
        }
    }
}

/// Rozmowa z Enzo w trakcie jazdy: dotknięcie słuchawki / okularów (play/pauza) albo przycisk na
/// ekranie → „Słucham!” → mowa z mikrofonu słuchawek na tekst (pl-PL) → odpowiedź.
/// Proste pytania i polecenia obsługuje aplikacja (offline, głosem Enzo), resztę trener AI na serwerze.
/// Wszystko na głównym wątku.
final class CoachTalk: NSObject {
    enum Phase: String { case idle, listening, thinking }

    // podpinane przez plugin
    var onEvent: ((String, [String: Any]) -> Void)?          // dla ekranu: listening / question / answer / error / idle
    var playLead: ((String, (() -> Void)?) -> Void)?          // klip Enzo (np. "listen") + po nim
    var speakAnswer: ((String) -> Void)?
    var localAnswer: ((String) -> Bool)?                      // true = obsłużone lokalnie
    var runAction: ((String) -> Void)?                        // next | pause | resume
    var stateProvider: (() -> [String: Any])?

    var token: String?
    var baseURL: URL?
    private(set) var phase: Phase = .idle

    private let session = AVAudioSession.sharedInstance()
    private let audioEngine = AVAudioEngine()
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "pl-PL"))
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var timer: Timer?
    private var startedAt = Date(), lastHeard = Date()
    private var heard = false
    private var text = ""
    private var keepAlive: AVAudioPlayer?
    private var tapOn = false

    static func requestPermissions() {
        SFSpeechRecognizer.requestAuthorization { _ in }
        AVAudioSession.sharedInstance().requestRecordPermission { _ in }
    }

    // MARK: - Dotknięcie słuchawki / okularów

    /// Włączone: aplikacja jest „odtwarzaczem” (cicha pętla), więc play/pauza ze słuchawek trafia do Enzo.
    /// Uwaga: muzyka z innej aplikacji zostaje wtedy zatrzymana – to warunek iOS.
    func setTapMode(_ requested: Bool) {
        // WYŁĄCZONE: niemieszalna sesja odbierała przyciski słuchawek, ale blokowała Spotify
        // (i zbierała zaległe komunikaty). Rozmowa: przycisk na ekranie. Zostaje tylko sprzątanie.
        let on = false
        _ = requested
        guard on != tapOn else { return }
        tapOn = on
        let cc = MPRemoteCommandCenter.shared()
        let cmds = [cc.togglePlayPauseCommand, cc.playCommand, cc.pauseCommand]
        if on {
            AudioGate.hold = true
            try? session.setCategory(.playback, mode: .default, options: [])
            try? session.setActive(true)
            keepAlive = try? AVAudioPlayer(data: Self.silence())
            keepAlive?.numberOfLoops = -1
            keepAlive?.volume = 0
            keepAlive?.play()
            for c in cmds {
                c.isEnabled = true
                c.addTarget { [weak self] _ in self?.start(); return .success }
            }
            MPNowPlayingInfoCenter.default().nowPlayingInfo = [
                MPMediaItemPropertyTitle: "Enzo – dotknij, żeby zapytać",
                MPMediaItemPropertyArtist: "VeloIQ",
                MPNowPlayingInfoPropertyPlaybackRate: 1.0,
            ]
        } else {
            for c in cmds { c.removeTarget(nil) }
            keepAlive?.stop(); keepAlive = nil
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            AudioGate.hold = false
            AudioGate.restoreDefault()
        }
    }

    /// 1 s ciszy (WAV 16 kHz mono) – pętla, dzięki której iOS traktuje nas jak odtwarzacz.
    private static func silence() -> Data {
        let rate = 16000, n = rate
        var d = Data()
        func u32(_ v: Int) { var x = UInt32(v).littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: Int) { var x = UInt16(v).littleEndian; d.append(Data(bytes: &x, count: 2)) }
        d.append("RIFF".data(using: .ascii)!); u32(36 + n * 2); d.append("WAVEfmt ".data(using: .ascii)!)
        u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16)
        d.append("data".data(using: .ascii)!); u32(n * 2); d.append(Data(count: n * 2))
        return d
    }

    // MARK: - Słuchanie

    func start() {
        guard phase == .idle else { return }
        guard SFSpeechRecognizer.authorizationStatus() == .authorized,
              session.recordPermission == .granted, recognizer?.isAvailable == true else {
            Self.requestPermissions()
            onEvent?("error", ["text": "Zezwól VeloIQ na mikrofon i rozpoznawanie mowy (Ustawienia → VeloIQ)."])
            playLead?("repeat", nil)
            return
        }
        phase = .listening
        onEvent?("listening", [:])
        playLead?("listen") { [weak self] in self?.record() }
    }

    private func record() {
        do {
            // mieszana z muzyką: Spotify tylko ściszony na czas pytania, potem wraca
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .defaultToSpeaker, .mixWithOthers, .duckOthers])
            try session.setActive(true)
            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            req.taskHint = .dictation
            request = req
            let input = audioEngine.inputNode
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buf, _ in req.append(buf) }
            audioEngine.prepare()
            try audioEngine.start()
            text = ""; heard = false; startedAt = Date(); lastHeard = Date()
            task = recognizer?.recognitionTask(with: req) { [weak self] res, err in
                DispatchQueue.main.async {
                    guard let self = self, self.request != nil else { return }
                    if let r = res {
                        let t = r.bestTranscription.formattedString
                        if t != self.text { self.text = t; self.heard = !t.isEmpty; self.lastHeard = Date() }
                        if r.isFinal { self.finish() }
                    } else if err != nil { self.finish() }
                }
            }
            timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
                guard let self = self else { return }
                let now = Date()
                // koniec: 1,3 s ciszy po pytaniu, 5 s bez słowa albo 9 s łącznie
                if (self.heard && now.timeIntervalSince(self.lastHeard) > 1.3)
                    || (!self.heard && now.timeIntervalSince(self.startedAt) > 5)
                    || now.timeIntervalSince(self.startedAt) > 9 { self.finish() }
            }
        } catch {
            stopAudio()
            phase = .idle
            onEvent?("error", ["text": "Nie mogę włączyć mikrofonu."])
        }
    }

    private func stopAudio() {
        timer?.invalidate(); timer = nil
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio(); task?.cancel()
        request = nil; task = nil
        AudioGate.restoreDefault()
    }

    private func finish() {
        guard request != nil else { return }
        stopAudio()
        let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else {
            phase = .idle
            onEvent?("idle", [:])
            playLead?("repeat", nil)
            return
        }
        onEvent?("question", ["text": q])
        if localAnswer?(q) == true { phase = .idle; return }
        ask(q)
    }

    // MARK: - Trener AI

    private func ask(_ q: String) {
        guard let base = baseURL, let tok = token else {
            phase = .idle; playLead?("offline", nil); return
        }
        phase = .thinking
        playLead?("think", nil)
        var req = URLRequest(url: base.appendingPathComponent("api/ride/ask"))
        req.httpMethod = "POST"
        req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(tok)", forHTTPHeaderField: "Authorization")
        let body: [String: Any] = ["question": q, "state": stateProvider?() ?? [:]]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req) { [weak self] data, resp, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.phase = .idle
                guard let data = data, (resp as? HTTPURLResponse)?.statusCode == 200,
                      let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let say = j["say"] as? String, !say.isEmpty else {
                    self.onEvent?("error", ["text": "Brak odpowiedzi – sprawdź zasięg."])
                    self.playLead?("offline", nil)
                    return
                }
                self.onEvent?("answer", ["text": say])
                if let a = j["action"] as? String, !a.isEmpty { self.runAction?(a) }
                self.speakAnswer?(say)
            }
        }.resume()
    }
}
