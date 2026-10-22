import CoreLocation

/// One fresh, accurate location fix (plus whether iOS thinks it was faked by software).
enum LocationFix {
    struct Fix: Sendable { let coordinate: CLLocationCoordinate2D; let accuracy: Double; let isSimulated: Bool }

    enum Failure: LocalizedError {
        case denied, timeout
        var errorDescription: String? {
            switch self {
            case .denied: String(localized: "We need your location to check in. Allow location access in Settings and try again.")
            case .timeout: String(localized: "Couldn't get a GPS fix. Move somewhere with open sky and try again.")
            }
        }
    }

    @MainActor
    static func current(timeout: Duration = .seconds(15)) async throws -> Fix {
        let manager = CLLocationManager()
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
        if [.denied, .restricted].contains(manager.authorizationStatus) { throw Failure.denied }

        return try await withThrowingTaskGroup(of: Fix?.self) { group in
            group.addTask {
                var best: Fix?
                for try await update in CLLocationUpdate.liveUpdates(.otherNavigation) {
                    if update.authorizationDenied { throw Failure.denied }
                    guard let loc = update.location else { continue }
                    let fix = Fix(coordinate: loc.coordinate, accuracy: loc.horizontalAccuracy,
                                  isSimulated: loc.sourceInformation?.isSimulatedBySoftware ?? false)
                    if best == nil || fix.accuracy < best!.accuracy { best = fix }
                    if fix.accuracy <= 25 { return fix }   // good enough, stop early
                }
                return best
            }
            group.addTask {
                try await Task.sleep(for: timeout)
                return nil
            }
            // first finisher wins; if the timer wins we fall back to the best fix so far (none = timeout)
            let first = try await group.next() ?? nil
            group.cancelAll()
            guard let fix = first else { throw Failure.timeout }
            return fix
        }
    }
}
