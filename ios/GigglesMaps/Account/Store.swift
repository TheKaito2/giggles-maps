import StoreKit

/// App Store products. Membership is a one-time purchase (levels + exclusive places); Giggles Plus is a cosmetic
/// subscription. The server unlocks either after verifying the signed transaction (Edge Function apple-plus).
enum Store {
    static let membershipID = "com.kristpaul.gigglesmaps.membership"
    static let plusID = "com.kristpaul.gigglesmaps.plus.monthly"

    /// Sends one verified transaction to the server, then finishes it with Apple.
    static func deliver(_ result: VerificationResult<StoreKit.Transaction>) async {
        guard case .verified(let tx) = result, [membershipID, plusID].contains(tx.productID) else { return }
        do {
            try await Backend.applePurchase(jws: result.jwsRepresentation)
            await tx.finish()
        } catch {
            print("Purchase delivery failed, will retry on next launch:", error)   // unfinished transactions come back
        }
    }

    /// Renewals, purchases made on another device and refunds arrive here while the app runs.
    static func listen() -> Task<Void, Never> {
        Task.detached {
            for await result in StoreKit.Transaction.unfinished { await deliver(result) }
            for await result in StoreKit.Transaction.updates { await deliver(result) }
        }
    }

    /// Restore: resend everything this Apple ID owns (membership and an active Plus).
    static func restore() async {
        try? await AppStore.sync()
        for await result in StoreKit.Transaction.currentEntitlements { await deliver(result) }
    }
}
