import SwiftUI

/// After "Find my detour": the plan picker ("Your mix" first), the time used, the stops and the trip buttons.
struct PlanResults: View {
    @Bindable var model: PlanModel
    @Binding var checkinTarget: CheckinTarget?
    var selected: Int?
    var trip: TripModel

    var body: some View {
        if let plan = model.shown {
            VStack(alignment: .leading, spacing: 14) {
                if let plans = model.plan?.plans, plans.count > 1 { planPicker(plans) }
                results(plan)
            }
            .glassCard()
        }
    }

    private func planPicker(_ plans: [ThemedPlan]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Pick a plan").font(.seed(.subheadline, .bold)).foregroundStyle(Theme.ink2)
            FlowLayout(spacing: 8) {
                    ForEach(plans) { p in
                        let on = model.choice == p.id
                        Button { model.choice = p.id } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(Copy.plan(p.id, fallback: p.name)).font(.seed(.subheadline, .bold))
                                Text("^[\(p.stops.count) stop](inflect: true) · +\(p.extraMin) min").font(.seed(.caption))
                            }
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .background(on ? Theme.indigo : Theme.indigoSoft, in: RoundedRectangle(cornerRadius: 12))
                            .foregroundStyle(on ? Theme.onIndigo : Theme.indigo)
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
            }
            if let unfit = plans.first(where: { $0.id == model.choice })?.unfitRequired, !unfit.isEmpty {
                let names = unfit.map { id in model.picks.first { $0.id == id }?.name ?? String(localized: "a place you picked") }
                Text("Couldn't fit \(names.formatted(.list(type: .and))) (too far, closed then, or over your stop limit). Try more time.")
                    .font(.seed(.footnote)).foregroundStyle(Theme.bad)
            }
            if let missed = plans.first(where: { $0.id == model.choice })?.missedMeals, !missed.isEmpty {
                Text("No food stop fits \(missed.map { Copy.meal($0) }.joined(separator: ", ")) on this plan.")
                    .font(.footnote).foregroundStyle(Theme.ink2)
            }
        }
    }

    @ViewBuilder
    private func results(_ plan: RoutePlan) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("+\(plan.extraMin)").font(.system(size: 30, weight: .semibold, design: .monospaced)).foregroundStyle(Theme.indigo)
                Text("of +\(plan.budgetMin) min used").font(.footnote).foregroundStyle(Theme.ink2)
            }
            Text("^[\(plan.stops.count) stop](inflect: true) · trip \(plan.totalMin) min instead of \(plan.baseMin)").font(.seed(.footnote)).foregroundStyle(Theme.ink2)
            if plan.routing == "estimate" {
                Text("Times are estimates (routing service busy).").font(.footnote).foregroundStyle(Theme.ink2)
            }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.indigoSoft, in: RoundedRectangle(cornerRadius: 14))

        if plan.stops.isEmpty {
            Text("Nothing fits in +\(plan.budgetMin) min. Give yourself a bit more time.").font(.footnote).foregroundStyle(Theme.ink2)
        }

        ForEach(Array(plan.stops.enumerated()), id: \.element.id) { i, stop in
            HStack(spacing: 12) {
                Pin(text: "\(i + 1)", color: stop.isPartner ? Theme.marigold : Theme.indigo, textColor: stop.isPartner ? .black : Theme.onIndigo)
                VStack(alignment: .leading, spacing: 2) {
                    Text(stop.name).font(.headline)
                    if let th = stop.nameTh, th != stop.name { Text(th).font(.footnote).foregroundStyle(Theme.ink2) }
                    HStack(spacing: 8) {
                        Text(Copy.hhmm(stop.etaMin)).font(.footnote.monospaced())
                        Text(Copy.category(stop.category))
                        Text("\(stop.dwellMin) min")
                    }
                    .font(.seed(.footnote)).foregroundStyle(Theme.ink2).lineLimit(1).minimumScaleFactor(0.85)
                    HStack(spacing: 6) {
                        Chip(text: stop.rating.map { "★ \($0.formatted(.number.precision(.fractionLength(1))))" } ?? String(localized: "Unrated")).fixedSize()
                        Chip(text: Copy.price(stop.priceLevel)).fixedSize()
                        if stop.picked == true { Chip(text: String(localized: "You picked this"), partner: true).fixedSize() }
                        if let meal = stop.meal { Chip(text: Copy.meal(meal)).fixedSize() }
                    }
                    if stop.isPartner { Chip(text: stop.isDemo ? String(localized: "Example partner") : String(localized: "Partner"), partner: true).fixedSize() }
                    if let lvl = stop.minLevel, lvl > 0 {
                        HStack(spacing: 6) {
                            Chip(text: Levels.kindName(stop.exclusiveKind)).fixedSize()
                            Chip(text: String(localized: "Level \(lvl)")).fixedSize()
                        }
                        if let perk = stop.perkText { Text(perk).font(.footnote).foregroundStyle(Theme.ink2) }
                    }
                }
                Spacer(minLength: 0)
                Button("Check in") { checkinTarget = CheckinTarget(stop) }
                    .font(.seed(.subheadline, .bold)).lineLimit(1).fixedSize()
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Theme.indigo, in: Capsule()).foregroundStyle(Theme.onIndigo)
            }
            .padding(12)
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(selected == stop.id ? Theme.indigo : Color.secondary.opacity(0.25), lineWidth: selected == stop.id ? 2 : 1))
            .id(stop.id)

            if let card = stop.nearbyPartner {
                HStack(spacing: 8) {
                    Image(systemName: "mappin.and.ellipse").foregroundStyle(Theme.marigold)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Near this spot: \(card.name)").font(.subheadline.weight(.semibold))
                        if let lvl = card.minLevel, lvl > 0 {
                            Text("\(Levels.kindName(card.exclusiveKind)) · Level \(lvl)").font(.caption.weight(.semibold)).foregroundStyle(Theme.marigold)
                        }
                        Text("\(Copy.category(card.category)) · \(card.distanceM) m away").font(.footnote).foregroundStyle(Theme.ink2)
                    }
                    Spacer(minLength: 0)
                    if card.isPartner ?? true {
                        Chip(text: card.isDemo ? String(localized: "Example partner") : String(localized: "Partner"), partner: true)
                    }
                    Button("Check in") { checkinTarget = CheckinTarget(card) }.font(.footnote.weight(.semibold))
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Theme.marigoldSoft.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
                .padding(.leading, 42)
            }
        }
        if !plan.stops.isEmpty {
            if trip.running {
                Button("End trip", role: .destructive) { Task { await trip.end() } }.frame(maxWidth: .infinity)
                Text("Trip running: next stop on your Lock Screen, and a nudge when you reach each stop.")
                    .font(.footnote).foregroundStyle(Theme.ink2)
            } else {
                Button("Start trip") { Task { await trip.start(plan, destination: String(localized: "your destination")) } }
                    .buttonStyle(PrimaryButtonStyle())
            }
        }


        if let thb = plan.expectedThb, thb > 0 {
            Text("Business view: partners on this route pay about ฿\(thb, specifier: "%.2f") in expected visit fees.")
                .font(.footnote).foregroundStyle(Theme.ink2)
                .padding(.leading, 10)
                .overlay(alignment: .leading) { Rectangle().fill(Theme.marigold).frame(width: 3) }
        }
    }

}
