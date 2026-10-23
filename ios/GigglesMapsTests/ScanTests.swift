import XCTest
@testable import GigglesMaps

final class ScanTests: XCTestCase {
    func testParsesShopStickerURL() throws {
        let scan = try XCTUnwrap(ShopScan(URL(string: "https://giggles-maps.pages.dev/app/?scan=31-demo")!))
        XCTAssertEqual(scan.placeId, 31)
        XCTAssertEqual(scan.code, "DEMO")
    }

    func testNumbersMatchJavaScriptFormatting() {
        XCTAssertEqual(AppAttest.js(17), "17")
        XCTAssertEqual(AppAttest.js(17.16781), "17.16781")
        XCTAssertEqual(AppAttest.js(104.1524112), "104.1524112")
    }

    func testRejectsOtherURLs() {
        XCTAssertNil(ShopScan(URL(string: "https://giggles-maps.pages.dev/app/")!))
        XCTAssertNil(ShopScan(URL(string: "https://example.com/?scan=abc")!))
        XCTAssertNil(ShopScan(URL(string: "https://example.com/?scan=12-x")!))   // code too short
    }
}
