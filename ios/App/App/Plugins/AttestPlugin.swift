import Capacitor
import CryptoKit
import DeviceCheck

/// App Attest: proves a check-in came from this app on a real iPhone. The web code talks to the server (Edge Function
/// app-attest) and keeps the key id; this plugin only does what needs the Secure Enclave. Not available in the
/// Simulator: `supported` is false there and the check-in goes without it.
@objc(AttestPlugin)
public class AttestPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AttestPlugin"
    public let jsName = "Attest"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "supported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generateKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "attestKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "assert", returnType: CAPPluginReturnPromise),
    ]
    private var service: DCAppAttestService { .shared }
    private func hash(_ s: String) -> Data { Data(SHA256.hash(data: Data(s.utf8))) }

    @objc func supported(_ call: CAPPluginCall) { call.resolve(["supported": service.isSupported]) }

    @objc func generateKey(_ call: CAPPluginCall) {
        Task {
            do { call.resolve(["keyId": try await service.generateKey()]) } catch { call.reject("attest_unavailable", nil, error) }
        }
    }

    /// Attest a new key against the server's challenge (sent back to app-attest "register").
    @objc func attestKey(_ call: CAPPluginCall) {
        guard let keyId = call.getString("keyId"), let challenge = call.getString("challenge") else { return call.reject("bad_args") }
        Task {
            do { call.resolve(["attestation": try await service.attestKey(keyId, clientDataHash: hash(challenge)).base64EncodedString()]) }
            catch { call.reject("attest_failed", nil, error) }
        }
    }

    /// Sign the check-in's key fields ("placeId|lat|lng|selfiePath", built the same way by the server).
    @objc func assert(_ call: CAPPluginCall) {
        guard let keyId = call.getString("keyId"), let data = call.getString("data") else { return call.reject("bad_args") }
        Task {
            do { call.resolve(["assertion": try await service.generateAssertion(keyId, clientDataHash: hash(data)).base64EncodedString()]) }
            catch { call.reject("assert_failed", nil, error) }
        }
    }
}
