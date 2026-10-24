import Capacitor
import UIKit

/// The web app's view controller: registers our own plugins (App/Plugins) next to the npm ones.
class GigglesViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AttestPlugin())
        bridge?.registerPluginInstance(PurchasesPlugin())
        bridge?.registerPluginInstance(LocationFixPlugin())
        bridge?.registerPluginInstance(TripPlugin())
    }
}
