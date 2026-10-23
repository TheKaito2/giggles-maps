import MapKit
import SwiftUI

/// Pick a start or destination by name: our own places first (search_places), then Apple Maps addresses
/// as you type (MKLocalSearchCompleter, free on device). Pins and "Use my location" stay on the form.
struct LocationSearchSheet: View {
    let title: LocalizedStringKey
    var near: LatLng?
    let onPick: (LatLng, String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var ours: [FoundPlace] = []
    @State private var completer = AddressCompleter()
    @State private var message: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            List {
                if !ours.isEmpty {
                    Section("Giggles places") {
                        ForEach(ours) { p in
                            Button { choose(p.point, p.name) } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(p.name).font(.seed(.body, .bold))
                                    Text(Copy.category(p.category) + (p.distanceM.map { " · " + Copy.distance($0) } ?? ""))
                                        .font(.seed(.footnote)).foregroundStyle(Theme.ink2)
                                }
                            }
                            .tint(.primary)
                        }
                    }
                }
                if !completer.results.isEmpty {
                    Section("Addresses (Apple Maps)") {
                        ForEach(completer.results, id: \.self) { c in
                            Button { Task { await resolve(c) } } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(c.title).font(.seed(.body))
                                    if !c.subtitle.isEmpty { Text(c.subtitle).font(.seed(.footnote)).foregroundStyle(Theme.ink2) }
                                }
                            }
                            .tint(.primary)
                        }
                    }
                }
                if let message { Text(message).font(.seed(.footnote)).foregroundStyle(Theme.ink2) }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: Text("Place or address"))
            .searchFocused($focused)
            .onAppear { focused = true }
            .task(id: query) {
                completer.update(query, near: near)
                guard query.trimmingCharacters(in: .whitespaces).count >= 2 else { ours = []; return }
                try? await Task.sleep(for: .milliseconds(300))   // wait for typing to pause
                ours = (try? await Backend.searchPlaces(query, near: near)) ?? []
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func choose(_ point: LatLng, _ name: String) {
        onPick(point, name)
        dismiss()
    }

    private func resolve(_ completion: MKLocalSearchCompletion) async {
        do {
            let response = try await MKLocalSearch(request: MKLocalSearch.Request(completion: completion)).start()
            guard let item = response.mapItems.first else { message = String(localized: "Couldn't find that address."); return }
            choose(LatLng(item.location.coordinate), completion.title)
        } catch {
            message = String(localized: "Couldn't find that address. Try another name or set a pin on the map.")
        }
    }
}

/// MKLocalSearchCompleter wrapped for SwiftUI, biased to Thailand (or around `near`).
@MainActor @Observable
final class AddressCompleter: NSObject, MKLocalSearchCompleterDelegate {
    var results: [MKLocalSearchCompletion] = []
    private let completer = MKLocalSearchCompleter()

    override init() {
        super.init()
        completer.delegate = self
        completer.resultTypes = [.address, .pointOfInterest]
        completer.regionPriority = .required   // Thailand only; `near` just orders the results
    }

    func update(_ query: String, near: LatLng?) {
        completer.region = MKCoordinateRegion(center: .init(latitude: 13.0, longitude: 101.0), span: .init(latitudeDelta: 15, longitudeDelta: 9))
        if query.trimmingCharacters(in: .whitespaces).count < 2 { results = []; completer.cancel(); return }
        completer.queryFragment = query
    }

    // MapKit calls the delegate on the main thread (the completer was created there).
    nonisolated func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
        MainActor.assumeIsolated { self.results = Array(self.completer.results.prefix(8)) }
    }

    nonisolated func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: any Error) {
        MainActor.assumeIsolated { self.results = [] }
    }
}
