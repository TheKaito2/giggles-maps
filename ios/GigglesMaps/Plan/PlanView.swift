import MapKit
import SwiftUI

struct PlanView: View {
    @State private var model = PlanModel()
    @State private var camera: MapCameraPosition = .region(MKCoordinateRegion(
        center: .init(latitude: 17.163, longitude: 104.149), latitudinalMeters: 4200, longitudinalMeters: 4200))
    @Binding var checkinTarget: CheckinTarget?
    @State private var selected: Int?
    var onCheckedIn: () -> Void = {}
    var onScan: (URL) -> Void = { _ in }
    @State private var showScanner = false
    @State private var trip = TripModel.shared

    var body: some View {
        VStack(spacing: 0) {
            map.frame(maxHeight: .infinity)
            ScrollViewReader { proxy in
                ScrollView { panel.padding(16) }
                    .onChange(of: selected) { _, id in withAnimation { proxy.scrollTo(id, anchor: .center) } }
            }
            .frame(maxHeight: .infinity)
            .background(Theme.card)
        }
        .background(Theme.paper)
        .fullScreenCover(isPresented: $showScanner) {
            ZStack(alignment: .topTrailing) {
                QRScanner { url in showScanner = false; onScan(url) }.ignoresSafeArea()
                Button("Close") { showScanner = false }
                    .padding(10).background(.thinMaterial, in: Capsule()).padding()
            }
        }
        .sheet(item: $checkinTarget) { target in
            CheckInView(stop: target, onDone: {
                onCheckedIn()
                Task { await trip.checkedIn(placeId: target.id) }
            })
                .presentationDetents([.large])
        }
    }

    private var map: some View {
        MapReader { proxy in
            Map(position: $camera) {
                if let o = model.origin { Annotation("Start", coordinate: o.coordinate) { Pin(text: "A", color: Theme.good) } }
                if let d = model.dest { Annotation("Destination", coordinate: d.coordinate) { Pin(text: "B", color: Theme.stamp) } }
                if let plan = model.plan {
                    MapPolyline(coordinates: plan.line).stroke(Theme.indigo, style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round))
                    ForEach(Array(plan.stops.enumerated()), id: \.element.id) { i, stop in
                        Annotation(stop.name, coordinate: stop.coordinate) {
                            Pin(text: "\(i + 1)", color: stop.isPartner ? Theme.marigold : Theme.indigo,
                                textColor: stop.isPartner ? .black : Theme.onIndigo)
                                .onTapGesture { selected = stop.id }
                        }
                    }
                }
            }
            .onTapGesture { point in
                if model.picking != nil, let c = proxy.convert(point, from: .local) { model.pick(c) }
            }
            .overlay(alignment: .top) {
                if let picking = model.picking {
                    Text(picking == .origin ? "Tap the map to set your start." : "Tap the map to set your destination.")
                        .font(.subheadline.weight(.semibold))
                        .padding(10).background(Theme.marigoldSoft, in: RoundedRectangle(cornerRadius: 10))
                        .padding(.top, 8)
                }
            }
        }
        .onChange(of: model.plan?.routeId) { fitRoute() }
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: 14) {
            if QRScanner.isAvailable {
                Button { showScanner = true } label: {
                    Label("Scan a shop's QR sticker", systemImage: "qrcode.viewfinder").font(.subheadline.weight(.semibold))
                }
                .tint(Theme.indigo)
            }
            pointRow(label: "Start", pin: Pin(text: "A", color: Theme.good)) {
                Button("Set on map") { model.picking = .origin }
                Button("Use my location") { Task { await model.useMyLocation() } }
            }
            pointRow(label: "Destination", pin: Pin(text: "B", color: Theme.stamp)) {
                Button("Set on map") { model.picking = .dest }
            }

            HStack(alignment: .bottom, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Leaving at").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink2)
                    DatePicker("Leaving at", selection: $model.leaveAt, displayedComponents: .hourAndMinute).labelsHidden()
                }
                Spacer()
                Picker("Getting there by", selection: $model.mode) {
                    Text("Walk").tag(TravelMode.pedestrian)
                    Text("Drive").tag(TravelMode.auto)
                }
                .pickerStyle(.segmented).frame(maxWidth: 170)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("Extra time I'm OK with:").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink2)
                    Text("+\(Int(model.budget)) min").font(Theme.data)
                }
                Slider(value: $model.budget, in: 0...Double(model.plan?.maxBudgetMin ?? 240), step: 5).tint(Theme.marigold)
                    .accessibilityLabel("Extra time I'm OK with")
                    .accessibilityValue("\(Int(model.budget)) minutes")
            }

            Button {
                Task { await model.submit() }
            } label: {
                Text(model.busy ? "Finding detours…" : "Find my detours")
            }
            .buttonStyle(PrimaryButtonStyle(gold: true))
            .disabled(model.busy || model.origin == nil || model.dest == nil)

            if let error = model.error {
                Text(error).foregroundStyle(Theme.bad).font(.subheadline.weight(.semibold))
            }

            if let plan = model.plan { results(plan) }
        }
    }

    private func pointRow<Actions: View>(label: LocalizedStringKey, pin: Pin, @ViewBuilder actions: () -> Actions) -> some View {
        HStack(spacing: 12) {
            pin
            Text(label).font(.headline).frame(width: 96, alignment: .leading)
            HStack(spacing: 14) { actions() }.font(.subheadline.weight(.semibold)).tint(Theme.indigo)
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func results(_ plan: RoutePlan) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("+\(plan.extraMin)").font(.system(size: 30, weight: .semibold, design: .monospaced)).foregroundStyle(Theme.indigo)
                Text("of +\(plan.budgetMin) min used").font(.footnote).foregroundStyle(Theme.ink2)
            }
            Text("\(plan.stops.count) stops · trip \(plan.totalMin) min instead of \(plan.baseMin)").font(.footnote).foregroundStyle(Theme.ink2)
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
                    .font(.footnote).foregroundStyle(Theme.ink2).lineLimit(1)
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
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 14).padding(.vertical, 8)
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

    private func fitRoute() {
        guard let plan = model.plan else { return }
        let points = plan.line.isEmpty ? [model.origin, model.dest].compactMap { $0?.coordinate } : plan.line
        guard let first = points.first else { return }
        var rect = MKMapRect(origin: MKMapPoint(first), size: .init(width: 0, height: 0))
        for p in points { rect = rect.union(MKMapRect(origin: MKMapPoint(p), size: .init(width: 0, height: 0))) }
        withAnimation { camera = .rect(rect.insetBy(dx: -rect.width * 0.2 - 300, dy: -rect.height * 0.2 - 300)) }
    }
}
