import AuthenticationServices
import CryptoKit
import Foundation
import Observation
import Supabase

/// Who is signed in. Everyone starts as a guest (anonymous); signing in links Apple / Google / email to that same
/// guest account so stamps and coupons stay. If the identity already belongs to an account, we sign into that one
/// instead (same rule as web/src/lib/auth.ts).
@MainActor
@Observable
final class Account {
    static let shared = Account()
    nonisolated static let redirect = URL(string: "giggles://auth-callback")!

    private(set) var userId: UUID?
    private(set) var isGuest = true
    private(set) var email: String?
    private(set) var providers: [String] = []
    /// set after an email code was sent; the UI shows the code field
    private(set) var pendingEmail: String?
    private var pendingType: EmailOTPType = .email

    private var auth: AuthClient { Backend.client.auth }

    private init() {
        Task { [weak self] in
            for await (_, session) in Backend.client.auth.authStateChanges { self?.apply(session?.user) }
        }
    }

    private func apply(_ user: User?) {
        userId = user?.id
        isGuest = user?.isAnonymous ?? true
        email = user?.email
        providers = (user?.identities ?? []).map(\.provider).filter { $0 != "anonymous" }
    }

    // MARK: Apple (native sheet + nonce, so a captured token can't be replayed)

    func signInWithApple(idToken: String, nonce: String) async throws {
        let credentials = OpenIDConnectCredentials(provider: .apple, idToken: idToken, nonce: nonce)
        if isGuest, auth.currentUser != nil {
            do { _ = try await auth.linkIdentityWithIdToken(credentials: credentials); return }
            catch where Self.alreadyLinked(error) { /* fall through: sign into the owner */ }
        }
        _ = try await auth.signInWithIdToken(credentials: credentials)
    }

    // MARK: Google (system web sheet; no Google SDK)

    func signInWithGoogle() async throws {
        if isGuest, auth.currentUser != nil {
            let link = try await auth.getLinkIdentityURL(provider: .google, redirectTo: Self.redirect)
            let callback = try await WebAuth.run(link.url)
            if Self.query(callback, "error_code") != "identity_already_exists" {
                if let message = Self.query(callback, "error_description") { throw AccountError(message) }
                _ = try await auth.session(from: callback)
                return
            }
        }
        _ = try await auth.signInWithOAuth(provider: .google, redirectTo: Self.redirect) { session in
            session.prefersEphemeralWebBrowserSession = true   // always show the account picker
        }
    }

    // MARK: Email (6-digit code from the email; the link in it works on web)

    func sendEmailCode(_ address: String) async throws {
        let email = address.trimmingCharacters(in: .whitespaces).lowercased()
        guard email.contains("@"), email.contains(".") else { throw AccountError(String(localized: "Enter a valid email address.")) }
        if isGuest, auth.currentUser != nil {
            do {
                _ = try await auth.update(user: UserAttributes(email: email), redirectTo: Self.redirect)
                pendingEmail = email; pendingType = .emailChange
                return
            } catch where Self.emailTaken(error) { /* that email has an account: sign into it */ }
        }
        try await auth.signInWithOTP(email: email, redirectTo: Self.redirect)
        pendingEmail = email; pendingType = .email
    }

    func verifyEmailCode(_ code: String) async throws {
        guard let email = pendingEmail else { return }
        _ = try await auth.verifyOTP(email: email, token: code.trimmingCharacters(in: .whitespaces), type: pendingType)
        pendingEmail = nil
        if let user = try? await auth.user() { apply(user) }   // email change doesn't always emit an event
    }

    func cancelEmail() { pendingEmail = nil }

    func signOut() async {
        try? await auth.signOut()
        try? await Backend.ensureSession()   // back to a fresh guest so the app keeps working
    }

    // MARK: helpers

    private static func alreadyLinked(_ error: Error) -> Bool {
        (error as? AuthError)?.errorCode == .identityAlreadyExists || "\(error)".contains("identity_already_exists")
    }

    private static func emailTaken(_ error: Error) -> Bool {
        (error as? AuthError)?.errorCode == .emailExists || "\(error)".localizedCaseInsensitiveContains("already")
    }

    private static func query(_ url: URL, _ name: String) -> String? {
        let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let fragment = URLComponents(string: "?" + (parts?.fragment ?? ""))
        return (parts?.queryItems ?? []).first { $0.name == name }?.value
            ?? (fragment?.queryItems ?? []).first { $0.name == name }?.value
    }
}

struct AccountError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

/// A fresh random nonce for Sign in with Apple, and its SHA-256 for the request.
enum AppleNonce {
    static func make() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return UUID().uuidString + UUID().uuidString }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    static func sha256(_ nonce: String) -> String {
        SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// Runs one ASWebAuthenticationSession and returns the giggles:// callback URL.
@MainActor
enum WebAuth {
    private final class Anchor: NSObject, ASWebAuthenticationPresentationContextProviding {
        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
        }
    }

    static func run(_ url: URL) async throws -> URL {
        let anchor = Anchor()
        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callback: .customScheme("giggles")) { callback, error in
                if let callback { continuation.resume(returning: callback) }
                else { continuation.resume(throwing: error ?? CocoaError(.userCancelled)) }
            }
            session.presentationContextProvider = anchor
            session.prefersEphemeralWebBrowserSession = true
            session.start()
            objc_setAssociatedObject(session, "anchor", anchor, .OBJC_ASSOCIATION_RETAIN)
        }
    }
}

/// One extra Sign in with Apple prompt, for the authorization code the server needs to revoke Apple's token when
/// the account is deleted (App Store 5.1.1(v)).
@MainActor
final class AppleReauth: NSObject, ASAuthorizationControllerDelegate {
    private var continuation: CheckedContinuation<String, Error>?

    static func authorizationCode() async throws -> String {
        let reauth = AppleReauth()
        return try await withCheckedThrowingContinuation { continuation in
            reauth.continuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: [ASAuthorizationAppleIDProvider().createRequest()])
            controller.delegate = reauth
            controller.performRequests()
            objc_setAssociatedObject(controller, "reauth", reauth, .OBJC_ASSOCIATION_RETAIN)   // lives as long as the sheet
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        let code = (authorization.credential as? ASAuthorizationAppleIDCredential)?.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
        MainActor.assumeIsolated {
            if let code { continuation?.resume(returning: code) } else { continuation?.resume(throwing: CocoaError(.userCancelled)) }
            continuation = nil
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        MainActor.assumeIsolated {
            continuation?.resume(throwing: error)
            continuation = nil
        }
    }
}
