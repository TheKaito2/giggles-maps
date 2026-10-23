import CoreLocation
import Foundation

// DTOs for the backend contract in docs/API.md. JSON keys are snake_case; Swift names are camelCase.

struct LatLng: Codable, Equatable, Sendable {
    var lat: Double
    var lng: Double
    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
    init(lat: Double, lng: Double) { self.lat = lat; self.lng = lng }
    init(_ c: CLLocationCoordinate2D) { lat = c.latitude; lng = c.longitude }
}

enum TravelMode: String, Codable, Sendable { case pedestrian, auto }

struct PlanRequest: Encodable, Sendable {
    var origin: LatLng
    var dest: LatLng
    var startMin: Int
    var budgetMin: Int
    var mode: TravelMode
    enum CodingKeys: String, CodingKey { case origin, dest, mode, startMin = "start_min", budgetMin = "budget_min" }
}

struct RouteStop: Decodable, Identifiable, Equatable, Sendable {
    let id: Int
    let name: String
    let nameTh: String?
    let category: String
    let lat: Double
    let lng: Double
    let isPartner: Bool          // a signed-up shop (ranking never depends on it)
    let isDemo: Bool
    let rating: Double
    let dwellMin: Int
    let etaMin: Int
    let nearbyPartner: NearbyPartner?   // "Near this spot" card under nature/temple stops
    let minLevel: Int?           // v4: > 0 = exclusive place, only on routes once a member reaches this level
    let exclusiveKind: String?   // gem | perk | event
    let perkText: String?
    let meal: String?            // engine v2: breakfast | lunch | dinner when this stop covers a meal
    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
    enum CodingKeys: String, CodingKey {
        case id, name, category, lat, lng, rating, meal
        case nameTh = "name_th", isPartner = "is_partner", isDemo = "is_demo"
        case dwellMin = "dwell_min", etaMin = "eta_min", nearbyPartner = "nearby_partner"
        case minLevel = "min_level", exclusiveKind = "exclusive_kind", perkText = "perk_text"
    }
}

/// Anything the user can check in at: a route stop, a "Near this spot" card, or a scanned shop sticker.
struct CheckinTarget: Decodable, Identifiable, Equatable, Sendable {
    let id: Int
    let name: String
    let lat: Double
    let lng: Double
    let isPartner: Bool
    let isDemo: Bool
    var qrCode: String? = nil      // pre-filled from a scanned sticker
    enum CodingKeys: String, CodingKey { case id, name, lat, lng, isPartner = "is_partner", isDemo = "is_demo" }

    init(id: Int, name: String, lat: Double, lng: Double, isPartner: Bool, isDemo: Bool, qrCode: String? = nil) {
        (self.id, self.name, self.lat, self.lng, self.isPartner, self.isDemo, self.qrCode) = (id, name, lat, lng, isPartner, isDemo, qrCode)
    }
    init(_ stop: RouteStop) { self.init(id: stop.id, name: stop.name, lat: stop.lat, lng: stop.lng, isPartner: stop.isPartner, isDemo: stop.isDemo) }
    init(_ card: NearbyPartner) { self.init(id: card.id, name: card.name, lat: card.lat, lng: card.lng, isPartner: card.isPartner ?? true, isDemo: card.isDemo) }
}

/// A shop's counter sticker: https://giggles-maps.pages.dev/app/?scan=<place_id>-<code>
struct ShopScan: Equatable, Sendable {
    let placeId: Int
    let code: String

    init?(_ url: URL) {
        guard let value = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "scan" })?.value,
              let match = value.wholeMatch(of: /(\d+)-([A-Za-z0-9]{2,16})/), let id = Int(match.1) else { return nil }
        placeId = id
        code = String(match.2).uppercased()
    }
}

struct NearbyPartner: Decodable, Equatable, Sendable {
    let id: Int
    let name: String
    let category: String
    let lat: Double
    let lng: Double
    let distanceM: Int
    let isPartner: Bool?     // v3: the card can be any good nearby place; label only real partners
    let isDemo: Bool
    let minLevel: Int?
    let exclusiveKind: String?
    enum CodingKeys: String, CodingKey {
        case id, name, category, lat, lng, distanceM = "distance_m", isPartner = "is_partner", isDemo = "is_demo"
        case minLevel = "min_level", exclusiveKind = "exclusive_kind"
    }
}

struct RoutePlan: Decodable, Sendable {
    let routeId: String
    let routing: String
    let baseMin: Int
    var totalMin: Int
    var extraMin: Int
    let budgetMin: Int
    let expectedThb: Double?
    let plus: Bool?              // Giggles Plus (cosmetic only since v4)
    let member: Bool?            // one-time membership: levels + exclusive places
    let level: Int?              // the level that unlocks places (0 for non-members)
    let maxBudgetMin: Int?       // 240 for everyone
    var stops: [RouteStop]
    var geometry: [[Double]]   // [lng, lat] pairs
    let plans: [ThemedPlan]?     // engine v2: one plan per theme; top-level fields = Top picks
    var line: [CLLocationCoordinate2D] { geometry.compactMap { $0.count == 2 ? .init(latitude: $0[1], longitude: $0[0]) : nil } }

    /// The same trip with a themed plan's stops, line and times swapped in.
    func choosing(_ id: String?) -> RoutePlan {
        guard let p = plans?.first(where: { $0.id == id }) else { return self }
        var copy = self
        (copy.stops, copy.geometry, copy.extraMin, copy.totalMin) = (p.stops, p.geometry, p.extraMin, p.totalMin)
        return copy
    }
    enum CodingKeys: String, CodingKey {
        case routing, stops, geometry, plans
        case routeId = "route_id", baseMin = "base_min", totalMin = "total_min", extraMin = "extra_min"
        case budgetMin = "budget_min", expectedThb = "expected_thb", plus, member, level, maxBudgetMin = "max_budget_min"
    }
}

struct ThemedPlan: Decodable, Identifiable, Sendable {
    let id: String               // top_picks | nature | food | culture | shopping
    let name: String
    let stops: [RouteStop]
    let geometry: [[Double]]
    let extraMin: Int
    let totalMin: Int
    let missedMeals: [String]
    enum CodingKeys: String, CodingKey {
        case id, name, stops, geometry, extraMin = "extra_min", totalMin = "total_min", missedMeals = "missed_meals"
    }
}

struct CheckinClient: Encodable, Sendable {
    var platform = "ios"
    var isMock: Bool
    var attest: String?
    var demo: Bool
    enum CodingKeys: String, CodingKey { case platform, attest, demo, isMock = "is_mock" }
}

struct CheckinRequest: Encodable, Sendable {
    var placeId: Int
    var lat: Double
    var lng: Double
    var accuracyM: Double
    var selfiePath: String
    var faceCount: Int
    var qrCode: String?          // code printed under the counter QR sticker (partners only)
    var client: CheckinClient
    enum CodingKeys: String, CodingKey {
        case lat, lng, client
        case placeId = "place_id", accuracyM = "accuracy_m", selfiePath = "selfie_path", faceCount = "face_count", qrCode = "qr_code"
    }
}

struct Badge: Decodable, Sendable { let slug: String; let name: String }

struct CheckinResult: Decodable, Sendable {
    let status: String          // approved | review | rejected
    let reasons: [String]
    let rewarded: Bool
    let billedThb: Double?      // optional fields tolerate the monetization rebuild
    let distanceM: Double?
    let newBadges: [Badge]?
    let billing: String?        // charged | no_qr | not_shown_on_route | repeat_visit_30d | wallet_empty | not_rewarded | not_partner
    let spin: Spin?
    let xpGained: Int?          // v4: XP from this check-in (everyone earns XP; levels unlock for members)
    let xp: Int?
    let level: Int?
    let levelUp: Bool?
    let member: Bool?
    let requiredLevel: Int?     // with reason level_locked
    enum CodingKeys: String, CodingKey {
        case status, reasons, rewarded, billing, spin, xp, level, member
        case billedThb = "billed_thb", distanceM = "distance_m", newBadges = "new_badges"
        case xpGained = "xp_gained", levelUp = "level_up", requiredLevel = "required_level"
    }

    /// free coupon spin after a rewarded check-in (never sold; odds always shown)
    struct Spin: Decodable, Sendable {
        let won: Bool
        let title: String?
        let place: String?
        let code: String?
        let odds: Double
    }

    var headline: String {
        switch status {
        case "approved": rewarded ? String(localized: "Checked in!") : String(localized: "Checked in, no new stamp.")
        case "review": String(localized: "Sent for review.")
        default: String(localized: "Check-in not accepted.")
        }
    }
}

// Passport reads (RLS limits checkins and badges to the signed-in user)
struct Collection: Decodable, Identifiable, Sendable {
    struct Member: Decodable, Sendable { let placeId: Int; enum CodingKeys: String, CodingKey { case placeId = "place_id" } }
    let id: Int
    let slug: String
    let name: String
    let description: String?
    let requiredCount: Int
    let collectionPlaces: [Member]
    enum CodingKeys: String, CodingKey {
        case id, slug, name, description
        case requiredCount = "required_count", collectionPlaces = "collection_places"
    }

    /// distinct rewarded places of this collection the user has visited, capped at the goal
    func progress(visited: Set<Int>) -> Int {
        min(Set(collectionPlaces.map(\.placeId)).intersection(visited).count, requiredCount)
    }
}

struct CheckinRow: Decodable, Identifiable, Sendable {
    struct Place: Decodable, Sendable { let name: String }
    let id: String
    let placeId: Int
    let status: String
    let rewarded: Bool
    let places: Place?
    enum CodingKeys: String, CodingKey { case id, status, rewarded, places, placeId = "place_id" }
}

struct BadgeRow: Decodable, Sendable {
    let collectionId: Int
    enum CodingKeys: String, CodingKey { case collectionId = "collection_id" }
}

enum Copy {
    static func reason(_ code: String) -> String {
        switch code {
        case "too_far": String(localized: "You're more than 60 m from this place.")
        case "no_face": String(localized: "We couldn't see a face in the selfie.")
        case "no_selfie": String(localized: "The selfie didn't upload.")
        case "mock_location": String(localized: "Your location looks simulated.")
        case "speed_jump": String(localized: "You moved faster than a car since your last check-in.")
        case "low_accuracy": String(localized: "GPS was too rough (over 50 m). A person will review it.")
        case "already_rewarded_today": String(localized: "Already stamped here today. Come back tomorrow.")
        case "level_locked": String(localized: "This place opens at a higher member level.")
        default: code
        }
    }

    static func meal(_ code: String) -> String {
        switch code {
        case "breakfast": String(localized: "Breakfast")
        case "lunch": String(localized: "Lunch")
        case "dinner": String(localized: "Dinner")
        default: code
        }
    }
    /// themed plan names; the server's English name is the fallback for themes added later
    static func plan(_ id: String, fallback: String) -> String {
        switch id {
        case "top_picks": String(localized: "Top picks")
        case "nature": String(localized: "Nature lover")
        case "food": String(localized: "Food lover")
        case "culture": String(localized: "Culture & temples")
        case "shopping": String(localized: "Shopping & crafts")
        default: fallback
        }
    }
    static func category(_ code: String) -> String {
        switch code {
        case "cafe": String(localized: "Café")
        case "food": String(localized: "Food")
        case "craft": String(localized: "Craft shop")
        case "temple": String(localized: "Temple")
        case "park": String(localized: "Park")
        case "museum": String(localized: "Museum")
        case "market": String(localized: "Market")
        case "viewpoint": String(localized: "Viewpoint")
        case "art": String(localized: "Art")
        default: code
        }
    }

    static func billing(_ code: String) -> String {
        switch code {
        case "charged": String(localized: "shop charged its bid")
        case "starter_plan": String(localized: "covered by the shop's Starter plan")
        case "no_qr": String(localized: "not billed: counter code missing")
        case "not_shown_on_route": String(localized: "not billed: stop wasn't on your route in the last 3 hours")
        case "repeat_visit_30d": String(localized: "not billed: repeat visit within 30 days")
        case "wallet_empty": String(localized: "not billed: shop credit empty")
        case "not_partner": String(localized: "not billed: not a partner shop")
        default: String(localized: "not billed")
        }
    }

    static func hhmm(_ minutes: Int) -> String {
        String(format: "%02d:%02d", (minutes / 60) % 24, minutes % 60)
    }
}

// MARK: membership + levels (v4)

/// Mirrors SQL level_for(xp): L1 0, L2 300, L3 800, L4 1500, L5 2500, L6 4000, L7 6000, L8 8500, L9 11500, L10 15000.
enum Levels {
    static let thresholds = [0, 300, 800, 1500, 2500, 4000, 6000, 8500, 11500, 15000]

    static func level(for xp: Int) -> Int { thresholds.lastIndex { xp >= $0 }.map { $0 + 1 } ?? 1 }

    /// XP into the current level and the size of the step to the next one (nil at the top level).
    static func progress(_ xp: Int) -> (into: Int, span: Int?) {
        let lvl = level(for: xp)
        let floor = thresholds[lvl - 1]
        return lvl < thresholds.count ? (xp - floor, thresholds[lvl] - floor) : (xp - floor, nil)
    }

    static func kindName(_ kind: String?) -> String {
        switch kind {
        case "gem": String(localized: "Hidden gem")
        case "perk": String(localized: "Member perk")
        case "event": String(localized: "Event")
        default: String(localized: "Exclusive")
        }
    }
}

struct Profile: Decodable, Sendable {
    struct Cosmetics: Decodable, Sendable { let theme: String?; let flair: String? }
    let memberSince: Date?
    let xp: Int
    let plusUntil: Date?
    let cosmetics: Cosmetics?
    var isMember: Bool { memberSince != nil }
    var hasPlus: Bool { (plusUntil ?? .distantPast) > .now }
    enum CodingKeys: String, CodingKey { case xp, cosmetics, memberSince = "member_since", plusUntil = "plus_until" }
}

/// One exclusive place from rpc my_exclusives; locked ones come without location or perk text.
struct ExclusivePlace: Decodable, Identifiable, Sendable {
    let id: Int
    let name: String
    let category: String
    let exclusiveKind: String
    let minLevel: Int
    let unlocked: Bool
    let lat: Double?
    let lng: Double?
    let perkText: String?
    let isDemo: Bool
    enum CodingKeys: String, CodingKey {
        case id, name, category, unlocked, lat, lng
        case exclusiveKind = "exclusive_kind", minLevel = "min_level", perkText = "perk_text", isDemo = "is_demo"
    }
}
