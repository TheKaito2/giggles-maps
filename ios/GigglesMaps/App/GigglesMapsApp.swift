import SwiftUI

@main
struct GigglesMapsApp: App {
    @State private var refreshKey = 0

    var body: some Scene {
        WindowGroup {
            TabView {
                Tab("Plan", systemImage: "map") {
                    PlanView(onCheckedIn: { refreshKey += 1 })
                }
                Tab("Passport", systemImage: "book.closed") {
                    PassportView(refreshKey: refreshKey)
                }
            }
            .tint(Theme.indigo)
            .task { try? await Backend.ensureSession() }   // start a guest session early; calls retry it anyway
        }
    }
}
