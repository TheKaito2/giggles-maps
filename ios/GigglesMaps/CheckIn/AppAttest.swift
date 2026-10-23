import CryptoKit
import DeviceCheck
import Foundation

/// App Attest: proves a check-in came from this app on a real iPhone. The key is registered once per install
/// (Edge Function app-attest); each check-in carries an assertion over its key fields. The server logs the result
/// (attest_ok) and doesn't reject yet. Not supported in the Simulator: there we simply send nothing.
enum AppAttest {
    private static let keyDefaultsKey = "appAttest.keyId"
    private static var service: DCAppAttestService { .shared }

    /// JSON for `client.attest`, or nil when App Attest isn't available.
    static func assertion(placeId: Int, lat: Double, lng: Double, selfiePath: String) async -> String? {
        guard service.isSupported, let keyId = try? await registeredKey() else { return nil }
        let data = "\(placeId)|\(js(lat))|\(js(lng))|\(selfiePath)"
        guard let assertion = try? await service.generateAssertion(keyId, clientDataHash: Data(SHA256.hash(data: Data(data.utf8))))
        else { return nil }
        let payload = ["key_id": keyId, "assertion": assertion.base64EncodedString()]
        return (try? JSONSerialization.data(withJSONObject: payload)).flatMap { String(data: $0, encoding: .utf8) }
    }

    private static func registeredKey() async throws -> String {
        if let saved = UserDefaults.standard.string(forKey: keyDefaultsKey) { return saved }
        let keyId = try await service.generateKey()
        struct Challenge: Decodable { let challenge: String }
        let challenge: Challenge = try await Backend.client.functions.invoke("app-attest",
            options: .init(body: ["action": "challenge"]))
        let attestation = try await service.attestKey(keyId, clientDataHash: Data(SHA256.hash(data: Data(challenge.challenge.utf8))))
        try await Backend.client.functions.invoke("app-attest", options: .init(body: [
            "action": "register", "key_id": keyId, "challenge": challenge.challenge, "attestation": attestation.base64EncodedString(),
        ]))
        UserDefaults.standard.set(keyId, forKey: keyDefaultsKey)
        return keyId
    }

    /// Numbers printed the way JavaScript prints them (the server rebuilds the same string): 17 not 17.0.
    static func js(_ value: Double) -> String {
        value == value.rounded() && abs(value) < 1e15 ? String(Int(value)) : "\(value)"
    }
}
