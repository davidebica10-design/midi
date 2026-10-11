// Con CarPlay l'app usa le «scene»: questa è la scena della finestra principale (la storyboard di Capacitor).
// Info.plist → UIApplicationSceneManifest: vedi README.md (passo 5).
import UIKit
import Capacitor

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    // link «tempo://…» (widget, Live Activity) e universal link: li passa a Capacitor come faceva l'AppDelegate
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for ctx in URLContexts { _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: ctx.url, options: [:]) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity) { _ in }
    }
}
