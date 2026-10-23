import XCTest
@testable import GigglesMaps

final class LevelTests: XCTestCase {
    /// must match SQL level_for(xp) in 20261023000010_membership_levels.sql
    func testLevelCurveMatchesServer() {
        XCTAssertEqual(Levels.level(for: 0), 1)
        XCTAssertEqual(Levels.level(for: 299), 1)
        XCTAssertEqual(Levels.level(for: 300), 2)
        XCTAssertEqual(Levels.level(for: 1500), 4)
        XCTAssertEqual(Levels.level(for: 14999), 9)
        XCTAssertEqual(Levels.level(for: 15000), 10)
        XCTAssertEqual(Levels.level(for: 99999), 10)
    }

    func testProgressWithinLevel() {
        XCTAssertEqual(Levels.progress(250).into, 250)
        XCTAssertEqual(Levels.progress(250).span, 300)
        XCTAssertEqual(Levels.progress(1000).into, 200)    // L3 starts at 800, L4 at 1500
        XCTAssertEqual(Levels.progress(1000).span, 700)
        XCTAssertNil(Levels.progress(20000).span)          // top level
    }

    func testDecodesCheckinResultWithXP() throws {
        let json = #"{"status":"approved","reasons":[],"rewarded":true,"xp_gained":250,"xp":250,"level":1,"level_up":false,"member":false,"billing":"charged","new_badges":[],"spin":null}"#
        let r = try JSONDecoder().decode(CheckinResult.self, from: Data(json.utf8))
        XCTAssertEqual(r.xpGained, 250)
        XCTAssertEqual(r.levelUp, false)
        let locked = #"{"status":"rejected","reasons":["level_locked"],"rewarded":false,"required_level":4,"level":0,"new_badges":[],"xp_gained":0}"#
        let l = try JSONDecoder().decode(CheckinResult.self, from: Data(locked.utf8))
        XCTAssertEqual(l.requiredLevel, 4)
        XCTAssertNotEqual(Copy.reason("level_locked"), "level_locked")
    }

    func testCosmeticIDsMatchServerWhitelist() {
        XCTAssertEqual(Set(PassportTheme.allCases.map(\.rawValue)), ["classic", "indigo", "lotus", "night-market", "temple-gold", "rain"])
        XCTAssertEqual(Set(Flair.allCases.map(\.rawValue)), ["none", "marigold", "indigo", "lotus", "sparkle"])
    }
}
