import { admin, json } from "../_shared/http.ts";
import { PLUS_PRODUCT, verifyNotification, verifyTransaction } from "../_shared/apple.ts";

// App Store Server Notifications V2 (renewals, expiry, refunds). No user JWT (verify_jwt = false):
// trust comes from Apple's signature on the payload. Point App Store Connect's server URL here.
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await req.json().catch(() => null);
  if (typeof body?.signedPayload !== "string") return json({ error: "bad_payload" }, 400);

  let note;
  try { note = await verifyNotification(body.signedPayload); }
  catch (e) { console.error("apple notification verify", e); return json({ error: "invalid_signature" }, 400); }

  const signedTx = note.data?.signedTransactionInfo;
  if (!signedTx) return json({ received: true });   // e.g. TEST notifications
  const tx = await verifyTransaction(signedTx);
  if (tx.productId !== PLUS_PRODUCT || !tx.appAccountToken || !tx.originalTransactionId || !tx.expiresDate) return json({ received: true });

  const ended = ["REFUND", "REVOKE", "EXPIRED"].includes(String(note.notificationType));
  const { error } = await admin().rpc("apply_apple_plus", {
    p_otid: tx.originalTransactionId, p_user: tx.appAccountToken.toLowerCase(), p_product: tx.productId,
    p_env: String(tx.environment), p_expires: new Date(tx.expiresDate).toISOString(),
    p_revoked: tx.revocationDate ? new Date(tx.revocationDate).toISOString() : ended ? new Date().toISOString() : null,
  });
  if (error) { console.error(error); return json({ error: "apply_failed" }, 500); }   // Apple retries
  return json({ received: true });
});
