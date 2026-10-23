import XCTest
@testable import GigglesMaps

final class ModelTests: XCTestCase {
    func testDecodesRealPlanRouteResponse() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "plan-route-sample", withExtension: "json"))
        let plan = try JSONDecoder().decode(RoutePlan.self, from: Data(contentsOf: url))
        XCTAssertLessThanOrEqual(plan.extraMin, plan.budgetMin)
        XCTAssertFalse(plan.stops.isEmpty)
        XCTAssertFalse(plan.line.isEmpty)
        // geometry is [lng, lat]: Sakon Nakhon is around lat 17, lng 104
        XCTAssertEqual(plan.line[0].latitude, 17.1, accuracy: 0.2)
        XCTAssertEqual(plan.line[0].longitude, 104.1, accuracy: 0.2)
        // v3: "Near this spot" cards can be non-partners, and must not be labelled Partner
        let cards = plan.stops.compactMap(\.nearbyPartner)
        XCTAssertFalse(cards.isEmpty)
        XCTAssertTrue(cards.contains { $0.isPartner == false })
        XCTAssertFalse(CheckinTarget(cards.first { $0.isPartner == false }!).isPartner)
    }

    func testRequestUsesSnakeCaseKeys() throws {
        let body = CheckinRequest(placeId: 1, lat: 17, lng: 104, accuracyM: 5, selfiePath: "u/1.jpg", faceCount: 1,
                                  client: CheckinClient(isMock: false, attest: nil, demo: true))
        let json = try XCTUnwrap(String(data: JSONEncoder().encode(body), encoding: .utf8))
        for key in ["place_id", "accuracy_m", "selfie_path", "face_count", "is_mock", "\"platform\":\"ios\""] {
            XCTAssertTrue(json.contains(key), "missing \(key) in \(json)")
        }
    }

    func testCollectionProgressCountsDistinctVisitedMembersCapped() {
        let c = Collection(id: 1, slug: "t", name: "T", description: nil, requiredCount: 2,
                           collectionPlaces: [.init(placeId: 1), .init(placeId: 2), .init(placeId: 3)])
        XCTAssertEqual(c.progress(visited: []), 0)
        XCTAssertEqual(c.progress(visited: [1, 99]), 1)
        XCTAssertEqual(c.progress(visited: [1, 2, 3]), 2)
    }

    func testEveryServerReasonHasText() {
        for code in ["too_far", "no_face", "no_selfie", "mock_location", "speed_jump", "low_accuracy", "already_rewarded_today"] {
            XCTAssertNotEqual(Copy.reason(code), code)
        }
        XCTAssertEqual(Copy.hhmm(617), "10:17")
    }
}

extension Collection.Member {
    init(placeId: Int) { self = try! JSONDecoder().decode(Self.self, from: Data("{\"place_id\":\(placeId)}".utf8)) }
}
extension Collection {
    init(id: Int, slug: String, name: String, description: String?, requiredCount: Int, collectionPlaces: [Member]) {
        let members = collectionPlaces.map { "{\"place_id\":\($0.placeId)}" }.joined(separator: ",")
        let json = "{\"id\":\(id),\"slug\":\"\(slug)\",\"name\":\"\(name)\",\"description\":null,\"required_count\":\(requiredCount),\"collection_places\":[\(members)]}"
        self = try! JSONDecoder().decode(Self.self, from: Data(json.utf8))
    }
}
