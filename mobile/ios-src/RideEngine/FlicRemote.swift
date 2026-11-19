import Foundation
import flic2lib

/// Przycisk Flic 2 na kierownicy – sterowanie jazdą bez dotykania telefonu.
///   klik       → rozmowa z Enzo („Słucham!”),
///   2× klik    → okrążenie (jazda swobodna) / następny krok (trening z planem),
///   przytrzymaj → raport Enzo (średnia moc, tętno, co teraz).
/// Oficjalne SDK flic2lib (Shortcut Labs): przycisk łączy się bezpośrednio z VeloIQ (Bluetooth LE, także
/// w tle i przy zablokowanym ekranie), aplikacja Flic nie jest potrzebna. Muzyka (Spotify) gra dalej –
/// w przeciwieństwie do przycisków słuchawek, które wymagały przejęcia odtwarzania.
/// Wszystkie callbacki na głównym wątku.
final class FlicRemote: NSObject, FLICManagerDelegate, FLICButtonDelegate {
    static let shared = FlicRemote()

    /// "click" | "double" | "hold"
    var onPress: ((String) -> Void)?
    /// stan do ekranu Czujniki (połączony, bateria, parowanie)
    var onStatus: (([String: Any]) -> Void)?

    private var configured = false
    private var restored = false
    private var scanPhase: String?

    func configure() {
        guard !configured else { return }
        configured = true
        FLICManager.configure(with: self, buttonDelegate: self, background: true)
    }

    private var manager: FLICManager? { FLICManager.shared() }
    private var buttons: [FLICButton] { restored ? (manager?.buttons() ?? []) : [] }

    func status() -> [String: Any] {
        var d: [String: Any] = [
            "available": true,
            "bluetoothOn": manager?.state == .poweredOn,
            "scanning": manager?.isScanning ?? false,
            "paired": !buttons.isEmpty,
        ]
        if let p = scanPhase { d["scanPhase"] = p }
        if let b = buttons.first {
            d["name"] = b.nickname ?? b.name ?? "Flic"
            d["connected"] = b.state == .connected
            d["ready"] = b.isReady
            if b.batteryVoltage > 0 { d["battery"] = Self.batteryPct(b.batteryVoltage) }
        }
        return d
    }

    /// CR2032: ~3,0 V pełna, ~2,65 V do wymiany.
    private static func batteryPct(_ v: Float) -> Int {
        Int((max(0, min(1, (v - 2.65) / 0.35)) * 100).rounded())
    }

    private func emit() { onStatus?(status()) }

    /// Parowanie: przycisk musi być w trybie publicznym (przytrzymany ok. 7 s, aż zacznie migać).
    func scan(_ done: @escaping (_ ok: Bool, _ error: String?) -> Void) {
        guard let m = manager else { done(false, "Przycisk Flic nie jest gotowy – uruchom aplikację ponownie."); return }
        if m.isScanning { m.stopScan() }
        scanPhase = "searching"; emit()
        m.scanForButtons(stateChangeHandler: { [weak self] event in
            switch event {
            case .discovered: self?.scanPhase = "discovered"
            case .connected: self?.scanPhase = "connecting"
            case .verified: self?.scanPhase = "verified"
            case .verificationFailed: self?.scanPhase = "failed"
            @unknown default: break
            }
            self?.emit()
        }, completion: { [weak self] button, error in
            guard let self = self else { return }
            self.scanPhase = nil
            if let b = button {
                b.triggerMode = .clickAndDoubleClickAndHold
                b.connect()
                // jeden przycisk na raz – starsze sparowane zapominamy
                for old in self.buttons where old.identifier != b.identifier { m.forgetButton(old) { _, _ in } }
                self.emit()
                done(true, nil)
            } else {
                self.emit()
                done(false, Self.scanErrorText(error))
            }
        })
    }

    func stopScan() { manager?.stopScan() }

    func forget(_ done: @escaping () -> Void) {
        guard let m = manager else { done(); return }
        let list = buttons
        if list.isEmpty { done(); return }
        var left = list.count
        for b in list {
            m.forgetButton(b) { [weak self] _, _ in
                left -= 1
                if left == 0 { self?.emit(); done() }
            }
        }
    }

    private static func scanErrorText(_ error: Error?) -> String {
        guard let e = error as NSError? else { return "Nie udało się połączyć z przyciskiem." }
        // kody FLICButtonScannerErrorCode (kolejność z FLICEnums.h)
        switch e.code {
        case 1: return "Włącz Bluetooth w telefonie."
        case 2, 19: return "Nie widzę przycisku. Przytrzymaj Flic ok. 7 sekund, aż zacznie migać, i spróbuj jeszcze raz."
        case 3: return "Przycisk był wcześniej sparowany z tym telefonem. Usuń go w Ustawienia → Bluetooth (Flic → Zapomnij) i spróbuj ponownie."
        case 4, 7: return "Parowanie anulowane."
        case 10: return "Przycisk jest połączony z innym telefonem – najpierw go tam usuń."
        case 11: return "Przycisk ma już za dużo połączonych aplikacji – usuń go z jednej z nich (np. z aplikacji Flic)."
        case 15, 16: return "Przycisk przestał odpowiadać. Podejdź bliżej i spróbuj jeszcze raz."
        default: return "Nie udało się połączyć z przyciskiem (\(e.code))."
        }
    }

    // MARK: - FLICManagerDelegate

    func managerDidRestoreState(_ manager: FLICManager) {
        restored = true
        for b in manager.buttons() {
            b.triggerMode = .clickAndDoubleClickAndHold
            b.connect()
        }
        emit()
    }

    func manager(_ manager: FLICManager, didUpdate state: FLICManagerState) { emit() }

    // MARK: - FLICButtonDelegate

    func buttonDidConnect(_ button: FLICButton) { emit() }

    func buttonIsReady(_ button: FLICButton) {
        if button.triggerMode != .clickAndDoubleClickAndHold { button.triggerMode = .clickAndDoubleClickAndHold }
        emit()
    }

    func button(_ button: FLICButton, didDisconnectWithError error: Error?) { emit() }

    func button(_ button: FLICButton, didFailToConnectWithError error: Error?) { emit() }

    func button(_ button: FLICButton, didUpdateBatteryVoltage voltage: Float) { emit() }

    func button(_ button: FLICButton, didUnpairWithError error: Error?) {
        manager?.forgetButton(button) { [weak self] _, _ in self?.emit() }
    }

    /// Wszystkie zdarzenia przycisku; bierzemy klasę „klik / 2× klik / przytrzymanie” (jak w przykładzie SDK).
    /// Wciśnięcia sprzed (ponownego) połączenia starsze niż 3 s pomijamy – akcja z opóźnieniem byłaby myląca.
    func button(_ button: FLICButton, didReceive buttonEvent: FLICButtonEvent) {
        if buttonEvent.wasQueued && buttonEvent.age > 3 { return }
        buttonEvent.isSingleOrDoubleClickOrHold { type, _ in
            let kind: String? = type == .singleClick ? "click" : type == .doubleClick ? "double" : type == .hold ? "hold" : nil
            guard let k = kind else { return }
            DispatchQueue.main.async { self.onPress?(k) }
        }
    }
}
