import SwiftUI
import UserNotifications

/// Shows the "You're at <stop>" banner even while the app is open; a tap opens check-in for that stop.
final class NotificationRelay: NSObject, UNUserNotificationCenterDelegate {
    static let tappedPlace = Notification.Name("giggles.tappedPlace")

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        if let id = response.notification.request.content.userInfo["place_id"] as? Int {
            await MainActor.run { NotificationCenter.default.post(name: Self.tappedPlace, object: id) }
        }
    }
}

@main
struct GigglesMapsApp: App {
    @State private var refreshKey = 0
    @State private var checkinTarget: CheckinTarget?
    @State private var scanError: String?
    private let purchases = Plus.listen()   // renewals and refunds while the app runs
    private let relay: NotificationRelay = {
        let relay = NotificationRelay()
        UNUserNotificationCenter.current().delegate = relay
        return relay
    }()

    var body: some Scene {
        WindowGroup {
            TabView {
                Tab("Plan", systemImage: "map") {
                    PlanView(checkinTarget: $checkinTarget, onCheckedIn: { refreshKey += 1 }, onScan: open)
                }
                Tab("Passport", systemImage: "book.closed") {
                    PassportView(refreshKey: refreshKey)
                }
            }
            .tint(Theme.indigo)
            .task { try? await Backend.ensureSession() }   // start a guest session early; calls retry it anyway
            // a shop's QR sticker opened from the Camera app (universal link) lands here too
            .onOpenURL { open($0) }
            .onReceive(NotificationCenter.default.publisher(for: NotificationRelay.tappedPlace)) { note in
                guard let id = note.object as? Int else { return }
                Task { checkinTarget = try? await Backend.place(id: id) }
            }
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                if let url = activity.webpageURL { open(url) }
            }
            .alert("Couldn't open that sticker", isPresented: .constant(scanError != nil)) {
                Button("OK") { scanError = nil }
            } message: { Text(scanError ?? "") }
        }
    }

    private func open(_ url: URL) {
        guard let scan = ShopScan(url) else { return }
        Task {
            do { checkinTarget = try await Backend.place(for: scan) }
            catch { scanError = error.localizedDescription }
        }
    }
}
