import Foundation
import Supabase

/// The shared Supabase backend (same project as the web and Android apps).
/// Only the publishable key ships; the server's Edge Functions do every write that matters.
enum Backend {
    static let client: SupabaseClient = {
        let info = Bundle.main.infoDictionary
        let host = info?["SupabaseHost"] as? String ?? ""
        let key = info?["SupabaseKey"] as? String ?? ""
        return SupabaseClient(supabaseURL: URL(string: "https://\(host)")!, supabaseKey: key,
                              options: .init(auth: .init(redirectToURL: Account.redirect, emitLocalSessionAsInitialSession: true)))
    }()

    /// Anyone can try the app instantly with an anonymous account.
    @discardableResult
    static func ensureSession() async throws -> UUID {
        if let user = client.auth.currentUser { return user.id }
        return try await client.auth.signInAnonymously().user.id
    }

    static func planRoute(_ request: PlanRequest) async throws -> RoutePlan {
        try await call("plan-route", request)
    }

    static func uploadSelfie(_ jpeg: Data) async throws -> String {
        let uid = try await ensureSession()
        let path = "\(uid.uuidString.lowercased())/\(Int(Date().timeIntervalSince1970 * 1000)).jpg"
        try await client.storage.from("selfies").upload(path, data: jpeg, options: FileOptions(contentType: "image/jpeg"))
        return path
    }

    static func verifyCheckin(_ request: CheckinRequest) async throws -> CheckinResult {
        try await call("verify-checkin", request)
    }

    /// Resolves a scanned sticker to the place it belongs to (public RPC; the code itself is checked at check-in).
    static func place(for scan: ShopScan) async throws -> CheckinTarget {
        var place = try await place(id: scan.placeId)
        place.qrCode = scan.code
        return place
    }

    static func place(id: Int) async throws -> CheckinTarget {
        try await ensureSession()
        let rows: [CheckinTarget] = try await client.rpc("place_for_checkin", params: ["p_id": id]).execute().value
        guard let place = rows.first else { throw APIError(code: "place_not_found") }
        return place
    }

    static func applePlus(jws: String) async throws {
        struct Out: Decodable { let plus_until: String? }
        let _: Out = try await call("apple-plus", ["jws": jws])
    }

    static func deleteAccount() async throws {
        try await ensureSession()
        // an Apple account confirms once more, for a fresh code the server uses to revoke Apple's token
        let viaApple = client.auth.currentUser?.identities?.contains { $0.provider == "apple" } ?? false
        let code = viaApple ? try await AppleReauth.authorizationCode() : ""
        try await client.functions.invoke("delete-account", options: FunctionInvokeOptions(body: ["apple_authorization_code": code]))
        try? await client.auth.signOut()
    }

    static func passport() async throws -> (collections: [Collection], checkins: [CheckinRow], badges: Set<Int>) {
        try await ensureSession()
        async let collections: [Collection] = client.from("collections")
            .select("id, slug, name, description, required_count, collection_places(place_id)").order("id").execute().value
        async let checkins: [CheckinRow] = client.from("checkins")
            .select("id, place_id, status, rewarded, places(name)").order("created_at", ascending: false).limit(50).execute().value
        async let badges: [BadgeRow] = client.from("user_badges").select("collection_id").execute().value
        return try await (collections, checkins, Set(badges.map(\.collectionId)))
    }

    private static func call<Body: Encodable & Sendable, Out: Decodable>(_ name: String, _ body: Body) async throws -> Out {
        try await ensureSession()
        do {
            return try await client.functions.invoke(name, options: FunctionInvokeOptions(body: body))
        } catch let FunctionsError.httpError(_, data) {
            // the server answers { "error": "<code>" }; keep the code, never internals
            let code = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "server_error"
            throw APIError(code: code)
        }
    }
}

struct APIError: LocalizedError {
    let code: String
    var errorDescription: String? {
        switch code {
        case "demo_only_at_example_places": String(localized: "Simulated location only works at example partner places.")
        case let c where c.hasPrefix("bad_"): String(localized: "Pick a start and destination inside Thailand.")
        case "not_signed_in": String(localized: "Your session ended. Close and reopen the app.")
        case "place_not_found": String(localized: "This sticker isn't linked to a place any more.")
        default: String(localized: "Something went wrong. Try again in a moment.")
        }
    }
}
