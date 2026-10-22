import SwiftUI

struct PassportView: View {
    var refreshKey: Int
    @State private var collections: [Collection] = []
    @State private var recent: [CheckinRow] = []
    @State private var visited: Set<Int> = []
    @State private var badges: Set<Int> = []
    @State private var confirmDelete = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            List {
                Section("Trails") {
                    ForEach(collections) { c in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(c.name).font(.headline)
                                Spacer()
                                if badges.contains(c.id) {
                                    Text("EARNED").font(.caption2.weight(.bold).monospaced()).foregroundStyle(Theme.stamp)
                                        .padding(.horizontal, 6).padding(.vertical, 1)
                                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.stamp, lineWidth: 2))
                                        .rotationEffect(.degrees(-4))
                                }
                            }
                            if let d = c.description { Text(d).font(.footnote).foregroundStyle(Theme.ink2) }
                            let have = c.progress(visited: visited)
                            HStack(spacing: 6) {
                                ForEach(0..<c.requiredCount, id: \.self) { i in
                                    Circle().strokeBorder(Theme.indigo, lineWidth: 2)
                                        .background(Circle().fill(i < have ? Theme.indigo : .clear))
                                        .frame(width: 14, height: 14)
                                }
                            }
                            .accessibilityLabel("\(have) of \(c.requiredCount)")
                        }
                        .padding(.vertical, 4)
                    }
                }

                Section("Recent check-ins") {
                    if recent.isEmpty {
                        Text("No check-ins yet. Plan a route and check in at a stop to get your first stamp.")
                            .font(.footnote).foregroundStyle(Theme.ink2)
                    }
                    ForEach(recent.prefix(8)) { r in
                        HStack {
                            Text(r.places?.name ?? String(localized: "Place"))
                            Spacer()
                            Text(LocalizedStringKey(r.status)).font(.caption.weight(.semibold))
                                .foregroundStyle(r.status == "approved" ? Theme.good : r.status == "review" ? Theme.marigold : Theme.bad)
                        }
                    }
                }

                Section {
                    if confirmDelete {
                        Text("This deletes your account, check-ins, badges and selfies. It can't be undone.").font(.footnote)
                        Button("Delete everything", role: .destructive) { Task { await deleteAccount() } }
                        Button("Keep my account") { confirmDelete = false }
                    } else {
                        Button("Delete my account", role: .destructive) { confirmDelete = true }
                    }
                    if let message { Text(message).font(.footnote).foregroundStyle(Theme.ink2) }
                }
            }
            .navigationTitle("Your passport")
            .refreshable { await load() }
        }
        .task(id: refreshKey) { await load() }
    }

    private func load() async {
        do {
            let p = try await Backend.passport()
            collections = p.collections
            recent = p.checkins
            visited = Set(p.checkins.filter(\.rewarded).map(\.placeId))
            badges = p.badges
        } catch {
            message = String(localized: "Couldn't load your passport. Check your connection.")
        }
    }

    private func deleteAccount() async {
        do {
            try await Backend.deleteAccount()
            recent = []; visited = []; badges = []
            message = String(localized: "Account deleted. A fresh guest passport starts next time you plan a route.")
        } catch {
            message = String(localized: "Couldn't delete the account. Try again.")
        }
        confirmDelete = false
    }
}
