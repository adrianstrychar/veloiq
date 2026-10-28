import CoreBluetooth

/// Połączenie z pasem HR (0x180D) i pomiarem mocy (0x1818) przez Bluetooth LE.
/// - pamięta czujniki i łączy się z nimi automatycznie,
/// - po zgubieniu zasięgu iOS sam ponawia połączenie (pending connect nie wygasa),
/// - state restoration: iOS może wznowić aplikację, gdy czujnik się odezwie.
/// - pomiar dwustronny z osobnymi czujnikami (np. korby InPeak L + R): slot "power2" = druga strona,
///   moc = suma obu stron; gdy jedna milknie, druga ×2 (szacunek), balans z udziału lewej strony.
final class SensorManager: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {

    static let hrService = CBUUID(string: "180D")
    static let hrMeasurement = CBUUID(string: "2A37")
    static let cpService = CBUUID(string: "1818")
    static let cpMeasurement = CBUUID(string: "2A63")
    static let cpControlPoint = CBUUID(string: "2A66")

    private let savedHrKey = "veloiq.sensor.hr"
    private let savedPowerKey = "veloiq.sensor.power"
    private let savedPower2Key = "veloiq.sensor.power2"

    // Callbacki (wywoływane na kolejce BLE)
    var onFound: ((_ id: String, _ name: String, _ kind: String, _ rssi: Int) -> Void)?
    var onStatus: ((_ kind: String, _ id: String, _ name: String?, _ connected: Bool) -> Void)?
    var onHeartRate: ((BleParsers.HeartRate) -> Void)?
    var onPower: ((BleParsers.Power, Int?) -> Void)? // (moc, kadencja)
    var onLog: ((String) -> Void)?

    private let queue = DispatchQueue(label: "veloiq.ble")
    private var central: CBCentralManager!
    private var peripherals: [UUID: CBPeripheral] = [:]
    private var wanted: [String: UUID] = [:] // kind -> id
    private var scanning = false
    private var scanKinds: [String] = ["hr", "power"]
    private let cadence = CadenceCalculator()
    private let cadence2 = CadenceCalculator()
    private var controlPoint: CBCharacteristic?
    private var controlPoint2: CBCharacteristic?

    /// Ostatni odczyt każdej strony (tryb dwustronny).
    private struct Side { var watts: Int; var at: Date; var cadence: Int? }
    private var sides: [String: Side] = [:]
    private let sideFreshSec: TimeInterval = 2.5

    /// Ostatnie dane z każdego slotu – strażnik wykrywa „połączony, ale milczy”.
    private var lastData: [String: Date] = [:]
    private var resubscribedAt: [String: Date] = [:]
    private var linkedAt: [String: Date] = [:]   // od kiedy połączony (czy od tego czasu przyszły jakiekolwiek dane)
    private var watchdog: DispatchSourceTimer?

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: queue, options: [
            CBCentralManagerOptionRestoreIdentifierKey: "veloiq.ble.central",
            CBCentralManagerOptionShowPowerAlertKey: true,
        ])
        startWatchdog()
    }

    /// Co 5 s: zapamiętany czujnik, który nie jest połączony → połącz; połączony, ale bez danych
    /// > 12 s → ponowna subskrypcja; nadal cisza > 30 s → zerwij i połącz od nowa.
    /// (Typowy przypadek: następnego dnia iOS trzyma czujnik „połączony” na poziomie systemu,
    /// a aplikacja nie dostaje pomiarów – wcześniej pomagało tylko „zapomnij urządzenie”.)
    private func startWatchdog() {
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 5, repeating: 5)
        t.setEventHandler { [weak self] in self?.checkSensors() }
        t.resume()
        watchdog = t
    }

    private func checkSensors() {
        guard central.state == .poweredOn, !wanted.isEmpty else { return }
        let now = Date()
        for (k, id) in wanted {
            guard let p = peripherals[id] ?? central.retrievePeripherals(withIdentifiers: [id]).first else {
                if !central.isScanning { startScan() }   // system go nie zna – szukaj skanem
                continue
            }
            peripherals[id] = p
            p.delegate = self
            switch p.state {
            case .disconnected:
                central.connect(p, options: nil)
            case .connected:
                // pilnujemy tylko „połączony i ANI JEDNEGO pomiaru od połączenia” – czujnik, który
                // wysyłał i ucichł (postój, korby śpią), zostawiamy w spokoju
                if linkedAt[k] == nil { linkedAt[k] = now }
                let linked = linkedAt[k]!
                if let d = lastData[k], d >= linked { continue }
                let silent = now.timeIntervalSince(linked)
                let since = now.timeIntervalSince(resubscribedAt[k] ?? .distantPast)
                if silent > 30 && since > 25 && resubscribedAt[k] != nil {
                    onLog?("\(k): połączony bez danych – łączę od nowa")
                    resubscribedAt[k] = nil; linkedAt[k] = nil
                    central.cancelPeripheralConnection(p)   // didDisconnect połączy ponownie
                } else if silent > 12 && since > 12 {
                    resubscribedAt[k] = now
                    p.discoverServices([Self.hrService, Self.cpService])
                }
            default: break
            }
        }
    }

    var savedSensors: (hr: String?, power: String?, power2: String?) {
        let d = UserDefaults.standard
        return (d.string(forKey: savedHrKey), d.string(forKey: savedPowerKey), d.string(forKey: savedPower2Key))
    }

    // MARK: - API

    func scan(kinds: [String]) {
        queue.async {
            self.scanKinds = kinds.isEmpty ? ["hr", "power"] : kinds
            self.scanning = true
            if self.central.state == .poweredOn { self.startScan() }
        }
    }

    func stopScan() {
        queue.async { self.scanning = false; self.central.stopScan() }
    }

    /// `power2Id: ""` = usuń drugą stronę (powrót do jednego czujnika mocy).
    func connect(hrId: String?, powerId: String?, power2Id: String? = nil) {
        queue.async {
            func release(_ kind: String) {
                guard let old = self.wanted[kind] else { return }
                self.wanted[kind] = nil
                self.sides[kind] = nil
                if kind == "power" { self.cadence.reset(); self.controlPoint = nil }
                if kind == "power2" { self.cadence2.reset(); self.controlPoint2 = nil }
                // nie rozłączaj, jeśli to samo urządzenie zostaje w innym slocie
                if !self.wanted.values.contains(old), let p = self.peripherals[old] {
                    self.onStatus?(kind, old.uuidString, p.name, false)
                    self.central.cancelPeripheralConnection(p)
                }
            }
            func setWanted(_ kind: String, _ id: String?, _ key: String) {
                guard let s = id else { return }
                if s.isEmpty { release(kind); UserDefaults.standard.removeObject(forKey: key); return }
                guard let u = UUID(uuidString: s) else { return }
                if self.wanted[kind] == u { return }
                // zmiana czujnika: rozłącz poprzedni, żeby dwa urządzenia nie zasilały silnika
                release(kind)
                // to samo urządzenie nie może być w dwóch slotach (np. zamiana stron)
                for other in ["power", "power2"] where other != kind && self.wanted[other] == u {
                    self.wanted[other] = nil
                    self.sides[other] = nil
                    UserDefaults.standard.removeObject(forKey: other == "power" ? self.savedPowerKey : self.savedPower2Key)
                }
                self.wanted[kind] = u
                UserDefaults.standard.set(s, forKey: key)
            }
            setWanted("hr", hrId, self.savedHrKey)
            setWanted("power", powerId, self.savedPowerKey)
            setWanted("power2", power2Id, self.savedPower2Key)
            if self.central.state == .poweredOn { self.connectWanted() }
        }
    }

    func connectSaved() {
        let s = savedSensors
        connect(hrId: s.hr, powerId: s.power, power2Id: s.power2)
    }

    func disconnectAll() {
        queue.async {
            for (k, id) in self.wanted {
                self.onStatus?(k, id.uuidString, self.peripherals[id]?.name, false)
            }
            self.wanted.removeAll()
            self.cadence.reset()
            self.cadence2.reset()
            self.sides.removeAll()
            for p in self.peripherals.values { self.central.cancelPeripheralConnection(p) }
        }
    }

    /// Kalibracja zera (Cycling Power Control Point, opcode 0x0C "Start Offset Compensation").
    func zeroOffset() {
        queue.async {
            let cps = [self.controlPoint, self.controlPoint2].compactMap { $0 }
            if cps.isEmpty { self.onLog?("zeroOffset: brak control point (czujnik niepołączony?)"); return }
            for cp in cps {
                guard let p = cp.service?.peripheral else { continue }
                p.writeValue(Data([0x0C]), for: cp, type: .withResponse)
            }
        }
    }

    // MARK: - Wewnętrzne

    private func startScan() {
        var services: [CBUUID] = []
        if scanKinds.contains("hr") { services.append(Self.hrService) }
        if scanKinds.contains("power") { services.append(Self.cpService) }
        central.scanForPeripherals(withServices: services, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }

    private func connectWanted() {
        let ids = Array(Set(wanted.values))
        let known = central.retrievePeripherals(withIdentifiers: ids)
        // czujniki trzymane przez system (inna aplikacja, poprzednia sesja) – też je bierzemy
        let systemConnected = central.retrieveConnectedPeripherals(withServices: [Self.hrService, Self.cpService])
            .filter { ids.contains($0.identifier) }
        var all = known
        for p in systemConnected where !all.contains(where: { $0.identifier == p.identifier }) { all.append(p) }
        for p in all {
            peripherals[p.identifier] = p
            p.delegate = self
            if p.state == .connected {
                // połączony, ale ta instancja aplikacji nie subskrybuje pomiarów → odkryj usługi od nowa
                p.discoverServices([Self.hrService, Self.cpService])
                if let k = kind(of: p) { onStatus?(k, p.identifier.uuidString, p.name, true) }
            } else if p.state != .connecting {
                central.connect(p, options: nil)
            }
        }
        // czujnik nieznany systemowi (np. po reinstalacji) – znajdź go skanem
        if all.count < ids.count {
            scanKinds = ["hr", "power"]
            startScan()
        }
    }

    private func kind(of p: CBPeripheral) -> String? {
        wanted.first { $0.value == p.identifier }?.key
    }

    // MARK: - CBCentralManagerDelegate

    func centralManager(_ c: CBCentralManager, willRestoreState dict: [String: Any]) {
        if let restored = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] {
            for p in restored { peripherals[p.identifier] = p; p.delegate = self }
        }
        let s = savedSensors
        if let h = s.hr, let u = UUID(uuidString: h) { wanted["hr"] = u }
        if let pw = s.power, let u = UUID(uuidString: pw) { wanted["power"] = u }
        if let p2 = s.power2, let u = UUID(uuidString: p2) { wanted["power2"] = u }
    }

    func centralManagerDidUpdateState(_ c: CBCentralManager) {
        onLog?("BLE state: \(c.state.rawValue)")
        guard c.state == .poweredOn else { return }
        if scanning { startScan() }
        if !wanted.isEmpty { connectWanted() }
        for p in peripherals.values where p.state == .connected {
            p.discoverServices([Self.hrService, Self.cpService])
            if let k = kind(of: p) { onStatus?(k, p.identifier.uuidString, p.name, true) }
        }
    }

    func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral,
                        advertisementData ad: [String: Any], rssi: NSNumber) {
        let uuids = (ad[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID]) ?? []
        let k: String = uuids.contains(Self.cpService) ? "power" : (uuids.contains(Self.hrService) ? "hr" : "unknown")
        let name = p.name ?? (ad[CBAdvertisementDataLocalNameKey] as? String) ?? "Czujnik"
        peripherals[p.identifier] = p
        if scanning { onFound?(p.identifier.uuidString, name, k, rssi.intValue) }
        // auto-połączenie zapamiętanego czujnika znalezionego skanem
        if wanted.values.contains(p.identifier) && p.state == .disconnected {
            p.delegate = self
            c.connect(p, options: nil)
        }
    }

    func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
        p.delegate = self
        p.discoverServices([Self.hrService, Self.cpService])
        if let k = kind(of: p) { linkedAt[k] = Date(); onStatus?(k, p.identifier.uuidString, p.name, true) }
        if !scanning && wanted.values.allSatisfy({ peripherals[$0]?.state == .connected }) { c.stopScan() }
    }

    func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        onLog?("connect failed: \(error?.localizedDescription ?? "?")")
        if wanted.values.contains(p.identifier) {
            queue.asyncAfter(deadline: .now() + 2) { [weak self] in
                guard let self = self, self.wanted.values.contains(p.identifier) else { return }
                c.connect(p, options: nil)
            }
        }
    }

    func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        if let k = kind(of: p) {
            onStatus?(k, p.identifier.uuidString, p.name, false)
            if k == "power" { controlPoint = nil; cadence.reset() }
            if k == "power2" { controlPoint2 = nil; cadence2.reset() }
            sides[k] = nil
            c.connect(p, options: nil) // iOS będzie czekał, aż czujnik wróci w zasięg
        }
    }

    // MARK: - Pomiar dwustronny

    /// Strona z nazwy czujnika: "POWERCRANK L.44265" → L, "… R.42549" → R. nil = nie wiadomo.
    private func side(of kind: String) -> Character? {
        guard let id = wanted[kind], let name = peripherals[id]?.name?.uppercased() else { return nil }
        if name.range(of: #"(^|[^A-Z])L([^A-Z]|$)"#, options: .regularExpression) != nil { return "L" }
        if name.range(of: #"(^|[^A-Z])R([^A-Z]|$)"#, options: .regularExpression) != nil { return "R" }
        return nil
    }

    /// Emituje sumę obu stron. Wyzwalaczem jest strona główna; druga tylko wtedy, gdy główna milczy.
    private func emitDual(trigger: String) {
        let now = Date()
        func fresh(_ k: String) -> Side? {
            guard let s = sides[k], now.timeIntervalSince(s.at) < sideFreshSec else { return nil }
            return s
        }
        let a = fresh("power"), b = fresh("power2")
        guard trigger == "power" || a == nil else { return }
        var watts = 0
        var balanceL: Double?
        if let a = a, let b = b {
            watts = a.watts + b.watts
            let sa = side(of: "power"), sb = side(of: "power2")
            let left: Int? = sa == "L" ? a.watts : sb == "L" ? b.watts : sa == "R" ? b.watts : sb == "R" ? a.watts : nil
            if let l = left, watts > 0 { balanceL = Double(l) / Double(watts) * 100 }
        } else if let one = a ?? b {
            watts = one.watts * 2 // druga strona chwilowo milczy – szacunek
        }
        let cad = a?.cadence ?? b?.cadence
        onPower?(BleParsers.Power(watts: watts, crankRevs: nil, crankTime: nil, balanceL: balanceL), cad)
    }

    // MARK: - CBPeripheralDelegate

    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        for s in p.services ?? [] {
            if s.uuid == Self.hrService { p.discoverCharacteristics([Self.hrMeasurement], for: s) }
            if s.uuid == Self.cpService { p.discoverCharacteristics([Self.cpMeasurement, Self.cpControlPoint], for: s) }
        }
    }

    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
        for ch in s.characteristics ?? [] {
            switch ch.uuid {
            case Self.hrMeasurement, Self.cpMeasurement:
                p.setNotifyValue(true, for: ch)
            case Self.cpControlPoint:
                if kind(of: p) == "power2" { controlPoint2 = ch } else { controlPoint = ch }
                p.setNotifyValue(true, for: ch) // control point wymaga indications dla odpowiedzi
            default: break
            }
        }
    }

    func peripheral(_ p: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
        guard let data = ch.value, let k = kind(of: p) else { return }
        if ch.uuid != Self.cpControlPoint { lastData[k] = Date(); resubscribedAt[k] = nil }
        switch ch.uuid {
        case Self.hrMeasurement:
            if let hr = BleParsers.heartRate(data) { onHeartRate?(hr) }
        case Self.cpMeasurement:
            if let pw = BleParsers.cyclingPower(data) {
                var cad: Int?
                let calc = k == "power2" ? cadence2 : cadence
                if let r = pw.crankRevs, let t = pw.crankTime { cad = calc.update(revs: r, time: t) }
                if wanted["power2"] == nil {
                    onPower?(pw, cad) // jeden czujnik – jak dotąd
                } else {
                    sides[k] = Side(watts: pw.watts, at: Date(), cadence: cad ?? sides[k]?.cadence)
                    emitDual(trigger: k)
                }
            }
        case Self.cpControlPoint:
            // odpowiedź: 0x20, opcode, wynik (0x01 = sukces), [offset]
            let b = [UInt8](data)
            if b.count >= 3 && b[0] == 0x20 && b[1] == 0x0C {
                onLog?(b[2] == 0x01 ? "Kalibracja OK" : "Kalibracja nieudana (kod \(b[2]))")
            }
        default: break
        }
    }
}
