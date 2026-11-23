import UIKit
import Capacitor

/// Cykl życia oparty na scenach (UIScene) – od nowego SDK Xcode aplikacja bez niego w ogóle się nie
/// uruchamia („UIScene life cycle is required for apps built with this SDK”). Okno i ekran (Main.storyboard
/// → VeloIQBridgeViewController) tworzy UIKit z wpisu UIApplicationSceneManifest w Info.plist (setup-ios.sh).
/// Otwarcia linków przekazujemy do Capacitora tak jak wcześniej robił AppDelegate.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        for ctx in connectionOptions.urlContexts { open(ctx.url) }
        if let activity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for ctx in URLContexts { open(ctx.url) }
    }

    /// Powrót z Garmin Connect po wyborze licznika (veloiq://…) obsługuje most Garmina; reszta idzie do Capacitora.
    private func open(_ url: URL) {
        if GarminLink.shared.handle(url: url) { return }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}
