import Foundation

/// Parsery standardowych charakterystyk Bluetooth SIG.
/// 0x2A37 Heart Rate Measurement, 0x2A63 Cycling Power Measurement.
enum BleParsers {

    struct HeartRate { let bpm: Int; let rrMs: [Double] }

    static func heartRate(_ data: Data) -> HeartRate? {
        let b = [UInt8](data)
        guard b.count >= 2 else { return nil }
        let flags = b[0]
        var o = 1
        let bpm: Int
        if flags & 0x01 != 0 {
            guard b.count >= 3 else { return nil }
            bpm = Int(UInt16(b[1]) | UInt16(b[2]) << 8)
            o = 3
        } else {
            bpm = Int(b[1])
            o = 2
        }
        // pas zgłasza brak kontaktu ze skórą (sensor contact supported, ale not detected) albo 0 bpm
        if (flags & 0x06) == 0x04 || bpm == 0 { return nil }
        if flags & 0x08 != 0 { o += 2 } // energy expended
        var rr: [Double] = []
        if flags & 0x10 != 0 {
            while o + 1 < b.count {
                let v = UInt16(b[o]) | UInt16(b[o + 1]) << 8
                rr.append(Double(v) / 1024.0 * 1000.0)
                o += 2
            }
        }
        return HeartRate(bpm: bpm, rrMs: rr)
    }

    struct Power { let watts: Int; let crankRevs: UInt16?; let crankTime: UInt16?; let balanceL: Double? }

    static func cyclingPower(_ data: Data) -> Power? {
        let b = [UInt8](data)
        guard b.count >= 4 else { return nil }
        let flags = UInt16(b[0]) | UInt16(b[1]) << 8
        let raw = Int16(bitPattern: UInt16(b[2]) | UInt16(b[3]) << 8)
        var o = 4
        var balanceL: Double?
        if flags & 0x01 != 0, o < b.count {
            // bit 1 = 1: wartość dotyczy lewej nogi; 0: strona nieznana – wtedy nie zgadujemy
            let v = Double(b[o]) / 2.0
            balanceL = (flags & 0x02 != 0) ? v : nil
            o += 1
        }
        if flags & 0x04 != 0 { o += 2 } // accumulated torque
        if flags & 0x10 != 0 { o += 6 } // wheel revolution data
        var revs: UInt16?, time: UInt16?
        if flags & 0x20 != 0, o + 3 < b.count {
            revs = UInt16(b[o]) | UInt16(b[o + 1]) << 8
            time = UInt16(b[o + 2]) | UInt16(b[o + 3]) << 8
        }
        return Power(watts: max(0, Int(raw)), crankRevs: revs, crankTime: time, balanceL: balanceL)
    }
}

/// Liczy kadencję z kolejnych pakietów "crank revolution data".
final class CadenceCalculator {
    private var lastRevs: UInt16?
    private var lastTime: UInt16?
    private var lastChange = Date.distantPast
    private var rebase = false
    private(set) var cadence: Int?

    func reset() { lastRevs = nil; lastTime = nil; cadence = nil; lastChange = .distantPast; rebase = false }

    func update(revs: UInt16, time: UInt16, now: Date = Date()) -> Int? {
        // Pierwszy pakiet: tylko punkt odniesienia.
        guard let pr = lastRevs, let pt = lastTime else {
            lastRevs = revs; lastTime = time; lastChange = now
            return nil
        }
        // Czas zdarzenia korby przekręca się co 64 s. Po postoju > 60 s pierwszy obrót
        // dałby błędną kadencję, więc pomijamy go i liczymy od kolejnego.
        if !rebase && now.timeIntervalSince(lastChange) > 60 { rebase = true }
        if rebase {
            if revs != pr { rebase = false; lastRevs = revs; lastTime = time; lastChange = now }
            cadence = 0
            return 0
        }
        let dRevs = Int(revs &- pr)
        let dTime = Int(time &- pt)
        if dRevs > 0 && dTime > 0 {
            let c = Int((Double(dRevs) * 60.0 * 1024.0 / Double(dTime)).rounded())
            if c < 250 { cadence = c }
            lastRevs = revs; lastTime = time; lastChange = now
        } else if now.timeIntervalSince(lastChange) > 3 {
            cadence = 0
        }
        return cadence
    }
}
