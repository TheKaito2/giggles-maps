import StoreKit
import SwiftUI

/// Giggles Plus on iOS: Apple's auto-renewing subscription. The server turns Plus on after verifying the signed
/// transaction (Edge Function apple-plus); `profiles.plus_until` is what the route planner reads.
enum Plus {
    static let productID = "com.kristpaul.gigglesmaps.plus.monthly"

    static func until() async -> Date? {
        guard let id = try? await Backend.ensureSession() else { return nil }
        struct Row: Decodable { let plus_until: Date? }
        let row: Row? = try? await Backend.client.from("profiles").select("plus_until").eq("id", value: id).single().execute().value
        return row?.plus_until.flatMap { $0 > .now ? $0 : nil }
    }

    /// Sends one verified transaction to the server, then finishes it with Apple.
    static func deliver(_ result: VerificationResult<StoreKit.Transaction>) async {
        guard case .verified(let tx) = result, tx.productID == productID else { return }
        do {
            try await Backend.applePlus(jws: result.jwsRepresentation)
            await tx.finish()
        } catch {
            print("Plus delivery failed, will retry on next launch:", error)   // unfinished transactions come back
        }
    }

    /// Renewals, purchases made on another device and refunds arrive here while the app runs.
    static func listen() -> Task<Void, Never> {
        Task.detached {
            for await result in StoreKit.Transaction.unfinished { await deliver(result) }
            for await result in StoreKit.Transaction.updates { await deliver(result) }
        }
    }
}

struct PlusSection: View {
    var refreshKey: Int
    @State private var account = Account.shared
    @State private var until: Date?
    @State private var showStore = false
    @State private var message: String?

    var body: some View {
        Section("Giggles Plus") {
            if let until {
                Label("Active until \(until.formatted(date: .abbreviated, time: .omitted))", systemImage: "checkmark.seal.fill")
                    .foregroundStyle(Theme.good)
                Text("Detours up to 240 extra minutes, and Plus badges.").font(.footnote).foregroundStyle(Theme.ink2)
                Button("Manage subscription") { Task { await manage() } }
            } else {
                Text("Plan detours up to 240 extra minutes, and collect Plus badges.")
                    .font(.footnote).foregroundStyle(Theme.ink2)
                if account.isGuest {
                    Text("Sign in above first, so Plus stays with your account.").font(.footnote).foregroundStyle(Theme.ink2)
                } else {
                    Button("Get Plus") { showStore = true }.buttonStyle(PrimaryButtonStyle(gold: true))
                    Button("Restore purchases") { Task { await restore() } }.font(.footnote)
                }
            }
            if let message { Text(message).font(.footnote).foregroundStyle(Theme.ink2) }
        }
        .task(id: "\(refreshKey)-\(account.userId?.uuidString ?? "")") { until = await Plus.until() }
        .sheet(isPresented: $showStore) {
            SubscriptionStoreView(productIDs: [Plus.productID]) {
                VStack(spacing: 8) {
                    Text("Giggles Plus").font(Theme.display(30)).foregroundStyle(Theme.indigo)
                    Text("Longer detours for longer days out.").multilineTextAlignment(.center)
                }
                .padding()
            }
            .storeButton(.visible, for: .restorePurchases)
            .inAppPurchaseOptions { _ in
                account.userId.map { [.appAccountToken($0)] } ?? []
            }
            .onInAppPurchaseCompletion { _, result in
                if case .success(.success(let verification)) = result {
                    await Plus.deliver(verification)
                    until = await Plus.until()
                    showStore = false
                }
            }
        }
    }

    private func restore() async {
        message = nil
        try? await AppStore.sync()
        for await result in StoreKit.Transaction.currentEntitlements { await Plus.deliver(result) }
        until = await Plus.until()
        if until == nil { message = String(localized: "No active Plus subscription found for this Apple ID.") }
    }

    private func manage() async {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
        try? await AppStore.showManageSubscriptions(in: scene)
        until = await Plus.until()
    }
}
