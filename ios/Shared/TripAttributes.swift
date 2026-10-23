import ActivityKit
import Foundation

/// Live Activity for a running trip (Lock Screen + Dynamic Island). Shared by the app and the widget extension.
struct TripAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var nextStop: String?        // nil = heading to the destination
        var nextEta: Date?
        var stopsDone: Int
        var stopsTotal: Int
    }
    var destination: String
}

/// What the home-screen Passport widget shows, written by the app into the shared App Group.
struct PassportSnapshot: Codable {
    var stamps: Int
    var trailName: String?
    var trailHave: Int
    var trailNeed: Int

    static let group = "group.com.kristpaul.gigglesmaps"
    private static let key = "passport.snapshot"

    static func load() -> PassportSnapshot? {
        guard let data = UserDefaults(suiteName: group)?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(PassportSnapshot.self, from: data)
    }

    func save() {
        UserDefaults(suiteName: Self.group)?.set(try? JSONEncoder().encode(self), forKey: Self.key)
    }
}
