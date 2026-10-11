// Il controller principale di Capacitor con il plugin locale TempoBridge registrato.
// In Main.storyboard imposta la classe del Bridge View Controller su «MainViewController» (modulo App).
import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TempoBridgePlugin())
    }
}
