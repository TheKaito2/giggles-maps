import ActivityKit
import CoreLocation
import Foundation
import Observation
import UserNotifications

/// A running trip: Live Activity on the Lock Screen / Dynamic Island, plus live location (kept alive in the
/// background by CLBackgroundActivitySession) that posts "You're at <stop>. Check in?" within 100 m of a stop.
/// ponytail: CLMonitor asserted on creation in iOS 26 (Apple forum 802143), so we compare distances ourselves;
/// fine for a trip of a few stops and an hour or two of GPS.
@MainActor
@Observable
final class TripModel {
    static let shared = TripModel()

    private(set) var running = false
    private(set) var done: Set<Int> = []
    private var stops: [RouteStop] = []
    private var activityId: String?
    private var watch: Task<Void, Never>?
    private var notified: Set<Int> = []
    private let location = CLLocationManager()

    func start(_ plan: RoutePlan, destination: String) async {
        await end()
        stops = plan.stops
        done = []
        running = true

        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        location.requestAlwaysAuthorization()   // geofence alerts while the phone is in a pocket
        if ActivityAuthorizationInfo().areActivitiesEnabled {
            activityId = try? Activity.request(attributes: TripAttributes(destination: destination),
                                               content: .init(state: state(), staleDate: nil)).id
        }
        await watchStops()
    }

    /// Called after every check-in; a rewarded or not-rewarded check-in both count as "been there".
    func checkedIn(placeId: Int) async {
        guard running, stops.contains(where: { $0.id == placeId }) else { return }
        done.insert(placeId)
        let state = state(), finished = done.count == stops.count, id = activityId
        await Task.detached {
            for activity in Activity<TripAttributes>.activities where activity.id == id {
                if finished { await activity.end(.init(state: state, staleDate: nil), dismissalPolicy: .after(.now + 15 * 60)) }
                else { await activity.update(.init(state: state, staleDate: nil)) }
            }
        }.value
    }

    func end() async {
        watch?.cancel()
        watch = nil
        notified = []
        await Task.detached { for activity in Activity<TripAttributes>.activities { await activity.end(nil, dismissalPolicy: .immediate) } }.value
        activityId = nil
        running = false
    }

    private func state() -> TripAttributes.ContentState {
        let next = stops.first { !done.contains($0.id) }
        let eta = next.map { Calendar.current.startOfDay(for: .now).addingTimeInterval(TimeInterval($0.etaMin * 60)) }
        return .init(nextStop: next?.name, nextEta: eta, stopsDone: done.count, stopsTotal: stops.count)
    }

    private func watchStops() async {
        watch = Task { [weak self] in
            let background = CLBackgroundActivitySession()   // keeps updates coming with the phone locked
            defer { background.invalidate() }
            do {
                for try await update in CLLocationUpdate.liveUpdates(.fitness) {
                    guard let self, let here = update.location else { continue }
                    for stop in self.stops where !self.done.contains(stop.id) && !self.notified.contains(stop.id) {
                        let there = CLLocation(latitude: stop.lat, longitude: stop.lng)
                        if here.distance(from: there) <= 100 {
                            self.notified.insert(stop.id)
                            Self.notify(stop)
                        }
                    }
                }
            } catch { /* updates stopped */ }
        }
    }

    private static func notify(_ stop: RouteStop) {
        let content = UNMutableNotificationContent()
        content.title = String(localized: "You're at \(stop.name)")
        content.body = String(localized: "Check in to collect your stamp.")
        content.sound = .default
        content.userInfo = ["place_id": stop.id]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "arrive-\(stop.id)", content: content, trigger: nil))
    }
}
