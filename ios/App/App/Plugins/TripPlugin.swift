import ActivityKit
import Capacitor
import CoreLocation
import UserNotifications

/// A running trip: a Live Activity on the Lock Screen / Dynamic Island, and "You're at <stop>. Check in?" when the
/// phone (even locked, in a pocket) comes within 100 m of a stop. Started and ended by the web navigation screen.
/// ponytail: CLMonitor asserted on creation in iOS 26 (Apple forum 802143), so distances are compared here; fine for
/// a trip of a few stops and an hour or two of GPS.
@objc(TripPlugin)
public class TripPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TripPlugin"
    public let jsName = "Trip"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkedIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]
    struct Stop { let id: Int; let name: String; let lat: Double; let lng: Double; let eta: Date? }
    private var stops: [Stop] = []
    private var done: Set<Int> = []
    private var notified: Set<Int> = []
    private var activityId: String?
    private var watch: Task<Void, Never>?
    private let location = CLLocationManager()

    @objc func start(_ call: CAPPluginCall) {
        let destination = call.getString("destination") ?? ""
        let list = (call.getArray("stops") as? [[String: Any]] ?? []).compactMap { s -> Stop? in
            guard let id = s["id"] as? Int, let name = s["name"] as? String, let lat = s["lat"] as? Double, let lng = s["lng"] as? Double else { return nil }
            return Stop(id: id, name: name, lat: lat, lng: lng, eta: (s["eta"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) })
        }
        Task { @MainActor in
            await stopAll()
            stops = list; done = []
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
            location.requestAlwaysAuthorization()
            if ActivityAuthorizationInfo().areActivitiesEnabled {
                activityId = try? Activity.request(attributes: TripAttributes(destination: destination), content: .init(state: state(), staleDate: nil)).id
            }
            watchStops()
            call.resolve()
        }
    }

    @objc func checkedIn(_ call: CAPPluginCall) {
        let placeId = call.getInt("placeId") ?? -1
        Task { @MainActor in
            guard stops.contains(where: { $0.id == placeId }) else { return call.resolve() }
            done.insert(placeId)
            let state = state(), finished = done.count == stops.count, id = activityId
            for activity in Activity<TripAttributes>.activities where activity.id == id {
                if finished { await activity.end(.init(state: state, staleDate: nil), dismissalPolicy: .after(.now + 15 * 60)) }
                else { await activity.update(.init(state: state, staleDate: nil)) }
            }
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) { Task { @MainActor in await stopAll(); call.resolve() } }

    @MainActor private func stopAll() async {
        watch?.cancel(); watch = nil; notified = []
        for activity in Activity<TripAttributes>.activities { await activity.end(nil, dismissalPolicy: .immediate) }
        activityId = nil
    }

    @MainActor private func state() -> TripAttributes.ContentState {
        let next = stops.first { !done.contains($0.id) }
        return .init(nextStop: next?.name, nextEta: next?.eta, stopsDone: done.count, stopsTotal: stops.count)
    }

    @MainActor private func watchStops() {
        watch = Task { @MainActor [weak self] in
            let background = CLBackgroundActivitySession()   // keeps updates coming with the phone locked
            defer { background.invalidate() }
            do {
                for try await update in CLLocationUpdate.liveUpdates(.fitness) {
                    guard let self, let here = update.location else { continue }
                    for stop in self.stops where !self.done.contains(stop.id) && !self.notified.contains(stop.id) {
                        if here.distance(from: CLLocation(latitude: stop.lat, longitude: stop.lng)) <= 100 {
                            self.notified.insert(stop.id)
                            Self.notify(stop)
                        }
                    }
                }
            } catch { /* updates stopped */ }
        }
    }

    private static func notify(_ stop: Stop) {
        let content = UNMutableNotificationContent()
        content.title = "You're at \(stop.name)"
        content.body = "Check in to collect your stamp."
        content.sound = .default
        content.userInfo = ["place_id": stop.id]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "arrive-\(stop.id)", content: content, trigger: nil))
    }
}
