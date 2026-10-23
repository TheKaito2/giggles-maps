import AuthenticationServices
import SwiftUI

/// Passport → Account: sign in (Apple, Google, email code), who you are, sign out.
struct AccountSection: View {
    @State private var account = Account.shared
    @State private var nonce = ""
    @State private var emailField = ""
    @State private var code = ""
    @State private var busy = false
    @State private var message: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Section("Account") {
            if account.isGuest {
                Text("You're a guest. Sign in to keep your stamps, coupons and Plus on every device.")
                    .font(.footnote).foregroundStyle(Theme.ink2)

                SignInWithAppleButton(.signIn) { request in
                    nonce = AppleNonce.make()
                    request.requestedScopes = [.email]
                    request.nonce = AppleNonce.sha256(nonce)
                } onCompletion: { result in
                    Task { await apple(result) }
                }
                .signInWithAppleButtonStyle(scheme == .dark ? .white : .black)
                .frame(height: 46)
                .listRowSeparator(.hidden)

                Button { run { try await account.signInWithGoogle() } } label: {
                    Label("Continue with Google", systemImage: "g.circle")
                        .frame(maxWidth: .infinity).padding(.vertical, 6)
                }

                if let pending = account.pendingEmail {
                    Text("Enter the 6-digit code we sent to \(pending).").font(.footnote)
                    TextField("123456", text: $code)
                        .keyboardType(.numberPad).textContentType(.oneTimeCode).font(Theme.data)
                    HStack {
                        Button("Verify code") { run { try await account.verifyEmailCode(code); code = "" } }
                            .disabled(code.count < 6)
                        Spacer()
                        Button("Use another email", role: .cancel) { account.cancelEmail() }.font(.footnote)
                    }
                } else {
                    TextField("Email", text: $emailField)
                        .keyboardType(.emailAddress).textContentType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Email me a sign-in code") { run { try await account.sendEmailCode(emailField) } }
                        .disabled(emailField.isEmpty)
                }
            } else {
                LabeledContent("Signed in", value: account.email ?? String(localized: "Apple account"))
                if !account.providers.isEmpty {
                    LabeledContent("With", value: account.providers.map { $0.capitalized }.joined(separator: ", "))
                }
                Button("Sign out") { Task { await account.signOut() } }
            }

            if busy { ProgressView() }
            if let message { Text(message).font(.footnote).foregroundStyle(Theme.bad) }
        }
    }

    private func apple(_ result: Result<ASAuthorization, Error>) async {
        switch result {
        case .success(let auth):
            guard let credential = auth.credential as? ASAuthorizationAppleIDCredential,
                  let token = credential.identityToken.flatMap({ String(data: $0, encoding: .utf8) }) else { return }
            run { try await account.signInWithApple(idToken: token, nonce: nonce) }
        case .failure(let error):
            if (error as? ASAuthorizationError)?.code != .canceled { message = error.localizedDescription }
        }
    }

    private func run(_ work: @escaping @MainActor () async throws -> Void) {
        busy = true; message = nil
        Task {
            defer { busy = false }
            do { try await work() }
            catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin { }
            catch is CancellationError { }
            catch { message = (error as? LocalizedError)?.errorDescription ?? String(localized: "Sign-in didn't work. Try again.") }
        }
    }
}
