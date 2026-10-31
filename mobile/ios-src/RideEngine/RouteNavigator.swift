import Foundation

/// Nawigacja po trasie GPX (dane z lib/ride/gpx.ts): dopasowanie pozycji do trasy, postęp,
/// zapowiedzi skrętów (300/500 m i „teraz”), zjechanie z trasy i powrót, podjazdy (1 km przed,
/// start, szczyt), kilometry do mety i meta. Wywoływane na engineQueue przy każdej pozycji GPS.
final class RouteNavigator {
    struct Cue { let d: Double; let dir: String }
    struct Climb { let start: Double; let end: Double; let gain: Double; let grade: Double }

    let name: String
    let total: Double
    private let lat: [Double], lon: [Double], dist: [Double]
    private let cues: [Cue]
    private let climbs: [Climb]

    /// (klucz komunikatu, zmienne) – plugin zamienia na głos Enzo i powiadomienie.
    var onSay: ((String, [String: String]) -> Void)?

    private(set) var acquired = false
    private(set) var offRoute = false
    private(set) var progress = 0.0
    /// false = nawigacja wyłączona w trakcie jazdy (przycisk / głos) – nic nie liczy i nie mówi.
    private(set) var enabled = true
    private var offSaid = 0                       // 1 = „Zjechałeś z trasy”, 2 = wyciszone do powrotu
    private var idx = 0
    private var offSince: Date?, lastOffSay = Date.distantPast, lastGlobal = Date.distantPast
    private var cueSaid: [Int: Int] = [:]        // 1 = zapowiedź, 2 = „teraz”
    private var climbSaid: [Int: Int] = [:]      // 1 = ostrzeżenie, 2 = start, 3 = szczyt
    private var lastKmLeft: Int?
    private var done = false
    private var speedKmh = 0.0
    private var toStartSaid = false

    init?(json: [String: Any]) {
        guard let pts = json["pts"] as? [[Any]], pts.count >= 2 else { return nil }
        var la: [Double] = [], lo: [Double] = [], di: [Double] = []
        for p in pts where p.count >= 4 {
            guard let a = (p[0] as? NSNumber)?.doubleValue, let b = (p[1] as? NSNumber)?.doubleValue,
                  let d = (p[3] as? NSNumber)?.doubleValue else { continue }
            la.append(a); lo.append(b); di.append(d)
        }
        guard la.count >= 2 else { return nil }
        lat = la; lon = lo; dist = di
        name = json["name"] as? String ?? "Trasa"
        total = (json["total"] as? NSNumber)?.doubleValue ?? di.last ?? 0
        cues = ((json["cues"] as? [[String: Any]]) ?? []).compactMap { c in
            guard let d = (c["d"] as? NSNumber)?.doubleValue, let dir = c["dir"] as? String else { return nil }
            return Cue(d: d, dir: dir)
        }
        climbs = ((json["climbs"] as? [[String: Any]]) ?? []).compactMap { c in
            guard let s = (c["start"] as? NSNumber)?.doubleValue, let e = (c["end"] as? NSNumber)?.doubleValue else { return nil }
            return Climb(start: s, end: e, gain: (c["gain"] as? NSNumber)?.doubleValue ?? 0, grade: (c["grade"] as? NSNumber)?.doubleValue ?? 0)
        }
    }

    // MARK: - Geometria

    /// Odległość punktu od odcinka i–i+1 (m) oraz rzut (0…1) – przybliżenie płaskie, wystarczające lokalnie.
    private func segDist(_ i: Int, _ la: Double, _ lo: Double) -> (Double, Double) {
        let k = cos(la * .pi / 180) * 111_320.0
        let ax = (lon[i] - lo) * k, ay = (lat[i] - la) * 110_540.0
        let bx = (lon[i + 1] - lo) * k, by = (lat[i + 1] - la) * 110_540.0
        let dx = bx - ax, dy = by - ay
        let l2 = dx * dx + dy * dy
        let t = l2 > 0 ? max(0, min(1, -(ax * dx + ay * dy) / l2)) : 0
        let px = ax + t * dx, py = ay + t * dy
        return ((px * px + py * py).squareRoot(), t)
    }

    private func nearest(_ la: Double, _ lo: Double, from a: Int, to b: Int) -> (i: Int, t: Double, d: Double) {
        var best = (i: a, t: 0.0, d: Double.greatestFiniteMagnitude)
        let lo2 = max(0, a), hi = min(lat.count - 2, b)
        guard lo2 <= hi else { return best }
        for i in lo2...hi {
            let (d, t) = segDist(i, la, lo)
            if d < best.d { best = (i, t, d) }
        }
        return best
    }

    // MARK: - Aktualizacja

    /// Wyłączenie / włączenie nawigacji w trakcie jazdy. Po włączeniu trasa jest szukana od nowa.
    func setEnabled(_ on: Bool) {
        guard on != enabled else { return }
        enabled = on
        offSince = nil; offRoute = false; offSaid = 0; lastGlobal = .distantPast
    }

    func update(lat la: Double, lon lo: Double, speedKmh v: Double?) {
        if let v = v, v >= 0 { speedKmh = speedKmh * 0.6 + v * 0.4 }
        guard enabled else { return }
        let now = Date()
        // okno wokół ostatniej pozycji (do 3 km do przodu); gdy brak dopasowania – szukaj po całej trasie co 5 s
        var m = nearest(la, lo, from: idx - 30, to: idx + 300)
        if (!acquired || m.d > 60) && now.timeIntervalSince(lastGlobal) > 5 {
            lastGlobal = now
            let g = nearest(la, lo, from: 0, to: lat.count - 2)
            if g.d + 5 < m.d { m = g }
        }
        if !acquired {
            if m.d <= 40 {
                acquired = true; idx = m.i
                onSay?("navStart", [:])
            } else {
                if !toStartSaid && m.d > 150 { toStartSaid = true; onSay?("navToStart", ["m": "\(Int(m.d))"]) }
                return
            }
        }
        if m.d > 50 {
            if offSince == nil { offSince = now }
            // dwa komunikaty: po 8 s i po 2 min (wyciszenie) – potem cisza do powrotu na trasę
            if !offRoute, let s = offSince, now.timeIntervalSince(s) >= 8 {
                offRoute = true; lastOffSay = now; offSaid = 1
                onSay?("navOff", [:])
            } else if offRoute && offSaid == 1 && now.timeIntervalSince(lastOffSay) >= 120 {
                offSaid = 2
                onSay?("navMute", [:])
            }
            return   // poza trasą nie przesuwamy postępu
        }
        offSince = nil
        if offRoute && m.d <= 30 { offRoute = false; offSaid = 0; onSay?("navBack", [:]) }
        idx = m.i
        progress = dist[m.i] + (dist[m.i + 1] - dist[m.i]) * m.t

        checkCues()
        checkClimbs()
        checkDistance()
    }

    private func checkCues() {
        let fast = speedKmh > 32
        let far: Double = fast ? 500 : 300
        let nowDist: Double = fast ? 70 : 45
        for (i, c) in cues.enumerated() {
            let to = c.d - progress
            if to < -20 { continue }
            if to > far + 50 { break }
            let said = cueSaid[i] ?? 0
            let prevClose = i > 0 && c.d - cues[i - 1].d < 150    // tuż po poprzednim skręcie – bez zapowiedzi
            if said < 1 && to <= far && to > 120 && !prevClose {
                cueSaid[i] = 1
                onSay?("navTurn", ["dist": fast ? "500" : "300", "dir": c.dir, "m": "\(Int(far))"])
            } else if said < 2 && to <= nowDist {
                cueSaid[i] = 2
                onSay?("navTurn", ["dist": "0", "dir": c.dir, "m": "0"])
            }
        }
    }

    private func checkClimbs() {
        for (i, c) in climbs.enumerated() {
            let said = climbSaid[i] ?? 0
            let len = c.end - c.start
            let vars = ["len": String(format: "%.1f", len / 1000), "grade": String(format: "%.0f", c.grade.rounded()), "gain": "\(Int(c.gain))"]
            if said < 1 && progress < c.start && c.start - progress <= 1000 {
                climbSaid[i] = 1; onSay?("navClimb", vars)
            } else if said < 2 && progress >= c.start && progress < c.end - 200 {
                climbSaid[i] = 2; onSay?("navClimbStart", vars)
            } else if said >= 2 && said < 3 && progress >= c.end {
                climbSaid[i] = 3; onSay?("navTop", vars)
            }
        }
    }

    private func checkDistance() {
        let left = max(0, total - progress)
        if !done && left <= 40 { done = true; onSay?("navDone", [:]); return }
        let km = Int((left / 1000).rounded(.down))
        // kamienie milowe: co 20 km powyżej 100, co 10 km do 100, potem 5, 2, 1
        let marks = [1, 2, 5] + Array(stride(from: 10, through: 100, by: 10)) + Array(stride(from: 120, through: 400, by: 20))
        if let last = lastKmLeft, km < last, let mark = marks.first(where: { $0 > km && $0 <= last }) {
            if left > 500 { onSay?("navLeft", ["km": "\(mark)"]) }
        }
        lastKmLeft = km
    }

    // MARK: - Stan dla ekranu i trenera

    func state() -> [String: Any] {
        var d: [String: Any] = ["name": name, "total": Int(total), "progress": Int(progress),
                                "left": Int(max(0, total - progress)), "acquired": acquired, "offRoute": offRoute,
                                "enabled": enabled, "muted": offSaid >= 2]
        if let i = cues.firstIndex(where: { $0.d - progress > -10 }) {
            d["nextTurn"] = ["dir": cues[i].dir, "in": Int(max(0, cues[i].d - progress))] as [String: Any]
        }
        if let c = climbs.first(where: { $0.end > progress }) {
            d["nextClimb"] = ["in": Int(max(0, c.start - progress)), "len": Int(c.end - c.start), "grade": c.grade,
                              "gain": Int(c.gain), "onIt": progress >= c.start] as [String: Any]
        }
        return d
    }
}
