import SwiftUI

/// The planner form, after the web mockup: Your journey, Time for discovery, What draws you in?,
/// Make it your kind of detour, then the "Your little adventure" summary with the Find button.
/// Every control maps to a plan-route field; nothing here is decoration.
struct PlanForm: View {
    @Bindable var model: PlanModel
    @State private var searching: PlanModel.Picking?

    private static let quickTimes = [15, 30, 45, 60]
    private static let ratings: [Double] = [0, 3.5, 4, 4.5]
    private static let prices: [Int?] = [nil, 0, 1, 2, 3]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            journey
                .sheet(item: $searching) { which in
                    LocationSearchSheet(title: which == .origin ? "Start" : "Destination",
                                        near: which == .origin ? model.dest : model.origin) { point, name in
                        if which == .origin { (model.origin, model.originName) = (point, name) }
                        else { (model.dest, model.destName) = (point, name) }
                    }
                }
            time
            interests
            explore
            preferences
            summary
        }
    }

    // MARK: sections

    private var journey: some View {
        section("Your journey", icon: "mappin.circle") {
            pointRow(label: "Start", name: model.originName, pin: Pin(text: "A", color: Theme.good)) {
                Button("Search") { searching = .origin }
                Button("Map") { model.picking = .origin }
                Button("My location") { Task { await model.useMyLocation() } }
            }
            pointRow(label: "Destination", name: model.destName, pin: Pin(text: "B", color: Theme.stamp)) {
                Button("Search") { searching = .dest }
                Button("Map") { model.picking = .dest }
            }
            label("Travel by")
            Picker("Travel by", selection: $model.mode) {
                ForEach([TravelMode.pedestrian, .auto, .bicycle], id: \.self) { Text(Copy.mode($0)).tag($0) }
            }
            .pickerStyle(.segmented)
            HStack {
                label("Depart")
                Spacer()
                DatePicker("Depart", selection: $model.leaveAt, displayedComponents: .hourAndMinute).labelsHidden()
            }
        }
    }

    private var time: some View {
        section("Time for discovery", icon: "clock") {
            HStack(alignment: .firstTextBaseline) {
                Text("How much extra time do you have?").font(.seed(.subheadline)).foregroundStyle(Theme.ink2)
                Spacer()
                Text("\(Int(model.budget))").font(.seed(size: 34, .heavy, relativeTo: .title)).foregroundStyle(Theme.indigo)
                Text("min").font(.seed(.footnote)).foregroundStyle(Theme.ink2)
            }
            Slider(value: $model.budget, in: 15...Double(model.plan?.maxBudgetMin ?? 240), step: 5).tint(Theme.indigo)
                .accessibilityLabel("Extra time")
                .accessibilityValue("\(Int(model.budget)) minutes")
            HStack(spacing: 8) {
                ForEach(Self.quickTimes, id: \.self) { m in
                    pill(m == 60 ? String(localized: "1 hour") : String(localized: "\(m) min"), on: Int(model.budget) == m) { model.budget = Double(m) }
                }
            }
            Label("Includes extra travel and time spent at your stops.", systemImage: "clock")
                .font(.seed(.footnote)).foregroundStyle(Theme.ink2)
        }
    }

    private var interests: some View {
        section("What draws you in?", icon: "sparkles") {
            Text("Choose more than one").font(.seed(.footnote)).foregroundStyle(Theme.ink2)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 10)], spacing: 10) {
                ForEach(Interest.allCases, id: \.self) { i in
                    tile(Copy.interest(i), symbol: Self.symbol(i), on: model.interests.contains(i)) {
                        if model.interests.contains(i) { model.interests.remove(i) } else { model.interests.insert(i) }
                    }
                }
                tile(String(localized: "Surprise me"), symbol: "sparkles", on: model.interests.isEmpty, surprise: true) { model.interests = [] }
            }
        }
    }

    private var explore: some View {
        section("Places you want to visit", icon: "safari") { ExplorePlaces(model: model) }
    }

    private var preferences: some View {
        section("Make it your kind of detour", icon: "slider.horizontal.3") {
            label("Minimum rating")
            HStack(spacing: 8) {
                ForEach(Self.ratings, id: \.self) { r in
                    pill(r == 0 ? String(localized: "Any") : "★ \(r.formatted(.number.precision(.fractionLength(1))))+", on: model.minRating == r) { model.minRating = r }
                }
            }
            label("Spending per stop")
            HStack(spacing: 8) {
                ForEach(Self.prices, id: \.self) { p in
                    pill(p.map { Copy.price($0) } ?? String(localized: "Any"), on: model.maxPrice == p) { model.maxPrice = p }
                }
            }
            Divider()
            HStack {
                Text("Number of stops")
                Spacer()
                Picker("Number of stops", selection: $model.maxStops) {
                    Text("Auto · best fit").tag(Int?.none)
                    ForEach(1...6, id: \.self) { n in Text("Up to \(n)").tag(Int?.some(n)) }
                }
                .tint(Theme.indigo)
            }
            Toggle("Rated places only", isOn: $model.ratedOnly).tint(Theme.indigo)
            Text("Most places don't have ratings yet; they're included but ranked below rated ones. Places with no listed price stay in.")
                .font(.seed(.footnote)).foregroundStyle(Theme.ink2)
        }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Your little adventure").font(.seed(.title3))
                Spacer()
                Image(systemName: "sparkles").foregroundStyle(Theme.ink2)
            }
            if !model.picks.isEmpty {
                fact("Must visit", model.picks.map(\.name).formatted(.list(type: .and)))
            }
            HStack {
                Text("Room for discovery").font(.seed(.subheadline)).foregroundStyle(Theme.ink2)
                Spacer()
                Text("+\(Int(model.budget))").font(.seed(.title2, .heavy)).foregroundStyle(Theme.indigo)
                Text("min").font(.seed(.footnote)).foregroundStyle(Theme.ink2)
            }
            .padding(14)
            .background(Theme.indigoSoft, in: .rect(cornerRadius: 14, style: .continuous))
            fact("Getting around", Copy.mode(model.mode))
            fact("Heading out", model.leaveAt.formatted(date: .omitted, time: .shortened))
            fact("Minimum rating", model.minRating == 0 ? String(localized: "Any") : "★ \(model.minRating.formatted(.number.precision(.fractionLength(1))))+")
            fact("Spending", model.maxPrice.map { Copy.price($0) } ?? String(localized: "Any budget"))
            fact("Stops", model.maxStops.map { String(localized: "Up to \($0)") } ?? String(localized: "Auto · best fit"))
            FlowTags(tags: (model.interests.isEmpty ? [String(localized: "Surprise me")] : Interest.allCases.filter(model.interests.contains).map(Copy.interest))
                     + (model.ratedOnly ? [String(localized: "Rated places only")] : []))
            Button {
                Task { await model.submit() }
            } label: {
                Label(model.busy ? String(localized: "Finding your detour…") : String(localized: "Find my detour"), systemImage: "arrow.right")
                    .labelStyle(TrailingIcon())
                    .font(.seed(.headline))
                    .frame(maxWidth: .infinity).padding(.vertical, 6)
            }
            .buttonStyle(.glassProminent).tint(Theme.indigo)
            .disabled(model.busy || model.origin == nil || model.dest == nil)
            if let error = model.error {
                Text(error).foregroundStyle(Theme.bad).font(.seed(.subheadline, .bold))
            }
            Button("Reset preferences") { model.reset() }
                .font(.seed(.footnote, .bold)).tint(Theme.indigo).frame(maxWidth: .infinity)
        }
        .glassCard()
    }

    // MARK: pieces

    private func section<Content: View>(_ title: LocalizedStringKey, icon: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.indigo)
                    .frame(width: 32, height: 32).background(Theme.indigoSoft, in: .rect(cornerRadius: 10, style: .continuous))
                Text(title).font(.seed(.title3)).accessibilityAddTraits(.isHeader)
            }
            content()
        }
        .glassCard()
    }

    private func label(_ text: LocalizedStringKey) -> some View {
        Text(text).font(.seed(.subheadline, .bold)).foregroundStyle(Theme.ink2)
    }

    private func pointRow<Actions: View>(label: LocalizedStringKey, name: String, pin: Pin, @ViewBuilder actions: () -> Actions) -> some View {
        HStack(alignment: .top, spacing: 12) {
            pin
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.seed(.footnote, .bold)).foregroundStyle(Theme.ink2)
                Text(name).font(.seed(.headline)).lineLimit(2)
                HStack(spacing: 14) { actions() }.font(.seed(.subheadline, .bold)).tint(Theme.indigo)
            }
            Spacer(minLength: 0)
        }
    }

    private func pill(_ text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).font(.seed(.subheadline, on ? .bold : .regular)).lineLimit(1).minimumScaleFactor(0.8)
                .padding(.horizontal, 10).padding(.vertical, 7)
                .frame(maxWidth: .infinity)
                .background(on ? Theme.indigoSoft : Theme.card, in: .rect(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(on ? Theme.indigo.opacity(0.5) : Color.secondary.opacity(0.25)))
                .foregroundStyle(on ? Theme.indigo : Color.primary)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func tile(_ text: String, symbol: String, on: Bool, surprise: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: symbol).font(.system(size: 20)).foregroundStyle(Theme.indigo)
                Text(text).font(.seed(.footnote, on ? .bold : .regular)).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, minHeight: 78)
            .background(on ? Theme.indigoSoft : (surprise ? Theme.marigoldSoft : Theme.card), in: .rect(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(on ? Theme.indigo : (surprise ? Theme.marigold : Color.secondary.opacity(0.25)), style: StrokeStyle(lineWidth: on ? 1.5 : 1, dash: surprise && !on ? [4, 3] : [])))
            .overlay(alignment: .topTrailing) {
                if on && !surprise { Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(Theme.indigo).padding(8) }
            }
            .foregroundStyle(on ? Theme.indigo : Color.primary)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func fact(_ key: LocalizedStringKey, _ value: String) -> some View {
        HStack {
            Text(key).foregroundStyle(Theme.ink2)
            Spacer()
            Text(value).font(.seed(.subheadline, .bold))
        }
        .font(.seed(.subheadline))
    }

    private static func symbol(_ i: Interest) -> String {
        switch i {
        case .food: "fork.knife"
        case .culture: "building.columns"
        case .nature: "leaf"
        case .cafes: "cup.and.saucer"
        case .shopping: "bag"
        case .landmarks: "camera.viewfinder"
        }
    }
}

/// Tags that wrap onto new lines instead of squeezing.
private struct FlowTags: View {
    let tags: [String]
    var body: some View {
        FlowLayout(spacing: 6) {
            ForEach(tags, id: \.self) { t in
                Text(t).font(.seed(.caption)).foregroundStyle(Theme.ink2)
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.3)))
            }
        }
    }
}

/// Lays children out in rows, wrapping instead of squeezing or scrolling sideways.
struct FlowLayout: Layout {
    var spacing: CGFloat
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        rows(proposal.width ?? .infinity, subviews).size
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (view, point) in zip(subviews, rows(bounds.width, subviews).points) {
            view.place(at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y), proposal: .unspecified)
        }
    }
    private func rows(_ width: CGFloat, _ subviews: Subviews) -> (size: CGSize, points: [CGPoint]) {
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, maxX: CGFloat = 0, points: [CGPoint] = []
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0 && x + s.width > width { x = 0; y += rowH + spacing; rowH = 0 }
            points.append(CGPoint(x: x, y: y))
            x += s.width + spacing; rowH = max(rowH, s.height); maxX = max(maxX, x - spacing)
        }
        return (CGSize(width: maxX, height: y + rowH), points)
    }
}

private struct TrailingIcon: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 8) { configuration.title; configuration.icon }
    }
}
