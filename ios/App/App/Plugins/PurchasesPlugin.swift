import Capacitor
import StoreKit

/// App Store purchases (guideline 3.1.1: digital goods in the app go through Apple). Membership is one-time, Plus is
/// monthly. The web code sends each signed transaction (jws) to the Edge Function apple-plus, then calls finish():
/// an unfinished transaction comes back at the next launch, so nothing paid for is ever lost.
@objc(PurchasesPlugin)
public class PurchasesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PurchasesPlugin"
    public let jsName = "Purchases"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "buy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
    ]
    static let ids = ["membership": "com.kristpaul.gigglesmaps.membership", "plus": "com.kristpaul.gigglesmaps.plus.monthly"]
    private var updates: Task<Void, Never>?

    override public func load() {
        // renewals, refunds and purchases from another device arrive while the app runs
        updates = Task.detached { [weak self] in
            for await result in StoreKit.Transaction.updates {
                if let tx = Self.verified(result) { self?.notifyListeners("transaction", data: tx) }
            }
        }
    }

    private static func verified(_ r: VerificationResult<StoreKit.Transaction>) -> [String: Any]? {
        guard case .verified(let tx) = r, ids.values.contains(tx.productID) else { return nil }
        return ["jws": r.jwsRepresentation, "id": String(tx.id), "product": tx.productID]
    }

    /// Local prices, as the App Store shows them.
    @objc func products(_ call: CAPPluginCall) {
        Task {
            let list = (try? await Product.products(for: Array(Self.ids.values))) ?? []
            call.resolve(["products": list.map { ["id": $0.id, "price": $0.displayPrice] }])
        }
    }

    /// Buy one; `account` (the user id) rides on the transaction so the server can refuse it on another account.
    @objc func buy(_ call: CAPPluginCall) {
        guard let id = Self.ids[call.getString("product") ?? ""] else { return call.reject("bad_product") }
        Task {
            do {
                guard let product = try await Product.products(for: [id]).first else { return call.reject("product_unavailable") }
                var options: Set<Product.PurchaseOption> = []
                if let account = call.getString("account").flatMap(UUID.init(uuidString:)) { options.insert(.appAccountToken(account)) }
                switch try await product.purchase(options: options) {
                case .success(let result):
                    guard let tx = Self.verified(result) else { return call.reject("unverified") }
                    call.resolve(tx)
                case .pending: call.resolve(["pending": true])        // Ask to Buy: arrives later as a "transaction" event
                case .userCancelled: call.resolve(["cancelled": true])
                @unknown default: call.resolve(["cancelled": true])
                }
            } catch { call.reject("purchase_failed", nil, error) }
        }
    }

    @objc func finish(_ call: CAPPluginCall) {
        guard let id = call.getString("id").flatMap(UInt64.init) else { return call.reject("bad_args") }
        Task {
            for await result in StoreKit.Transaction.unfinished {
                if case .verified(let tx) = result, tx.id == id { await tx.finish() }
            }
            call.resolve()
        }
    }

    /// Paid for but not delivered yet (the app closed before the server answered).
    @objc func pending(_ call: CAPPluginCall) {
        Task {
            var list: [[String: Any]] = []
            for await result in StoreKit.Transaction.unfinished { if let tx = Self.verified(result) { list.append(tx) } }
            call.resolve(["transactions": list])
        }
    }

    /// Restore: everything this Apple ID owns now (membership, an active Plus).
    @objc func restore(_ call: CAPPluginCall) {
        Task {
            try? await AppStore.sync()
            var list: [[String: Any]] = []
            for await result in StoreKit.Transaction.currentEntitlements { if let tx = Self.verified(result) { list.append(tx) } }
            call.resolve(["transactions": list])
        }
    }
}
