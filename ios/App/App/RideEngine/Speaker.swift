import AVFoundation

/// Komunikaty głosowe – działają przy zablokowanym ekranie (UIBackgroundModes: audio),
/// ściszają muzykę (Spotify/Apple Music) na czas komunikatu i oddają ją potem.
/// Głos i tempo wybiera użytkownik (zapisywane w UserDefaults); domyślnie najlepszy dostępny pl-PL.
final class Speaker: NSObject, AVSpeechSynthesizerDelegate {
    static let voiceKey = "veloiq.voice.id"
    static let rateKey = "veloiq.voice.rate"

    private let synth = AVSpeechSynthesizer()
    private let session = AVAudioSession.sharedInstance()
    private let language: String
    private var voice: AVSpeechSynthesisVoice?
    private(set) var rate: Float = 0.5

    init(language: String = "pl-PL") {
        self.language = language
        super.init()
        synth.delegate = self
        let d = UserDefaults.standard
        if d.object(forKey: Self.rateKey) != nil { rate = d.float(forKey: Self.rateKey) }
        voice = Self.resolveVoice(id: d.string(forKey: Self.voiceKey), language: language)
        if !AudioGate.hold {
            try? session.setCategory(.playback, mode: .voicePrompt,
                                     options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        }
    }

    /// Wybrany głos, jeśli pasuje do języka; inaczej najlepszy (Premium > Enhanced > domyślny).
    private static func resolveVoice(id: String?, language: String) -> AVSpeechSynthesisVoice? {
        if let id = id, let v = AVSpeechSynthesisVoice(identifier: id), v.language == language { return v }
        let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language == language }
        return voices.max { $0.quality.rawValue < $1.quality.rawValue } ?? AVSpeechSynthesisVoice(language: language)
    }

    /// Lista głosów dla UI. quality: default | enhanced | premium.
    static func voices(language: String) -> [[String: Any]] {
        AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language == language }
            .sorted { $0.quality.rawValue > $1.quality.rawValue }
            .map { v in
                let q: String
                switch v.quality {
                case .enhanced: q = "enhanced"
                case .premium: q = "premium"
                default: q = "default"
                }
                return ["id": v.identifier, "name": v.name, "quality": q]
            }
    }

    var currentVoiceId: String? { voice?.identifier }

    func configure(voiceId: String?, rate newRate: Float?) {
        let d = UserDefaults.standard
        if let id = voiceId {
            d.set(id, forKey: Self.voiceKey)
            voice = Self.resolveVoice(id: id, language: language)
        }
        if let r = newRate {
            rate = min(max(r, 0.35), 0.65)
            d.set(rate, forKey: Self.rateKey)
        }
    }

    /// Odliczanie i korekty mogą przerwać kolejkę – ważniejsze jest "teraz" niż zaległości.
    func speak(_ text: String, interrupt: Bool = false) {
        guard !text.isEmpty else { return }
        if interrupt && synth.isSpeaking { synth.stopSpeaking(at: .word) }
        try? session.setActive(true)
        let u = AVSpeechUtterance(string: language == "pl-PL" ? Self.polishGrammar(text) : text)
        u.voice = voice
        u.rate = rate
        u.pitchMultiplier = 1.0
        u.preUtteranceDelay = 0
        u.postUtteranceDelay = 0.08
        synth.speak(u)
    }

    func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) { releaseIfIdle() }
    func speechSynthesizer(_ s: AVSpeechSynthesizer, didCancel u: AVSpeechUtterance) { releaseIfIdle() }

    private func releaseIfIdle() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let self = self, !self.synth.isSpeaking, !AudioGate.hold,
                  self.session.category != .playAndRecord else { return }
            try? self.session.setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    // MARK: - Odmiana liczebników (szablony mają formę "N watów")

    private static let pluralRx = try? NSRegularExpression(
        pattern: #"(?<!do |od |poniżej |powyżej )\b(\d+) (watów|uderzeń)"#)

    /// "Dodaj 22 watów" → "Dodaj 22 waty", "1 watów" → "1 wat". Po "do/od/poniżej/powyżej" zostaje dopełniacz.
    static func polishGrammar(_ text: String) -> String {
        guard let rx = pluralRx else { return text }
        let ns = text as NSString
        var out = text
        for m in rx.matches(in: text, range: NSRange(location: 0, length: ns.length)).reversed() {
            guard let n = Int(ns.substring(with: m.range(at: 1))) else { continue }
            let word = ns.substring(with: m.range(at: 2))
            let forms = word == "watów" ? ("wat", "waty", "watów") : ("uderzenie", "uderzenia", "uderzeń")
            let few = (2...4).contains(n % 10) && !(12...14).contains(n % 100)
            let form = n == 1 ? forms.0 : few ? forms.1 : forms.2
            if let r = Range(m.range(at: 2), in: out) { out.replaceSubrange(r, with: form) }
        }
        return out
    }
}
