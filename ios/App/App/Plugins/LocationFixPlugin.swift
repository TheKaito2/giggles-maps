import Capacitor
import CoreLocation

/// One fresh, accurate fix for a check-in, plus whether iOS says software faked it (sent as is_mock; the server
/// rejects those). The web geolocation API can't tell.
@objc(LocationFixPlugin)
public class LocationFixPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LocationFixPlugin"
    public let jsName = "LocationFix"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "current", returnType: CAPPluginReturnPromise)]
    private let manager = CLLocationManager()

    @objc func current(_ call: CAPPluginCall) {
        Task { @MainActor in
            if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
            if [.denied, .restricted].contains(manager.authorizationStatus) { return call.reject("denied") }
            let fix = await withTaskGroup(of: CLLocation?.self) { group -> CLLocation? in
                group.addTask {
                    var best: CLLocation?
                    do {
                        for try await update in CLLocationUpdate.liveUpdates(.otherNavigation) {
                            if #available(iOS 18, *), update.authorizationDenied { return nil }
                            guard let loc = update.location else { continue }
                            if best == nil || loc.horizontalAccuracy < best!.horizontalAccuracy { best = loc }
                            if loc.horizontalAccuracy <= 25 { return loc }   // good enough, stop early
                        }
                    } catch { }
                    return best
                }
                group.addTask { try? await Task.sleep(for: .seconds(15)); return nil }
                let first = await group.next() ?? nil
                group.cancelAll()
                return first
            }
            guard let fix else { return call.reject("timeout") }
            call.resolve(["lat": fix.coordinate.latitude, "lng": fix.coordinate.longitude, "accuracy": fix.horizontalAccuracy,
                          "isMock": fix.sourceInformation?.isSimulatedBySoftware ?? false])
        }
    }
}
