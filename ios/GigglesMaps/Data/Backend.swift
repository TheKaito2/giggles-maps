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

    /// Once per launch: a stored session can belong to a user the server deleted (account deleted elsewhere, demo
    /// reset). Every call and every sign-in would then fail with "User from sub claim in JWT does not exist", so drop it.
    private static let dropDeletedUser = Task {
        guard client.auth.currentUser != nil else { return }
        do { _ = try await client.auth.user() }
        catch let error as AuthError where error.errorCode == .userNotFound || "\(error)".contains("sub claim") {
            try? await client.auth.signOut(scope: .local)
        } catch { /* offline or a server hiccup: keep the session */ }
    }

    /// Anyone can try the app instantly with an anonymous account.
    @discardableResult
    static func ensureSession() async throws -> UUID {
        await dropDeletedUser.value
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

    /// Any verified App Store transaction (membership or Plus); the server works out which it is.
    static func applePurchase(jws: String) async throws {
        struct Out: Decodable { let plus_until: String?; let member_since: String? }
        let _: Out = try await call("apple-plus", ["jws": jws])
    }

    static func profile() async throws -> Profile {
        let id = try await ensureSession()
        return try await client.from("profiles").select("member_since, xp, plus_until, cosmetics").eq("id", value: id).single().execute().value
    }

    static func exclusives() async throws -> [ExclusivePlace] {
        try await ensureSession()
        return try await client.rpc("my_exclusives").execute().value
    }

    /// Plus only (server checks). Pass nil to leave a field as it is.
    static func setCosmetics(theme: String? = nil, flair: String? = nil) async throws {
        try await ensureSession()
        var params: [String: String] = [:]
        if let theme { params["p_theme"] = theme }
        if let flair { params["p_flair"] = flair }
        try await client.rpc("set_cosmetics", params: params).execute()
    }

    /// Collects this month's Plus stamp (no-op without Plus); returns the months collected.
    static func monthlyStamps() async throws -> [Date] {
        try await ensureSession()
        _ = try? await client.rpc("claim_monthly_stamp").execute()
        struct Row: Decodable { let month: String }   // a SQL date, "2026-10-01"
        let rows: [Row] = try await client.from("plus_stamps").select("month").order("month", ascending: false).execute().value
        let day = DateFormatter()
        day.dateFormat = "yyyy-MM-dd"
        day.timeZone = TimeZone(identifier: "Asia/Bangkok")
        return rows.compactMap { day.date(from: $0.month) }
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
