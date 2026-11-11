import { admin, json, serve } from "../_shared/http.ts";
import { LIFETIME_PRODUCT, MEMBERSHIP_PRODUCT, PLUS_PRODUCTS, TRIP_PASS_DAYS, TRIP_PASS_PRODUCT, verifyNotification,
  verifyTransaction } from "../_shared/apple.ts";

// App Store Server Notifications V2 (renewals, expiry, refunds). No user JWT (verify_jwt = false):
// trust comes from Apple's signature on the payload. Point App Store Connect's server URL here.
serve(async (req) => {
  const body = await req.json().catch(() => null);
  if (typeof body?.signedPayload !== "string") return json({ error: "bad_payload" }, 400);

  let note;
  try { note = await verifyNotification(body.signedPayload); }
  catch (e) { console.error("apple notification verify", e); return json({ error: "invalid_signature" }, 400); }

  const signedTx = note.data?.signedTransactionInfo;
  if (!signedTx) return json({ received: true });   // e.g. TEST notifications
  const tx = await verifyTransaction(signedTx);
  const ended = ["REFUND", "REVOKE", "EXPIRED"].includes(String(note.notificationType));
  if (!tx.appAccountToken || !tx.originalTransactionId) return json({ received: true });
  const revoked = tx.revocationDate ? new Date(tx.revocationDate).toISOString() : ended ? new Date().toISOString() : null;

  // one-time Lifetime / membership: only refunds and revokes matter
  if (tx.productId === MEMBERSHIP_PRODUCT || tx.productId === LIFETIME_PRODUCT) {
    const { error } = await admin().rpc("apply_apple_membership", {
      p_otid: tx.originalTransactionId, p_user: tx.appAccountToken.toLowerCase(), p_env: String(tx.environment),
      p_revoked: revoked, p_lifetime: tx.productId === LIFETIME_PRODUCT,
    });
    if (error) { console.error(error); return json({ error: "apply_failed" }, 500); }
    return json({ received: true });
  }

  const expires = tx.productId === TRIP_PASS_PRODUCT && tx.purchaseDate ? tx.purchaseDate + TRIP_PASS_DAYS * 86400_000
    : PLUS_PRODUCTS.has(tx.productId ?? "") ? tx.expiresDate : undefined;
  if (!expires) return json({ received: true });

  const { error } = await admin().rpc("apply_apple_plus", {
    p_otid: tx.originalTransactionId, p_user: tx.appAccountToken.toLowerCase(), p_product: tx.productId,
    p_env: String(tx.environment), p_expires: new Date(expires).toISOString(), p_revoked: revoked,
  });
  if (error) { console.error(error); return json({ error: "apply_failed" }, 500); }   // Apple retries
  return json({ received: true });
});
