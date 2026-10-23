import SwiftUI

/// "Places you want to visit": search our places by name or kind near the start, add up to 3 as stops
/// (sent as must_include; they go into every plan when they fit).
struct ExplorePlaces: View {
    @Bindable var model: PlanModel
    static let maxPicks = 3
    @State private var query = ""
    @State private var kind: PlaceKind?
    @State private var results: [FoundPlace] = []
    @State private var message: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.indigo)
                    TextField("Search places, e.g. waterfall, cafe, วัด", text: $query)
                        .submitLabel(.search).onSubmit { Task { await search() } }
                }
                .padding(10)
                .background(Theme.card, in: .rect(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color.secondary.opacity(0.25)))
                Button(busy ? String(localized: "Searching…") : String(localized: "Search")) { Task { await search() } }
                    .font(.seed(.subheadline, .bold)).tint(Theme.indigo).disabled(busy)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    kindChip(nil, String(localized: "All"))
                    ForEach(PlaceKind.allCases, id: \.self) { kindChip($0, Copy.kind($0)) }
                }
            }
            .scrollClipDisabled()
            if let message { Text(message).font(.seed(.footnote)).foregroundStyle(Theme.ink2) }
            ForEach(results) { p in
                let added = model.picks.contains { $0.id == p.id }
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.name).font(.seed(.subheadline, .bold))
                        Text([Copy.category(p.category),
                              p.rating.map { "★ \($0.formatted(.number.precision(.fractionLength(1))))" } ?? String(localized: "Unrated"),
                              p.distanceM.map(Copy.distance)].compactMap { $0 }.joined(separator: " · "))
                            .font(.seed(.footnote)).foregroundStyle(Theme.ink2)
                    }
                    Spacer(minLength: 0)
                    Button(added ? String(localized: "Added") : String(localized: "Add")) {
                        model.picks.append(PickedPlace(id: p.id, name: p.name))
                    }
                    .font(.seed(.subheadline, .bold)).buttonStyle(.bordered).tint(Theme.indigo)
                    .disabled(added || model.picks.count >= Self.maxPicks)
                }
                Divider()
            }
            if !model.picks.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(model.picks, id: \.self) { pick in
                        Button { model.picks.removeAll { $0 == pick } } label: {
                            Label(pick.name, systemImage: "xmark").labelStyle(.titleAndIcon)
                                .font(.seed(.caption, .bold)).padding(.horizontal, 10).padding(.vertical, 5)
                                .background(Theme.indigoSoft, in: Capsule()).foregroundStyle(Theme.indigo)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove \(pick.name)")
                    }
                }
            }
            Text("Up to 3 places. They go into every plan when they fit your time and opening hours.")
                .font(.seed(.footnote)).foregroundStyle(Theme.ink2)
        }
    }

    private func kindChip(_ k: PlaceKind?, _ label: String) -> some View {
        let on = kind == k
        return Button {
            kind = k
            if k != nil || query.count >= 2 { Task { await search() } }
        } label: {
            Text(label).font(.seed(.subheadline, on ? .bold : .regular))
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(on ? Theme.indigoSoft : Theme.card, in: Capsule())
                .overlay(Capsule().stroke(on ? Theme.indigo.opacity(0.5) : Color.secondary.opacity(0.25)))
                .foregroundStyle(on ? Theme.indigo : Color.primary)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func search() async {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard text.count >= 2 || kind != nil else {
            message = String(localized: "Type a name (e.g. waterfall, วัด) or pick a kind."); return
        }
        busy = true; message = nil
        defer { busy = false }
        do {
            results = try await Backend.searchPlaces(text, near: model.origin, kind: kind)
            if results.isEmpty {
                message = text.isEmpty ? String(localized: "None of that kind within 30 km of your start.") : String(localized: "No places match that name nearby.")
            }
        } catch {
            message = String(localized: "Search is unavailable right now. Try again in a moment.")
        }
    }
}
