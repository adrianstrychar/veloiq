// VeloIQ – most telefon ↔ licznik Garmin Edge (Connect IQ Mobile SDK dla iOS).
//
// Czujniki są sparowane tylko z licznikiem (ANT+). Aplikacja VeloIQ na Edge (garmin/source/PhoneLink.mc) nadaje:
//   { "t":"live",  "v":[s, moc, tętno, kadencja, prędkość×10, faza, krok, zostało, cel↓, cel↑, pauza] }  – 1 Hz
//   { "t":"cue",   "k":klucz, "kind":rodzaj, "x":tekst, "v":{zmienne} }   – komunikat silnika → głos Enzo
//   { "t":"talk",  "st":{stan jazdy}, "q":gotowe pytanie?, "tk":token?, "b":adres serwera? }  – przycisk ENZO
//   { "t":"state", "s":"start|pause|resume|end", … }
// Telefon odsyła { "cmd":"next|pause|resume|cancel|lap|eat|drink|talk|report" } albo { "say":"odpowiedź Enzo" }.
//
// Pakiet Swift: https://github.com/garmin/connectiq-companion-app-sdk-ios (dodaje go mobile/setup-ios.sh).
// Bez pakietu w projekcie plik kompiluje się w wersji „most niedostępny”, reszta aplikacji działa bez zmian.
// Wszystkie wywołania zwrotne na głównym wątku.

import Foundation
#if canImport(ConnectIQ)
import ConnectIQ
#endif

/// Jedna sekunda z licznika.
struct GarminLive {
    let second: Int         // -1 = licznik nie nagrywa (podgląd czujników)
    let power: Int?         // nil = brak pomiaru mocy
    let hr: Int?            // nil = brak pasa
    let cadence: Int?       // nil = brak czujnika
    let speedKmh: Double?
    let phase: Int          // 0 running, 1 armed, 2 waiting, 3 autoPaused, 4 free
    let stepIndex: Int
    let stepRemaining: Int
    let targetLow: Int
    let targetHigh: Int

    init?(_ v: [Any]) {
        let n = v.compactMap { ($0 as? NSNumber)?.intValue }
        guard n.count >= 10, n.count == v.count else { return nil }
        second = n[0]
        power = n[1] >= 0 ? n[1] : nil
        hr = n[2] > 0 ? n[2] : nil
        cadence = n[3] >= 0 ? n[3] : nil
        speedKmh = n[4] >= 0 ? Double(n[4]) / 10.0 : nil
        phase = n[5]; stepIndex = n[6]; stepRemaining = n[7]; targetLow = n[8]; targetHigh = n[9]
    }
}

final class GarminLink: NSObject {
    static let shared = GarminLink()

    /// Identyfikator aplikacji VeloIQ na Edge – ten sam co w garmin/manifest.xml.
    static let appUUID = UUID(uuidString: "6f1d2c8e-4b7a-4d53-9a1e-5c0b7e2f9a41")!
    /// Schemat URL aplikacji iOS, którym Garmin Connect wraca po wyborze urządzenia (CFBundleURLSchemes).
    static let urlScheme = "veloiq"
    private static let deviceKey = "veloiq.garmin.device"

    var onLive: ((GarminLive) -> Void)?
    var onCue: ((_ key: String, _ kind: String, _ text: String, _ vars: [String: String]) -> Void)?
    /// Przycisk ENZO na liczniku (albo odpowiedź na „talk”/„report” z telefonu): cała wiadomość ze stanem jazdy.
    var onTalk: (([String: Any]) -> Void)?
    var onState: ((_ state: String, _ info: [String: Any]) -> Void)?
    /// Stan mostu do ekranu Czujniki – patrz status().
    var onStatus: (([String: Any]) -> Void)?

    private(set) var lastMessageAt = Date.distantPast
    private(set) var lastLive: GarminLive?
    /// Licznik nadaje (wiadomość w ostatnich 5 s) – wtedy może zastąpić czujniki Bluetooth telefonu.
    var isStreaming: Bool { Date().timeIntervalSince(lastMessageAt) < 5 }
    private var wasStreaming = false
    private var watch: Timer?

    /// available – SDK jest w aplikacji · paired – wybrano licznik · connected – licznik w zasięgu ·
    /// appInstalled – VeloIQ jest na liczniku (nil = jeszcze nie wiadomo) · streaming – płyną dane.
    func status() -> [String: Any] {
        var d = baseStatus()
        d["streaming"] = isStreaming
        if isStreaming, let l = lastLive {
            if let p = l.power { d["power"] = p }
            if let h = l.hr { d["hr"] = h }
            if let c = l.cadence { d["cadence"] = c }
            d["recording"] = l.second >= 0
        }
        return d
    }

    private func emitStatus() { onStatus?(status()) }

    /// Raz na sekundę pilnuje, czy dane nadal płyną – żeby ekran Czujniki sam pokazał zerwanie mostu.
    private func startWatch() {
        guard watch == nil else { return }
        watch = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            let now = self.isStreaming
            if now || now != self.wasStreaming { self.emitStatus() }
            self.wasStreaming = now
            if !now { self.watch?.invalidate(); self.watch = nil }
        }
    }

    #if canImport(ConnectIQ)
    private var device: IQDevice?
    private var app: IQApp?
    private var connected = false
    private var appInstalled: Bool?
    private var configured = false

    private func baseStatus() -> [String: Any] {
        var d: [String: Any] = ["available": true, "paired": device != nil, "connected": connected]
        if let n = device?.friendlyName ?? device?.modelName { d["name"] = n }
        if let i = appInstalled { d["appInstalled"] = i }
        return d
    }

    /// Raz przy starcie aplikacji (RideEnginePlugin.load()).
    func configure() {
        guard !configured else { return }
        configured = true
        ConnectIQ.sharedInstance().initialize(withUrlScheme: Self.urlScheme, uiOverrideDelegate: nil)
        if let data = UserDefaults.standard.data(forKey: Self.deviceKey),
           let dev = try? NSKeyedUnarchiver.unarchivedObject(ofClass: IQDevice.self, from: data) {
            attach(dev)
        }
        emitStatus()
    }

    /// Otwiera Garmin Connect z listą urządzeń; wynik wraca przez URL → handle(url:).
    func chooseDevice() {
        ConnectIQ.sharedInstance().showDeviceSelection()
    }

    /// Z SceneDelegate – true, gdy URL był odpowiedzią Garmin Connect (wtedy nie idzie dalej do Capacitora).
    @discardableResult
    func handle(url: URL) -> Bool {
        guard url.scheme == Self.urlScheme,
              let list = ConnectIQ.sharedInstance().parseDeviceSelectionResponse(from: url) as? [IQDevice],
              let dev = list.first(where: { ($0.modelName ?? "").lowercased().contains("edge") }) ?? list.first
        else { return false }
        if let data = try? NSKeyedArchiver.archivedData(withRootObject: dev, requiringSecureCoding: true) {
            UserDefaults.standard.set(data, forKey: Self.deviceKey)
        }
        attach(dev)
        return true
    }

    func forget() {
        if let a = app { ConnectIQ.sharedInstance().unregister(forAppMessages: a, delegate: self) }
        if let d = device { ConnectIQ.sharedInstance().unregister(forDeviceEvents: d, delegate: self) }
        device = nil; app = nil; connected = false; appInstalled = nil
        lastLive = nil; lastMessageAt = .distantPast
        UserDefaults.standard.removeObject(forKey: Self.deviceKey)
        emitStatus()
    }

    private func attach(_ dev: IQDevice) {
        if let a = app { ConnectIQ.sharedInstance().unregister(forAppMessages: a, delegate: self) }
        if let d = device { ConnectIQ.sharedInstance().unregister(forDeviceEvents: d, delegate: self) }
        device = dev
        let a = IQApp(uuid: Self.appUUID, store: UUID(), device: dev)
        app = a
        appInstalled = nil
        ConnectIQ.sharedInstance().register(forDeviceEvents: dev, delegate: self)
        ConnectIQ.sharedInstance().register(forAppMessages: a, delegate: self)
        connected = ConnectIQ.sharedInstance().getDeviceStatus(dev) == .connected
        refreshAppStatus()
        hello()
        emitStatus()
    }

    /// „Telefon ma most” – aplikacja na liczniku sama włącza nadawanie. Wiadomość trwała: jeśli VeloIQ na
    /// liczniku jest jeszcze zamknięty, Garmin dostarczy ją po otwarciu.
    func hello() {
        guard let a = app, connected, !isStreaming else { return }
        ConnectIQ.sharedInstance().sendMessage(["hello": 1], to: a, progress: nil, completion: { _ in }, isTransient: false)
    }

    private func refreshAppStatus() {
        guard let a = app else { return }
        ConnectIQ.sharedInstance().getAppStatus(a) { [weak self] st in
            DispatchQueue.main.async {
                self?.appInstalled = st?.isInstalled
                self?.emitStatus()
            }
        }
    }

    /// Polecenie albo tekst dla licznika. Komunikaty są małe i nietrwałe (isTransient) – stary tekst nie ma sensu po czasie.
    func send(_ message: [String: Any]) {
        guard let a = app, connected else { return }
        ConnectIQ.sharedInstance().sendMessage(message, to: a, progress: nil, completion: { _ in }, isTransient: true)
    }

    /// Prosi licznik o otwarcie aplikacji VeloIQ (licznik pyta użytkownika o zgodę).
    func openApp() {
        guard let a = app, connected else { return }
        ConnectIQ.sharedInstance().openAppRequest(a, completion: { [weak self] _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { self?.hello() }
        })
    }
    #else
    private func baseStatus() -> [String: Any] { ["available": false] }
    func configure() { emitStatus() }
    func chooseDevice() {}
    @discardableResult func handle(url: URL) -> Bool { false }
    func forget() {}
    func send(_ message: [String: Any]) {}
    func hello() {}
    func openApp() {}
    #endif

    func sendCommand(_ cmd: String) { send(["cmd": cmd]) }
    func sendEnzoAnswer(_ text: String) { send(["say": String(text.prefix(240))]) }

    /// Wspólna obsługa wiadomości z licznika (słownik z krótkimi kluczami).
    fileprivate func dispatch(_ message: Any) {
        guard let d = message as? [String: Any], let type = d["t"] as? String else { return }
        lastMessageAt = Date()
        if !wasStreaming { wasStreaming = true; emitStatus() }
        startWatch()
        switch type {
        case "live":
            if let v = d["v"] as? [Any], let live = GarminLive(v) { lastLive = live; onLive?(live) }
        case "cue":
            guard let key = d["k"] as? String else { return }
            var vars: [String: String] = [:]
            for (k, v) in (d["v"] as? [String: Any]) ?? [:] { vars[k] = "\(v)" }
            onCue?(key, (d["kind"] as? String) ?? "info", (d["x"] as? String) ?? "", vars)
        case "talk":
            onTalk?(d)
        case "state":
            onState?((d["s"] as? String) ?? "", d)
        default:
            break
        }
    }
}

#if canImport(ConnectIQ)
extension GarminLink: IQDeviceEventDelegate, IQAppMessageDelegate {
    func deviceStatusChanged(_ device: IQDevice!, status: IQDeviceStatus) {
        DispatchQueue.main.async {
            self.connected = status == .connected
            if self.connected { self.refreshAppStatus(); self.hello() }
            self.emitStatus()
        }
    }

    func receivedMessage(_ message: Any!, from app: IQApp!) {
        guard let m = message else { return }
        DispatchQueue.main.async { self.dispatch(m) }
    }
}
#endif
