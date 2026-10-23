import StoreKit
import SwiftUI

/// Top of the passport: name (with Plus flair), level ring + XP bar, and membership.
/// Everyone earns XP; the level only unlocks places for members, so non-members see it locked.
struct LevelCard: View {
    let profile: Profile?
    var onPurchased: () -> Void = {}
    @State private var account = Account.shared
    @State private var showStore = false

    private var xp: Int { profile?.xp ?? 0 }
    private var level: Int { Levels.level(for: xp) }
    private var member: Bool { profile?.isMember ?? false }
    private var theme: PassportTheme {
        profile?.hasPlus == true ? PassportTheme(rawValue: profile?.cosmetics?.theme ?? "") ?? .classic : .classic
    }
    private var flair: Flair { profile?.hasPlus == true ? Flair(rawValue: profile?.cosmetics?.flair ?? "") ?? .none : .none }

    var body: some View {
        let colors = theme.colors
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 16) {
                ZStack {
                    Circle().stroke(colors.ink.opacity(0.2), lineWidth: 7)
                    Circle().trim(from: 0, to: ringFraction)
                        .stroke(member ? Theme.marigold : colors.ink.opacity(0.35), style: StrokeStyle(lineWidth: 7, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    VStack(spacing: 0) {
                        Text("LV").font(.caption2.weight(.bold).monospaced())
                        Text("\(level)").font(Theme.display(28))
                    }
                    .foregroundStyle(colors.ink)
                }
                .frame(width: 76, height: 76)
                .overlay(alignment: .bottomTrailing) {
                    if !member { Image(systemName: "lock.fill").font(.caption).padding(5).background(.thinMaterial, in: Circle()) }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(member ? "Level \(level)" : "Level \(level), locked")

                VStack(alignment: .leading, spacing: 4) {
                    FlairName(name: account.email.map { String($0.prefix { $0 != "@" }) } ?? String(localized: "Guest explorer"),
                              flair: flair, fallback: colors.ink)
                    Text("\(xp) XP").font(Theme.data).foregroundStyle(colors.ink)
                    if let span = Levels.progress(xp).span {
                        ProgressView(value: Double(Levels.progress(xp).into), total: Double(span)).tint(Theme.marigold)
                        Text("\(span - Levels.progress(xp).into) XP to level \(level + 1)").font(.caption).foregroundStyle(colors.ink.opacity(0.8))
                    } else {
                        Text("Top level").font(.caption).foregroundStyle(colors.ink.opacity(0.8))
                    }
                }
            }

            if member {
                Label("Member", systemImage: "checkmark.seal.fill").font(.subheadline.weight(.semibold)).foregroundStyle(colors.ink)
            } else {
                Text("Become a member to unlock your level, hidden gems, member perks and events. One payment, yours for good.")
                    .font(.footnote).foregroundStyle(colors.ink.opacity(0.9))
                if account.isGuest {
                    Text("Sign in below first, so your membership stays with your account.").font(.footnote).foregroundStyle(colors.ink.opacity(0.9))
                } else {
                    Button("Become a member") { showStore = true }.buttonStyle(PrimaryButtonStyle(gold: true))
                }
            }
        }
        .padding(18)
        .background(LinearGradient(colors: [colors.top, colors.bottom], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 20))
        .sheet(isPresented: $showStore) {
            VStack(spacing: 18) {
                Text("Giggles Maps membership").font(Theme.display(26)).foregroundStyle(Theme.indigo).multilineTextAlignment(.center)
                VStack(alignment: .leading, spacing: 8) {
                    Label("Your level unlocks right away (you've banked \(xp) XP)", systemImage: "star.circle")
                    Label("Hidden gems from level 2", systemImage: "sparkle.magnifyingglass")
                    Label("Member perks at shops from level 4", systemImage: "gift")
                    Label("Events and limited spots from level 6", systemImage: "calendar")
                }
                .font(.subheadline)
                ProductView(id: Store.membershipID).productViewStyle(.compact)
                Text("One-time purchase. No subscription.").font(.footnote).foregroundStyle(Theme.ink2)
            }
            .padding(24)
            .presentationDetents([.medium, .large])
            .inAppPurchaseOptions { _ in account.userId.map { [.appAccountToken($0)] } ?? [] }
            .onInAppPurchaseCompletion { _, result in
                if case .success(.success(let verification)) = result {
                    await Store.deliver(verification)
                    showStore = false
                    onPurchased()
                }
            }
        }
    }

    private var ringFraction: CGFloat {
        guard let span = Levels.progress(xp).span else { return 1 }
        return CGFloat(Levels.progress(xp).into) / CGFloat(span)
    }
}

/// Passport list of every exclusive place: unlocked ones show their perk, locked ones show the level they need.
struct ExclusiveSection: View {
    let places: [ExclusivePlace]

    var body: some View {
        if !places.isEmpty {
            Section("Exclusive places") {
                ForEach(places) { p in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: p.unlocked ? icon(p.exclusiveKind) : "lock.fill")
                            .foregroundStyle(p.unlocked ? Theme.marigold : Theme.ink2).frame(width: 22)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(p.name).font(.headline).foregroundStyle(p.unlocked ? Color.primary : Theme.ink2)
                            HStack(spacing: 6) {
                                Chip(text: Levels.kindName(p.exclusiveKind))
                                Chip(text: String(localized: "Level \(p.minLevel)"))
                                if p.isDemo { Chip(text: String(localized: "Example")) }
                            }
                            if p.unlocked, let perk = p.perkText { Text(perk).font(.footnote).foregroundStyle(Theme.ink2) }
                        }
                    }
                    .padding(.vertical, 3)
                }
            }
        }
    }

    private func icon(_ kind: String) -> String {
        switch kind { case "gem": "sparkle"; case "perk": "gift.fill"; default: "calendar" }
    }
}
