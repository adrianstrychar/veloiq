// VeloIQ – most telefon ↔ licznik Garmin Edge (Connect IQ Mobile SDK dla iOS).
//
// STAN: szkic do wpięcia w natywny plugin RideEngine – NIE jest jeszcze kopiowany do projektu iOS
// (mobile/setup-ios.sh bierze tylko mobile/ios-src/RideEngine/*.swift) i nie był kompilowany w Xcode.
// Kroki wpięcia: mobile/garmin-link/README.md.
//
// Co robi: odbiera z aplikacji VeloIQ na Edge (garmin/source/PhoneLink.mc)
//   { "t":"live",  "v":[s, moc, tętno, kadencja, prędkość×10, faza, krok, zostało, cel↓, cel↑, pauza] }  – 1 Hz, czujniki ANT+ licznika
//   { "t":"cue",   "k":klucz, "kind":rodzaj, "x":tekst, "v":{zmienne} }                                 – komunikat silnika → głos Enzo
//   { "t":"talk" }                                                                                      – przycisk ENZO na liczniku
//   { "t":"state", "s":"start|pause|resume|end", … }
// i wysyła do licznika { "cmd":"next|pause|resume|cancel|lap|eat|drink" } albo { "say":"tekst odpowiedzi Enzo" }.
//
// API SDK sprawdzone z nagłówkami github.com/garmin/connectiq-companion-app-sdk-ios (ConnectIQ.h, IQDevice.h, IQApp.h).

import Foundation
#if canImport(ConnectIQ)
import ConnectIQ
#endif

/// Jedna sekunda z licznika.
struct GarminLive {
    let second: Int
    let power: Int
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
        second = n[0]; power = n[1]
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

    // Wywołania zwrotne (główny wątek)
    var onLive: ((GarminLive) -> Void)?
    var onCue: ((_ key: String, _ kind: String, _ text: String, _ vars: [String: String]) -> Void)?
    var onTalk: (() -> Void)?
    var onState: ((_ state: String, _ info: [String: Any]) -> Void)?
    /// Stan mostu do UI: ["available": Bool, "paired": Bool, "name": String?, "connected": Bool, "appInstalled": Bool?]
    var onStatus: (([String: Any]) -> Void)?

    private(set) var lastMessageAt = Date.distantPast
    /// Licznik nadaje (dane w ostatnich 5 s) – wtedy może zastąpić czujniki Bluetooth telefonu.
    var isStreaming: Bool { Date().timeIntervalSince(lastMessageAt) < 5 }

    #if canImport(ConnectIQ)
    private var device: IQDevice?
    private var app: IQApp?
    private var connected = false
    private var appInstalled: Bool?

    /// Raz przy starcie aplikacji (RideEnginePlugin.load()).
    func configure() {
        ConnectIQ.sharedInstance().initialize(withUrlScheme: Self.urlScheme, uiOverrideDelegate: nil)
        if let data = UserDefaults.standard.data(forKey: Self.deviceKey),
           let dev = try? NSKeyedUnarchiver.unarchivedObject(ofClass: IQDevice.self, from: data) {
            attach(dev)
        }
        emitStatus()
    }

    /// Otwiera Garmin Connect z listą urządzeń; wynik wraca przez URL → handle(url:).
    func chooseDevice() {
        ConnectIQ.sharedInstance().showConnectIQDeviceSelection()
    }

    /// Z SceneDelegate.scene(_:openURLContexts:) – true, gdy URL był odpowiedzią Garmin Connect.
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
        UserDefaults.standard.removeObject(forKey: Self.deviceKey)
        emitStatus()
    }

    private func attach(_ dev: IQDevice) {
        device = dev
        let a = IQApp(uuid: Self.appUUID, store: UUID(), device: dev)
        app = a
        ConnectIQ.sharedInstance().register(forDeviceEvents: dev, delegate: self)
        ConnectIQ.sharedInstance().register(forAppMessages: a, delegate: self)
        connected = ConnectIQ.sharedInstance().getDeviceStatus(dev) == .connected
        refreshAppStatus()
        emitStatus()
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

    func sendCommand(_ cmd: String) { send(["cmd": cmd]) }
    func sendEnzoAnswer(_ text: String) { send(["say": String(text.prefix(240))]) }

    private func emitStatus() {
        var d: [String: Any] = ["available": true, "paired": device != nil, "connected": connected]
        if let n = device?.friendlyName ?? device?.modelName { d["name"] = n }
        if let i = appInstalled { d["appInstalled"] = i }
        d["streaming"] = isStreaming
        onStatus?(d)
    }
    #else
    // Bez pakietu ConnectIQ w projekcie most jest wyłączony, a reszta aplikacji kompiluje się bez zmian.
    func configure() { onStatus?(["available": false]) }
    func chooseDevice() {}
    @discardableResult func handle(url: URL) -> Bool { false }
    func forget() {}
    func send(_ message: [String: Any]) {}
    func sendCommand(_ cmd: String) {}
    func sendEnzoAnswer(_ text: String) {}
    #endif

    /// Wspólna obsługa wiadomości z licznika (słownik z krótkimi kluczami).
    fileprivate func dispatch(_ message: Any) {
        guard let d = message as? [String: Any], let type = d["t"] as? String else { return }
        lastMessageAt = Date()
        switch type {
        case "live":
            if let v = d["v"] as? [Any], let live = GarminLive(v) { onLive?(live) }
        case "cue":
            guard let key = d["k"] as? String else { return }
            var vars: [String: String] = [:]
            for (k, v) in (d["v"] as? [String: Any]) ?? [:] { vars[k] = "\(v)" }
            onCue?(key, (d["kind"] as? String) ?? "info", (d["x"] as? String) ?? "", vars)
        case "talk":
            onTalk?()
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
            if self.connected { self.refreshAppStatus() }
            self.emitStatus()
        }
    }

    func receivedMessage(_ message: Any!, from app: IQApp!) {
        guard let m = message else { return }
        DispatchQueue.main.async { self.dispatch(m) }
    }
}
#endif
