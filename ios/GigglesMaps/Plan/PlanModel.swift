import CoreLocation
import Foundation
import Observation

@MainActor
@Observable
final class PlanModel {
    enum Picking { case origin, dest }

    // Real places from the seed: Phu Phan Museum -> Wat Phra That Choeng Chum
    var origin: LatLng? = LatLng(lat: 17.17313, lng: 104.14488) { didSet { plan = nil } }
    var dest: LatLng? = LatLng(lat: 17.16445, lng: 104.15345) { didSet { plan = nil } }
    var picking: Picking?
    var leaveAt: Date = PlanModel.defaultLeave() { didSet { plan = nil } }
    var budget: Double = 45 { didSet { plan = nil } }
    var mode: TravelMode = .pedestrian { didSet { plan = nil } }
    // "What draws you in?" and "Make it your kind of detour"; any change drops the old plan, like the trip fields
    var interests: Set<Interest> = [] { didSet { plan = nil } }
    var minRating: Double = 4 { didSet { plan = nil } }       // 0 = any
    var maxPrice: Int? { didSet { plan = nil } }              // nil = any
    var maxStops: Int? { didSet { plan = nil } }              // nil = auto
    var includeUnrated = false { didSet { plan = nil } }

    func reset() {
        (budget, mode, interests, minRating, maxPrice, maxStops, includeUnrated) = (45, .pedestrian, [], 4, nil, nil, false)
        leaveAt = Self.defaultLeave()
    }

    var plan: RoutePlan? { didSet { choice = plan?.plans?.first?.id } }
    var choice: String?          // the themed plan the user picked
    /// the route on screen: the picked themed plan, or the plain response from an older server
    var shown: RoutePlan? { plan?.choosing(choice) }
    var busy = false
    var error: String?

    func pick(_ coordinate: CLLocationCoordinate2D) {
        switch picking {
        case .origin: origin = LatLng(coordinate)
        case .dest: dest = LatLng(coordinate)
        case nil: return
        }
        picking = nil
    }

    func useMyLocation() async {
        do { origin = LatLng(try await LocationFix.current(timeout: .seconds(10)).coordinate) }
        catch { self.error = String(localized: "Location is blocked. Tap the map to set your start instead.") }
    }

    func submit() async {
        guard let origin, let dest else { return }
        busy = true; error = nil
        defer { busy = false }
        let parts = Calendar.current.dateComponents([.hour, .minute], from: leaveAt)
        do {
            plan = try await Backend.planRoute(PlanRequest(
                origin: origin, dest: dest, startMin: (parts.hour ?? 0) * 60 + (parts.minute ?? 0), budgetMin: Int(budget), mode: mode,
                interests: interests.isEmpty ? nil : Interest.allCases.filter(interests.contains),
                minRating: minRating == 4 ? nil : minRating, includeUnrated: includeUnrated ? true : nil,
                maxStops: maxStops, maxPrice: maxPrice))
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? String(localized: "Couldn't plan the route. Try again in a moment.")
        }
    }

    /// now, but not before 09:00 (most places are closed earlier)
    static func defaultLeave() -> Date {
        let now = Date()
        let nine = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: now) ?? now
        return max(now, nine)
    }
}
