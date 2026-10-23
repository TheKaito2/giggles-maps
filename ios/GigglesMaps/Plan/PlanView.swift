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
            map.frame(height: 260)
            ScrollViewReader { proxy in
                ScrollView { panel.padding(16) }
                    .onChange(of: selected) { _, id in withAnimation { proxy.scrollTo(id, anchor: .center) } }
                    .onChange(of: model.plan?.routeId) { _, id in if id != nil { withAnimation { proxy.scrollTo("results", anchor: .top) } } }
            }
            .background(LinearGradient(colors: [Theme.indigoSoft.opacity(0.6), Theme.paper, Theme.marigoldSoft.opacity(0.35)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing))
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
                if let plan = model.shown {
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
        .onChange(of: model.choice) { fitRoute() }
        .onChange(of: model.origin) { fitRoute() }   // a searched start or destination may be far away
        .onChange(of: model.dest) { fitRoute() }
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Label("Sakon Nakhon, Thailand", systemImage: "mappin").font(.seed(.footnote)).foregroundStyle(Theme.ink2)
                Text("Plan your detour").font(Theme.display(32)).foregroundStyle(Theme.indigo).accessibilityAddTraits(.isHeader)
                Text("Discover something worth the extra time.").font(.seed(.subheadline)).foregroundStyle(Theme.ink2)
            }
            if QRScanner.isAvailable {
                Button { showScanner = true } label: {
                    Label("Scan a shop's QR sticker", systemImage: "qrcode.viewfinder").font(.seed(.subheadline, .bold))
                }
                .tint(Theme.indigo)
            }
            // results sit above the form once there are some, so they're what you see after Find
            PlanResults(model: model, checkinTarget: $checkinTarget, selected: selected, trip: trip).id("results")
            PlanForm(model: model)
        }
    }

    private func fitRoute() {
        let line = model.shown?.line ?? []
        let points = line.isEmpty ? [model.origin, model.dest].compactMap { $0?.coordinate } : line
        guard let first = points.first else { return }
        var rect = MKMapRect(origin: MKMapPoint(first), size: .init(width: 0, height: 0))
        for p in points { rect = rect.union(MKMapRect(origin: MKMapPoint(p), size: .init(width: 0, height: 0))) }
        withAnimation { camera = .rect(rect.insetBy(dx: -rect.width * 0.2 - 300, dy: -rect.height * 0.2 - 300)) }
    }
}
