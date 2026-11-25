// VeloIQ – most telefon ↔ licznik Garmin Edge (Connect IQ Mobile SDK dla iOS).
//
// Czujniki są sparowane tylko z licznikiem (ANT+). Aplikacja VeloIQ na Edge (garmin/source/PhoneLink.mc) nadaje:
//   { "t":"live",  "v":[s, moc, tętno, kadencja, prędkość×10, faza, krok, zostało, cel↓, cel↑, pauza,
//                       moc 3 s, średnia kroku, falstart s, przeciąganie s, dystans m, sekundy kroku] }  – 1 Hz
//   { "t":"cue",   "k":klucz, "kind":rodzaj, "x":tekst, "v":{zmienne} }   – komunikat silnika → głos Enzo
//   { "t":"talk",  "st":{stan jazdy}, "q":gotowe pytanie?, "tk":token?, "b":adres serwera? }  – przycisk ENZO
//   { "t":"state", "s":"start|pause|resume|end|idle", "k":start jazdy, "st":[kroki planu], … }
//   { "t":"st",    "st":{stan jazdy} }   – co 30 s i na prośbę (pytania do Enzo z telefonu)
//   { "t":"hi",    "v":wersja aplikacji, "rec":0|1 }
// Telefon odsyła { "cmd":"next|pause|resume|cancel|lap|eat|drink|talk|report|sync|state" }, { "say":"odpowiedź" },
// { "hello":1 } (most jest – licznik włącza nadawanie) i co 10 s { "hb":1 } (aplikacja w telefonie działa).
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
    // od wersji 0.2.2 aplikacji na liczniku (starsza wysyła 11 pól)
    let pause: Int          // 0 jazda, 1 pauza ręczna, 2 postój (auto-pauza)
    let power3s: Int?
    let stepAvgPower: Int?
    let falseStartLeft: Int
    let overrunSec: Int
    let distanceM: Int?
    let stepElapsed: Int?

    init?(_ v: [Any]) {
        let n = v.compactMap { ($0 as? NSNumber)?.intValue }
        guard n.count >= 10, n.count == v.count else { return nil }
        second = n[0]
        power = n[1] >= 0 ? n[1] : nil
        hr = n[2] > 0 ? n[2] : nil
        cadence = n[3] >= 0 ? n[3] : nil
        speedKmh = n[4] >= 0 ? Double(n[4]) / 10.0 : nil
        phase = n[5]; stepIndex = n[6]; stepRemaining = n[7]; targetLow = n[8]; targetHigh = n[9]
        pause = n.count > 10 ? n[10] : 0
        let ext = n.count >= 17
        power3s = ext ? n[11] : nil
        stepAvgPower = ext ? n[12] : nil
        falseStartLeft = ext ? max(0, n[13]) : 0
        overrunSec = ext ? max(0, n[14]) : 0
        distanceM = ext ? n[15] : nil
        stepElapsed = ext ? n[16] : nil
    }
}

final class GarminLink: NSObject {
    static let shared = GarminLink()

    /// Identyfikator aplikacji VeloIQ na Edge – ten sam co w garmin/manifest.xml.
    static let appUUID = UUID(uuidString: "6f1d2c8e-4b7a-4d53-9a1e-5c0b7e2f9a41")!
    /// Identyfikator aplikacji w sklepie Connect IQ (wersja beta) – do otwarcia strony w sklepie.
    static let storeUUID = UUID(uuidString: "0f52168b-801a-4986-83e5-ea80cd653154")!
    /// Schemat URL aplikacji iOS, którym Garmin Connect wraca po wyborze urządzenia (CFBundleURLSchemes).
    static let urlScheme = "veloiq"
    private static let deviceKey = "veloiq.garmin.device"

    /// Wybrano licznik w Garmin Connect – wtedy telefon nie wysyła powiadomień „na licznik” (Smart Notifications):
    /// aplikacja VeloIQ na liczniku pokazuje to samo sama, a powiadomienia systemowe przykrywały jej ekran.
    /// Bezpieczne z każdego wątku.
    static var hasDevice: Bool { UserDefaults.standard.data(forKey: deviceKey) != nil }

    var onLive: ((GarminLive) -> Void)?
    var onCue: ((_ key: String, _ kind: String, _ text: String, _ vars: [String: String]) -> Void)?
    /// Przycisk ENZO na liczniku (albo odpowiedź na „talk”/„report” z telefonu): cała wiadomość ze stanem jazdy.
    var onTalk: (([String: Any]) -> Void)?
    var onState: ((_ state: String, _ info: [String: Any]) -> Void)?
    /// Pełny stan jazdy z licznika (co 30 s i na prośbę) – do pytań do Enzo.
    var onCoachState: (([String: Any]) -> Void)?
    /// Stan mostu do ekranu Czujniki – patrz status().
    var onStatus: (([String: Any]) -> Void)?
    /// Licznik wysłał jazdę do VeloIQ (klucz = start jazdy, epoch s).
    var onUpload: ((Int) -> Void)?
    /// Diagnostyka: ile próbek „live” przyszło od ostatniego wpisu i z jaką mocą.
    private var liveCount = 0
    private var liveSince = Date()

    private(set) var lastMessageAt = Date.distantPast
    private(set) var lastLive: GarminLive?
    /// Licznik nadaje (wiadomość w ostatnich 6 s) – wtedy może zastąpić czujniki Bluetooth telefonu.
    var isStreaming: Bool { Date().timeIntervalSince(lastMessageAt) < 6 }
    private var wasStreaming = false
    private var watch: Timer?
    private var lastHb = Date.distantPast
    private var lastHello = Date.distantPast
    private var lastSync = Date.distantPast
    private(set) var edgeVersion: String?

    // MARK: - Dziennik mostu (ekran Czujniki → „Diagnostyka”): ostatnie zdarzenia, żeby było widać, gdzie się rwie.
    private var log: [String] = []
    private var lastLogged: [String: Date] = [:]
    private static let clock: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm:ss"; return f }()
    /// Zapis do dziennika; `every` – ten sam wpis najwyżej raz na tyle sekund (błędy wysyłki co sekundę).
    func note(_ text: String, every: TimeInterval = 0) {
        let now = Date()
        if every > 0, let t = lastLogged[text], now.timeIntervalSince(t) < every { return }
        lastLogged[text] = now
        log.append("\(Self.clock.string(from: now)) \(text)")
        if log.count > 40 { log.removeFirst(log.count - 40) }
    }

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
        if let v = edgeVersion { d["edgeVersion"] = v }
        if lastMessageAt != .distantPast { d["lastMessageAgo"] = Int(Date().timeIntervalSince(lastMessageAt)) }
        d["log"] = Array(log.suffix(16))
        return d
    }

    private func emitStatus() { onStatus?(status()) }

    /// Raz na sekundę: pilnuje, czy dane nadal płyną (ekran Czujniki sam pokazuje zerwanie mostu) i co 10 s
    /// mówi licznikowi „aplikacja w telefonie działa” – bez tego przycisk ENZO na liczniku nie wie, że telefon słucha.
    private func startWatch() {
        guard watch == nil else { return }
        watch = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            let now = self.isStreaming
            if now != self.wasStreaming {
                self.note(now ? "licznik nadaje" : "licznik przestał nadawać")
            }
            if now || now != self.wasStreaming { self.emitStatus() }
            self.wasStreaming = now
            if now && Date().timeIntervalSince(self.lastHb) >= 10 {
                self.lastHb = Date()
                self.send(["hb": 1])
            }
            if !now { self.watch?.invalidate(); self.watch = nil }
        }
    }

    /// Prośba do licznika o pełny stan (np. aplikacja otwarta w trakcie jazdy) – najwyżej co 3 s.
    func requestSync() {
        guard Date().timeIntervalSince(lastSync) >= 3 else { return }
        lastSync = Date()
        send(["cmd": "sync"])
    }

    #if canImport(ConnectIQ)
    private var device: IQDevice?
    private var app: IQApp?
    private var connected = false
    private var appInstalled: Bool?
    private var configured = false
    /// SDK: „połączony” nie znaczy jeszcze, że usługi BLE licznika są odkryte – wiadomości wysłane wcześniej
    /// potrafią przepaść. Czekamy na deviceCharacteristicsDiscovered (z zapasem: po 3 s i tak próbujemy).
    private var ready = false
    private var helloRetries = 0
    /// Licznik potwierdził „hello” od czasu połączenia. Dopóki nie, ponawiamy bez limitu (co 4 s, potem co 10 s):
    /// pierwsza próba tuż po połączeniu zwykle kończy się Failure_DeviceNotAvailable, a bez udanego powitania
    /// licznik uważa, że telefon nie słucha.
    private var helloOK = false
    private var helloInFlight = false
    private var helloRetryScheduled = false

    private func baseStatus() -> [String: Any] {
        var d: [String: Any] = ["available": true, "paired": device != nil, "connected": connected, "greeted": helloOK]
        if let n = device?.friendlyName ?? device?.modelName { d["name"] = n }
        if let i = appInstalled { d["appInstalled"] = i }
        return d
    }

    /// Raz przy starcie aplikacji (RideEnginePlugin.load()). Identyfikator przywracania pozwala iOS obudzić
    /// aplikację w tle, gdy licznik zacznie nadawać (tryb „Uses Bluetooth LE accessories”).
    func configure() {
        guard !configured else { return }
        configured = true
        ConnectIQ.sharedInstance().initialize(withUrlScheme: Self.urlScheme, uiOverrideDelegate: nil,
                                              stateRestorationIdentifier: "veloiq.garmin.ciq")
        if let data = UserDefaults.standard.data(forKey: Self.deviceKey),
           let dev = try? NSKeyedUnarchiver.unarchivedObject(ofClass: IQDevice.self, from: data) {
            note("licznik z pamięci: \(dev.friendlyName ?? dev.modelName ?? "?")")
            attach(dev)
        } else {
            note("nie wybrano licznika")
        }
        emitStatus()
    }

    /// Otwiera Garmin Connect z listą urządzeń; wynik wraca przez URL → handle(url:).
    func chooseDevice() {
        note("otwieram Garmin Connect (wybór licznika)")
        ConnectIQ.sharedInstance().showDeviceSelection()
    }

    /// Z SceneDelegate – true, gdy URL był odpowiedzią Garmin Connect (wtedy nie idzie dalej do Capacitora).
    @discardableResult
    func handle(url: URL) -> Bool {
        guard url.scheme == Self.urlScheme else { return false }
        let list = (ConnectIQ.sharedInstance().parseDeviceSelectionResponse(from: url) as? [IQDevice]) ?? []
        guard let dev = list.first(where: { ($0.modelName ?? "").lowercased().contains("edge") }) ?? list.first else {
            // inne linki veloiq:// (logowanie) idą dalej do Capacitora; w dzienniku widać, że wrócił pusty wybór
            note("link \(url.host ?? "-"): bez licznika z Garmin Connect")
            emitStatus()
            return false
        }
        if let data = try? NSKeyedArchiver.archivedData(withRootObject: dev, requiringSecureCoding: true) {
            UserDefaults.standard.set(data, forKey: Self.deviceKey)
        }
        note("wybrano: \(dev.friendlyName ?? dev.modelName ?? "?") (\(list.count) urządz.)")
        attach(dev)
        return true
    }

    func forget() {
        if let a = app { ConnectIQ.sharedInstance().unregister(forAppMessages: a, delegate: self) }
        if let d = device { ConnectIQ.sharedInstance().unregister(forDeviceEvents: d, delegate: self) }
        device = nil; app = nil; connected = false; appInstalled = nil; edgeVersion = nil; helloOK = false
        lastLive = nil; lastMessageAt = .distantPast
        UserDefaults.standard.removeObject(forKey: Self.deviceKey)
        note("licznik usunięty")
        emitStatus()
    }

    private func attach(_ dev: IQDevice) {
        if let a = app { ConnectIQ.sharedInstance().unregister(forAppMessages: a, delegate: self) }
        if let d = device { ConnectIQ.sharedInstance().unregister(forDeviceEvents: d, delegate: self) }
        device = dev
        let a = IQApp(uuid: Self.appUUID, store: Self.storeUUID, device: dev)
        app = a
        appInstalled = nil
        // najpierw zdarzenia urządzenia, potem wiadomości aplikacji (kolejność z dokumentacji SDK)
        ConnectIQ.sharedInstance().register(forDeviceEvents: dev, delegate: self)
        ConnectIQ.sharedInstance().register(forAppMessages: a, delegate: self)
        connected = ConnectIQ.sharedInstance().getDeviceStatus(dev) == .connected
        ready = false
        helloOK = false
        helloRetries = 0
        note(connected ? "licznik połączony" : "licznik poza zasięgiem / wyłączony")
        if connected { greetWhenReady() } else { refreshAppStatus() }
        emitStatus()
    }

    /// „Telefon ma most” – aplikacja na liczniku sama włącza nadawanie i odsyła stan jazdy. Wiadomość trwała
    /// (licznik dostanie ją po otwarciu VeloIQ), dlatego najwyżej raz na minutę; w międzyczasie wystarczy „hb”.
    func hello(force: Bool = false) {
        guard let a = app, connected else { return }
        if !force && helloOK && Date().timeIntervalSince(lastHello) < 60 {
            requestSync()
            return
        }
        guard !helloInFlight else { return }
        helloInFlight = true
        lastHello = Date()
        ConnectIQ.sharedInstance().sendMessage(["hello": 1], to: a, progress: nil, completion: { [weak self] r in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.helloInFlight = false
                if r == .success {
                    if !self.helloOK || self.helloRetries > 0 { self.note("hello → licznik OK") }
                    self.helloOK = true
                    self.helloRetries = 0
                } else {
                    self.helloOK = false
                    self.note("hello → licznik: \(NSStringFromSendMessageResult(r) ?? "błąd")", every: 20)
                    self.scheduleHelloRetry()
                }
                self.emitStatus()
            }
        }, isTransient: false)
    }

    private func scheduleHelloRetry() {
        guard !helloRetryScheduled, connected else { return }
        helloRetryScheduled = true
        helloRetries += 1
        let delay: TimeInterval = helloRetries <= 5 ? 4 : 10
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self else { return }
            self.helloRetryScheduled = false
            if self.connected && !self.helloOK { self.hello(force: true) }
        }
    }

    /// Wiadomość z licznika, a powitanie jeszcze nie doszło – to dobry moment (łącze właśnie działa).
    fileprivate func helloIfNeeded() {
        guard !helloOK, Date().timeIntervalSince(lastHello) > 4 else { return }
        hello(force: true)
    }

    /// Wiadomość z licznika = licznik połączony. Status z SDK potrafi nie przyjść (licznik był połączony już przy
    /// wyborze w Garmin Connect) – bez tego telefon nic by nie wysyłał: ani „hello”, ani „hb”, ani poleceń.
    fileprivate func markConnected() {
        guard !connected, app != nil else { return }
        connected = true
        ready = true          // skoro licznik nadaje, usługi BLE są gotowe
        helloRetries = 0
        note("licznik połączony (przyszła wiadomość)")
        hello(force: true)
        emitStatus()
    }

    /// Licznik połączony: przywitanie, gdy usługi BLE są gotowe (albo po 3 s, gdyby SDK nie dało znać).
    private func greetWhenReady() {
        refreshAppStatus()
        if ready { hello(force: true); return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self = self, self.connected, !self.ready else { return }
            self.note("licznik: brak sygnału gotowości – witam mimo to")
            self.hello(force: true)
        }
    }

    private func refreshAppStatus() {
        guard let a = app else { return }
        ConnectIQ.sharedInstance().getAppStatus(a) { [weak self] st in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.appInstalled = st?.isInstalled
                if let st = st {
                    self.note(st.isInstalled ? "VeloIQ na liczniku: zainstalowana (wersja \(st.version))" : "VeloIQ na liczniku: brak aplikacji")
                } else {
                    self.note("VeloIQ na liczniku: brak odpowiedzi", every: 60)
                }
                self.emitStatus()
            }
        }
    }

    /// Polecenie albo tekst dla licznika. Komunikaty są małe i nietrwałe (isTransient) – stary tekst nie ma sensu po czasie.
    func send(_ message: [String: Any]) {
        guard let a = app, connected else { return }
        let what = (message["cmd"] as? String).map { "cmd \($0)" } ?? message.keys.sorted().joined(separator: ",")
        ConnectIQ.sharedInstance().sendMessage(message, to: a, progress: nil, completion: { [weak self] r in
            guard r != .success else { return }
            DispatchQueue.main.async {
                self?.note("\(what) → \(NSStringFromSendMessageResult(r) ?? "błąd")", every: 30)
            }
        }, isTransient: true)
    }

    /// Prosi licznik o otwarcie aplikacji VeloIQ (licznik pyta użytkownika o zgodę).
    func openApp() {
        guard let a = app, connected else { note("otwórz VeloIQ: licznik niepołączony"); emitStatus(); return }
        note("prośba: otwórz VeloIQ na liczniku")
        ConnectIQ.sharedInstance().openAppRequest(a, completion: { [weak self] r in
            DispatchQueue.main.async {
                self?.note("otwórz VeloIQ → \(NSStringFromSendMessageResult(r) ?? "?")")
                self?.emitStatus()
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { self?.hello(force: true) }
        })
    }
    #else
    private func baseStatus() -> [String: Any] { ["available": false] }
    func configure() { emitStatus() }
    func chooseDevice() {}
    @discardableResult func handle(url: URL) -> Bool { false }
    func forget() {}
    func send(_ message: [String: Any]) {}
    func hello(force: Bool = false) {}
    fileprivate func markConnected() {}
    fileprivate func helloIfNeeded() {}
    func openApp() {}
    #endif

    func sendCommand(_ cmd: String) { send(["cmd": cmd]) }
    func sendEnzoAnswer(_ text: String) { send(["say": String(text.prefix(240))]) }

    /// Wspólna obsługa wiadomości z licznika (słownik z krótkimi kluczami).
    fileprivate func dispatch(_ message: Any) {
        guard let d = message as? [String: Any], let type = d["t"] as? String else { return }
        if lastMessageAt == .distantPast || Date().timeIntervalSince(lastMessageAt) > 30 {
            note("pierwsza wiadomość z licznika (\(type))")
        }
        lastMessageAt = Date()
        markConnected()
        helloIfNeeded()
        if !wasStreaming { wasStreaming = true; emitStatus() }
        startWatch()
        switch type {
        case "live":
            guard let v = d["v"] as? [Any], let live = GarminLive(v) else {
                note("zła próbka z licznika (\((d["v"] as? [Any])?.count ?? -1) pól)", every: 30)
                return
            }
            lastLive = live
            liveCount += 1
            if Date().timeIntervalSince(liveSince) >= 30 {
                let rec = live.second >= 0 ? "jazda \(live.second) s" : "podgląd"
                note("z licznika: \(liveCount) próbek / \(Int(Date().timeIntervalSince(liveSince))) s · \(rec) · moc \(live.power.map { "\($0) W" } ?? "--") · HR \(live.hr.map { "\($0)" } ?? "--")")
                liveCount = 0; liveSince = Date()
            }
            onLive?(live)
        case "up":
            let k = (d["k"] as? NSNumber)?.intValue ?? 0
            note("licznik: jazda wysłana do VeloIQ")
            onUpload?(k)
        case "cue":
            guard let key = d["k"] as? String else { return }
            var vars: [String: String] = [:]
            for (k, v) in (d["v"] as? [String: Any]) ?? [:] { vars[k] = "\(v)" }
            onCue?(key, (d["kind"] as? String) ?? "info", (d["x"] as? String) ?? "", vars)
        case "talk":
            note("przycisk ENZO na liczniku")
            onTalk?(d)
        case "state":
            let s = (d["s"] as? String) ?? ""
            if s != "pause" && s != "resume" { note("jazda na liczniku: \(s)\((d["sync"] as? NSNumber) != nil ? " (sync)" : "")") }
            onState?(s, d)
        case "st":
            if let st = d["st"] as? [String: Any] { onCoachState?(st) }
        case "hi":
            edgeVersion = (d["v"] as? String) ?? edgeVersion
            note("licznik odpowiada: VeloIQ \(edgeVersion ?? "?")")
            emitStatus()
        default:
            break
        }
    }
}

#if canImport(ConnectIQ)
extension GarminLink: IQDeviceEventDelegate, IQAppMessageDelegate {
    func deviceStatusChanged(_ device: IQDevice!, status: IQDeviceStatus) {
        DispatchQueue.main.async {
            let was = self.connected
            self.connected = status == .connected
            if was != self.connected {
                let names = ["nieprawidłowe urządzenie", "Bluetooth niegotowy", "nie znaleziono", "niepołączony", "połączony"]
                let i = Int(status.rawValue)
                self.note("licznik: \(i >= 0 && i < names.count ? names[i] : "status \(i)")")
            }
            if !self.connected { self.ready = false; self.helloOK = false }
            if self.connected && !was { self.helloRetries = 0; self.greetWhenReady() }
            self.emitStatus()
        }
    }

    func deviceCharacteristicsDiscovered(_ device: IQDevice!) {
        DispatchQueue.main.async {
            let first = !self.ready
            self.ready = true
            if first {
                self.note("licznik gotowy do rozmowy")
                self.helloRetries = 0
                self.refreshAppStatus()
                self.hello(force: true)
            }
        }
    }

    func receivedMessage(_ message: Any!, from app: IQApp!) {
        guard let m = message else { return }
        DispatchQueue.main.async { self.dispatch(m) }
    }
}
#endif
