import StoreKit
import SwiftUI

/// Giggles Plus is cosmetic only (v4): passport themes, name flair, premium share cards and a monthly stamp.
/// Nothing about places, routes or check-ins depends on it.
struct PlusSection: View {
    let profile: Profile?
    var onChange: () -> Void = {}
    @State private var account = Account.shared
    @State private var stamps: [Date] = []
    @State private var showStore = false
    @State private var message: String?

    private var hasPlus: Bool { profile?.hasPlus ?? false }

    var body: some View {
        Section("Giggles Plus") {
            if hasPlus, let until = profile?.plusUntil {
                Label("Active until \(until.formatted(date: .abbreviated, time: .omitted))", systemImage: "checkmark.seal.fill")
                    .foregroundStyle(Theme.good)

                Picker("Passport theme", selection: themeBinding) {
                    ForEach(PassportTheme.allCases) { Text($0.name).tag($0) }
                }
                Picker("Name flair", selection: flairBinding) {
                    ForEach(Flair.allCases) { Text($0.name).tag($0) }
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("Monthly stamps").font(.subheadline.weight(.semibold))
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(stamps, id: \.self) { MonthStamp(month: $0) }
                        }
                    }
                }
                Button("Manage subscription") { Task { await manage() } }
            } else {
                Text("Make your passport yours: 6 cover themes, a coloured name with a badge, 3 premium share-card designs, and a new stamp every month. Looks only: every place and route stays free.")
                    .font(.footnote).foregroundStyle(Theme.ink2)
                if account.isGuest {
                    Text("Sign in above first, so Plus stays with your account.").font(.footnote).foregroundStyle(Theme.ink2)
                } else {
                    Button("Get Plus") { showStore = true }.buttonStyle(PrimaryButtonStyle(gold: true))
                }
            }
            if !account.isGuest {
                Button("Restore purchases") { Task { await Store.restore(); onChange() } }.font(.footnote)
            }
            if let message { Text(message).font(.footnote).foregroundStyle(Theme.bad) }
        }
        .task(id: profile?.plusUntil) { stamps = (try? await Backend.monthlyStamps()) ?? [] }
        .sheet(isPresented: $showStore) {
            SubscriptionStoreView(productIDs: [Store.plusID]) {
                VStack(spacing: 8) {
                    Text("Giggles Plus").font(Theme.display(30)).foregroundStyle(Theme.indigo)
                    Text("Themes, flair and share cards for your passport.").multilineTextAlignment(.center)
                }
                .padding()
            }
            .storeButton(.visible, for: .restorePurchases)
            .inAppPurchaseOptions { _ in account.userId.map { [.appAccountToken($0)] } ?? [] }
            .onInAppPurchaseCompletion { _, result in
                if case .success(.success(let verification)) = result {
                    await Store.deliver(verification)
                    showStore = false
                    onChange()
                }
            }
        }
    }

    private var themeBinding: Binding<PassportTheme> {
        Binding(get: { PassportTheme(rawValue: profile?.cosmetics?.theme ?? "") ?? .classic },
                set: { new in save { try await Backend.setCosmetics(theme: new.rawValue) } })
    }

    private var flairBinding: Binding<Flair> {
        Binding(get: { Flair(rawValue: profile?.cosmetics?.flair ?? "") ?? .none },
                set: { new in save { try await Backend.setCosmetics(flair: new.rawValue) } })
    }

    private func save(_ work: @escaping () async throws -> Void) {
        message = nil
        Task {
            do { try await work(); onChange() }
            catch { message = String(localized: "Couldn't save that. Try again.") }
        }
    }

    private func manage() async {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
        try? await AppStore.showManageSubscriptions(in: scene)
        onChange()
    }
}

/// A Plus monthly stamp: the month in a round ink stamp, colour changes with the month.
struct MonthStamp: View {
    let month: Date
    var body: some View {
        let hue = Double(Calendar.current.component(.month, from: month)) / 12
        VStack(spacing: 0) {
            Text(month.formatted(.dateTime.month(.abbreviated))).font(.caption.weight(.bold)).textCase(.uppercase)
            Text(month.formatted(.dateTime.year())).font(.caption2.monospaced())
        }
        .foregroundStyle(Color(hue: hue, saturation: 0.7, brightness: 0.7))
        .frame(width: 58, height: 58)
        .overlay(Circle().stroke(Color(hue: hue, saturation: 0.7, brightness: 0.7), style: StrokeStyle(lineWidth: 3, dash: [4, 2])))
        .rotationEffect(.degrees(-8))
        .accessibilityLabel("Plus stamp \(month.formatted(.dateTime.month(.wide).year()))")
    }
}
