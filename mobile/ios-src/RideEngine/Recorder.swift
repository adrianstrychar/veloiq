import Foundation

/// Zapis treningu 1 Hz do pliku JSONL (jedna linia = jedna sekunda) + stan do odzyskania po awarii.
/// Plik: Application Support/rides/<id>-<timestamp>.jsonl (sekundy, w których nie było odczytu, nie mają pól p/hr)
/// Linia: {"s":123,"t":1760000000,"p":285,"hr":152,"cad":91,"bal":51.5,"lat":50.77,"lon":15.75}
final class Recorder {
    private(set) var fileURL: URL
    private var handle: FileHandle?
    private var buffer = Data()
    private var lastFlush = Date()

    static let recoveryKey = "veloiq.rideEngine.recovery"

    struct RecoveryState: Codable {
        let scriptJSON: Data
        let startDate: Date
        let pausedTotal: TimeInterval
        let pausedAt: Date?
        let fileName: String   // tylko nazwa – ścieżka kontenera aplikacji zmienia się po aktualizacji
        let outdoor: Bool
    }

    static func ridesDir() throws -> URL {
        let dir = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                              appropriateFor: nil, create: true)
            .appendingPathComponent("rides", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    struct Recorded {
        var samples: [(power: Int?, hr: Int?, cad: Int?)] = []
        var skips: Set<Int> = []   // sekundy, w których zawodnik wcisnął "Następny krok"
        var cancels: Set<Int> = [] // sekundy, w których zawodnik odwołał start interwału („Fałstart”)
        var count: Int { samples.count }
    }

    /// Wczytuje zapisane sekundy i zdarzenia (do wznowienia po awarii – silnik je odtwarza).
    static func readSamples(fileName: String) -> Recorded {
        guard let dir = try? ridesDir(),
              let text = try? String(contentsOf: dir.appendingPathComponent(fileName), encoding: .utf8) else { return Recorded() }
        var bySecond: [Int: (Int?, Int?, Int?)] = [:]
        var skips: Set<Int> = []
        var cancels: Set<Int> = []
        var maxS = -1
        for line in text.split(separator: "\n") {
            guard let d = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                  let s = d["s"] as? Int else { continue }
            if let ev = d["ev"] as? String {
                if ev == "skip" { skips.insert(s) }
                if ev == "cancel" { cancels.insert(s) }
                continue
            }
            bySecond[s] = (d["p"] as? Int, d["hr"] as? Int, d["cad"] as? Int)
            maxS = max(maxS, s)
        }
        guard maxS >= 0 else { return Recorded() }
        let samples = (0...maxS).map { s -> (power: Int?, hr: Int?, cad: Int?) in
            let v = bySecond[s]
            return (power: v?.0, hr: v?.1, cad: v?.2)
        }
        return Recorded(samples: samples, skips: skips, cancels: cancels)
    }

    /// Zdarzenie w zapisie (np. ręczne "Następny krok"), potrzebne do wiernego odtworzenia po awarii.
    func appendEvent(second: Int, _ event: String) {
        if let line = try? JSONSerialization.data(withJSONObject: ["s": second, "ev": event]) {
            buffer.append(line)
            buffer.append(0x0A)
        }
        flush()
    }

    var fileName: String { fileURL.lastPathComponent }

    init(workoutId: String, resumeFileName: String? = nil) throws {
        let dir = try Recorder.ridesDir()
        if let f = resumeFileName {
            fileURL = dir.appendingPathComponent(f)
        } else {
            let safe = workoutId.replacingOccurrences(of: "/", with: "_")
            fileURL = dir.appendingPathComponent("\(safe)-\(Int(Date().timeIntervalSince1970)).jsonl")
        }
        if !FileManager.default.fileExists(atPath: fileURL.path) {
            FileManager.default.createFile(atPath: fileURL.path, contents: nil)
        }
        // nie wysyłaj surowych plików do iCloud backup
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? fileURL.setResourceValues(values)
        handle = try FileHandle(forWritingTo: fileURL)
        _ = try? handle?.seekToEnd()
    }

    func append(second: Int, power: Int?, hr: Int?, cadence: Int?, balance: Double?, lat: Double?, lon: Double?) {
        var d: [String: Any] = ["s": second, "t": Int(Date().timeIntervalSince1970)]
        if let v = power { d["p"] = v }
        if let v = hr { d["hr"] = v }
        if let v = cadence { d["cad"] = v }
        if let v = balance { d["bal"] = v }
        if let v = lat { d["lat"] = (v * 1e6).rounded() / 1e6 }
        if let v = lon { d["lon"] = (v * 1e6).rounded() / 1e6 }
        if let line = try? JSONSerialization.data(withJSONObject: d) {
            buffer.append(line)
            buffer.append(0x0A)
        }
        if Date().timeIntervalSince(lastFlush) >= 5 { flush() }
    }

    func flush() {
        guard !buffer.isEmpty else { return }
        do {
            try handle?.write(contentsOf: buffer)
            try handle?.synchronize()
        } catch {
            return // np. pełny dysk – zachowaj bufor, spróbuj przy kolejnym flushu
        }
        buffer.removeAll(keepingCapacity: true)
        lastFlush = Date()
    }

    func close() {
        flush()
        try? handle?.close()
        handle = nil
    }

    // MARK: - Odzyskiwanie po awarii

    static func saveRecovery(_ s: RecoveryState) {
        if let d = try? JSONEncoder().encode(s) { UserDefaults.standard.set(d, forKey: recoveryKey) }
    }

    static func loadRecovery() -> RecoveryState? {
        guard let d = UserDefaults.standard.data(forKey: recoveryKey) else { return nil }
        return try? JSONDecoder().decode(RecoveryState.self, from: d)
    }

    static func clearRecovery() { UserDefaults.standard.removeObject(forKey: recoveryKey) }
}
