import Foundation

/// Symulowany zawodnik – do testów reguł i głosu bez roweru (BLE nie działa w symulatorze iOS).
/// Reaguje na silnik jak człowiek i celowo popełnia błędy, żeby padły wszystkie typy komunikatów:
/// - startuje interwały za wcześnie / za późno (losowo od -30 do +60 s względem planu),
/// - w 2. interwale staje na 15 s ("światła") → auto-pauza,
/// - w części interwałów jedzie chwilę za mocno / za słabo, pod koniec spada mu kadencja,
/// - w ostatnim interwale odpuszcza po 3/4 czasu → "przerwałeś",
/// - po planie jedzie swobodnie z jednym mocnym wysiłkiem → automatyczne wykrycie wysiłku.
final class SensorSimulator {
    private var timer: DispatchSourceTimer?
    private let state: () -> WorkoutEngine.SimState?
    var onPower: ((Int, Int) -> Void)? // (moc, kadencja)
    var onHr: ((Int) -> Void)?

    private var t = 0
    private var hr = 110.0
    private var startDelay: [Int: Int] = [:]   // indeks kroku przerwy -> opóźnienie startu [s]
    private var pushing = false
    private var freeSince: Int?
    private var stopAt: Int?

    init(state: @escaping () -> WorkoutEngine.SimState?) { self.state = state }

    func start(queue: DispatchQueue) {
        let tm = DispatchSource.makeTimerSource(queue: queue)
        tm.schedule(deadline: .now(), repeating: 1.0)
        tm.setEventHandler { [weak self] in self?.tick() }
        tm.resume()
        timer = tm
    }

    func stop() { timer?.cancel(); timer = nil }

    private func tick() {
        t += 1
        guard let st = state() else { return }
        var p: Double
        var cad = 90 + Int.random(in: -3...3)

        switch st.type {
        case "free":
            if freeSince == nil { freeSince = t }
            let ft = t - (freeSince ?? t)
            p = (60..<150).contains(ft) ? Double(st.ftp) * 0.95 : Double(st.ftp) * 0.5
        case "interval":
            pushing = false
            let mid = Double(st.low + st.high) / 2
            p = mid
            let iv = st.stepIdx // numer kroku – różne błędy w różnych interwałach
            if (40...55).contains(st.inStep) && iv % 2 == 1 { p = Double(st.high) + 35 }
            if (100...115).contains(st.inStep) && iv % 2 == 1 { p = Double(st.low) - 30 }
            if iv == 3 && st.inStep >= 100 {                                            // "światła" – 15 s postoju, raz
                if stopAt == nil { stopAt = t }
                if let s0 = stopAt, t - s0 < 15 { p = 0; cad = 0 }
            }
            if st.next == nil || st.next?.type == "cooldown" {
                if st.inStep >= st.durationSec * 3 / 4 { p = Double(st.low) * 0.5 }      // odpuszcza
            }
            if st.inStep > 150 { cad = 76 }
        default:
            p = Double(st.low + st.high) / 2
            if st.type == "recovery" && (20...35).contains(st.inStep) { p = Double(st.high) + 40 }
            // czuwanie przed auto-interwałem: start z losowym opóźnieniem względem planu
            if let next = st.next, next.type == "interval", st.phase == .armed || st.phase == .waiting || pushing {
                let delay = startDelay[st.stepIdx] ?? {
                    let d = Int.random(in: -30...60); startDelay[st.stepIdx] = d; return d
                }()
                if pushing || st.inStep >= st.durationSec + delay {
                    pushing = true
                    p = Double(next.powerLow + next.powerHigh) / 2
                }
            }
        }
        p += Double.random(in: -12...12)
        if p < 5 { p = 0 }
        if p == 0 { cad = 0 }
        // tętno dąży do poziomu zależnego od mocy, z lekkim dryfem w czasie
        let targetHr = 95 + p * 0.22 + Double(t) / 150
        hr += (targetHr - hr) * 0.05
        onPower?(max(0, Int(p)), cad)
        onHr?(Int(hr))
    }
}
