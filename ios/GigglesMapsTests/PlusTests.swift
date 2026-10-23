import StoreKit
import StoreKitTest
import XCTest
@testable import GigglesMaps

/// Buys Giggles Plus against the local StoreKit file and writes the signed transaction to a file, so the server
/// check (apple-plus) can be exercised with a real Xcode-signed JWS.
final class PlusTests: XCTestCase {
    func testPurchaseProducesSignedTransaction() async throws {
        let session = try SKTestSession(configurationFileNamed: "GigglesPlus")
        session.resetToDefaultState()
        session.disableDialogs = true
        session.clearTransactions()

        let products = try await Product.products(for: [Store.plusID, Store.membershipID])
        // iOS 26.5 Simulator: xcodebuild never syncs the .storekit file (Apple forum thread 826971); test on device/IDE
        guard let product = products.first(where: { $0.id == Store.plusID }) else { throw XCTSkip("StoreKit test config not loaded by this simulator runtime") }
        XCTAssertEqual(product.type, .autoRenewable)
        let token = UUID(uuidString: ProcessInfo.processInfo.environment["PLUS_TEST_USER"] ?? "") ?? UUID()
        let result = try await product.purchase(options: [.appAccountToken(token)])
        guard case .success(let verification) = result, case .verified(let tx) = verification else { return XCTFail("purchase failed") }
        XCTAssertEqual(tx.appAccountToken, token)
        try verification.jwsRepresentation.write(toFile: NSTemporaryDirectory() + "plus.jws", atomically: true, encoding: .utf8)
        print("PLUS_JWS_PATH", NSTemporaryDirectory() + "plus.jws")
    }
}
