import UIKit
import XCTest
@testable import GigglesMaps

final class FaceTests: XCTestCase {
    func testFindsTheFaceInASamplePortrait() async throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "face-sample", withExtension: "jpg"))
        let image = try XCTUnwrap(UIImage(contentsOfFile: url.path))
        let count = await FaceCounter.count(in: image)
        XCTAssertGreaterThanOrEqual(count, 1)
    }
}
