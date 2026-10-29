import Foundation
import UserNotifications

/// Krótkie powiadomienia z komunikatów Enzo – iPhone przekazuje je na licznik (Garmin Edge,
/// Wahoo) przez „Smart Notifications”. Tylko zwięzłe fakty, bez rozmowy. Wyłącznik w ustawieniach jazdy.
final class EnzoNotifier: NSObject, UNUserNotificationCenterDelegate {
    var enabled = true
    private static let thread = "veloiq.enzo"
    private weak var previous: UNUserNotificationCenterDelegate?
    private var installed = false
    private var lastIds: [String] = []

    func requestPermission() {
        DispatchQueue.main.async {
            let c = UNUserNotificationCenter.current()
            if !self.installed {
                // pokazuj nasze powiadomienia także przy otwartej aplikacji (inaczej iOS ich nie wyśle na licznik);
                // cudze (Capacitor) przekazujemy dalej
                self.previous = c.delegate
                c.delegate = self
                self.installed = true
            }
            c.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }
    }

    /// Krótki tekst dla licznika albo nil (tego nie wysyłamy).
    static func text(_ key: String?, _ v: [String: String]) -> String? {
        guard let k = key else { return nil }
        func g(_ s: String) -> String { v[s] ?? "" }
        let range = "\(g("low"))–\(g("high")) W"
        switch k {
        case "intervalStart": return "Start: interwał \(g("n"))/\(g("total")) · \(g("dur")) · \(range)"
        case "autoStart": return "Start · \(g("dur")) · \(range)"
        case "armNext": return "Za 1 min: interwał \(g("n"))/\(g("total")) · \(range)"
        case "recoveryStart": return "Przerwa · \(g("dur")) · < \(g("high")) W"
        case "warmupStart": return "Rozgrzewka · \(g("dur")) · \(range)"
        case "cooldownStart": return "Schłodzenie · \(g("dur"))"
        case "steadyStart": return "\(g("name")) · \(g("dur")) · \(range)"
        case "tooHigh": return "Za mocno: −\(g("delta")) W (max \(g("high")) W)"
        case "tooLow": return "Za słabo: +\(g("delta")) W (min \(g("low")) W)"
        case "recoveryTooHigh": return "Odpoczynek: < \(g("high")) W"
        case "cadenceLow": return "Kadencja \(g("cad")) → \(g("cadLow"))+"
        case "cadenceHigh": return "Kadencja \(g("cad")) → max \(g("cadHigh"))"
        case "lastMinute": return "Ostatnia minuta!"
        case "seriesEnd":
            var t = "Seria \(g("n"))/\(g("total")): \(g("avg")) W · \(g("pct"))%"
            if let d = v["hrUp"] { t += " · tętno +\(d)" }
            return t
        case "hrHigh": return "Tętno \(g("hr")) – za wysoko"
        case "hrRecovered": return "Tętno \(g("hr")) – zregenerowany"
        case "status":
            var t = "Średnio \(g("avg")) W"
            if let h = v["hr"], !h.isEmpty {
                t += " · tętno \(h)" + (["ok": " ✓", "high": " ↑", "low": " ↓"][g("hrState")] ?? "")
            }
            return t
        case "readiness": return "Gotowość \(g("pct"))% – \(g("state"))"
        case "condition": return "Kondycja dziś \(g("sign"))\(g("n"))"
        case "drink": return "Pij!"
        case "eat": return "Jedz – żel/baton"
        case "planDone": return "Plan zrobiony"
        case "navTurn":
            let d = ["left": "w lewo", "right": "w prawo", "slightLeft": "lekko w lewo", "slightRight": "lekko w prawo",
                     "sharpLeft": "ostro w lewo", "sharpRight": "ostro w prawo", "uturn": "zawróć"][g("dir")] ?? "skręt"
            return g("dist") == "0" ? "Teraz \(d)" : "Za \(g("m")) m \(d)"
        case "navOff": return "Zjechałeś z trasy"
        case "navBack": return "Z powrotem na trasie"
        case "navClimb": return "Podjazd za 1 km: \(g("len")) km · \(g("grade"))%"
        case "navClimbStart": return "Podjazd: \(g("len")) km · \(g("grade"))% · +\(g("gain")) m"
        case "navTop": return "Szczyt"
        case "navLeft": return "Do mety: \(g("km")) km"
        case "navDone": return "Meta trasy"
        case "navStart": return "Nawigacja: jesteś na trasie"
        case "navToStart": return "Jedź do startu trasy (\(g("m")) m)"
        case "powerLost": return "Brak sygnału mocy"
        case "hrLost": return "Brak sygnału tętna"
        default: return nil
        }
    }

    func post(_ key: String?, _ vars: [String: String]) {
        guard enabled, let body = Self.text(key, vars) else { return }
        let c = UNUserNotificationCenter.current()
        let content = UNMutableNotificationContent()
        content.title = "Enzo"
        content.body = body
        content.threadIdentifier = Self.thread
        content.sound = nil                                   // dźwięk robi Enzo
        if #available(iOS 15.0, *) { content.interruptionLevel = .timeSensitive }
        let id = "enzo-\(Date().timeIntervalSince1970)"
        c.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        // porządek: na telefonie zostają tylko 3 ostatnie
        DispatchQueue.main.async {
            self.lastIds.append(id)
            if self.lastIds.count > 3 {
                let old = Array(self.lastIds.prefix(self.lastIds.count - 3))
                self.lastIds.removeFirst(old.count)
                c.removeDeliveredNotifications(withIdentifiers: old)
            }
        }
    }

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent n: UNNotification,
                                withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        if n.request.content.threadIdentifier == Self.thread { done([.banner, .list]); return }
        if let p = previous, p.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:willPresent:withCompletionHandler:))) {
            p.userNotificationCenter?(center, willPresent: n, withCompletionHandler: done)
        } else { done([]) }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive r: UNNotificationResponse,
                                withCompletionHandler done: @escaping () -> Void) {
        if r.notification.request.content.threadIdentifier == Self.thread { done(); return }
        if let p = previous, p.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:didReceive:withCompletionHandler:))) {
            p.userNotificationCenter?(center, didReceive: r, withCompletionHandler: done)
        } else { done() }
    }
}
