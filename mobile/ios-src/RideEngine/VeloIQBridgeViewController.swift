import UIKit
import Capacitor

/// Rejestracja lokalnego pluginu (Capacitor 6/7). W Main.storyboard ustaw tę klasę
/// jako Custom Class dla "Bridge View Controller" (Module: App).
class VeloIQBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(RideEnginePlugin())
    }
}
