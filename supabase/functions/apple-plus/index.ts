import { admin, HttpError, json, requireUser, serve } from "../_shared/http.ts";
import { MEMBERSHIP_PRODUCT, PLUS_PRODUCT, verifyTransaction } from "../_shared/apple.ts";

// The iOS app sends each signed StoreKit transaction after a purchase or restore. We verify it came from Apple
// and was bought for this account (appAccountToken = user id), then turn on what it bought:
//   membership (one-time) -> profiles.member_since
//   Plus (auto-renewing, cosmetic) -> profiles.plus_until
serve(async (req) => {
  const user = await requireUser(req);
  if (user.is_anonymous) throw new HttpError(403, "sign_in_required");   // purchases must survive a reinstall
  const body = await req.json().catch(() => { throw new HttpError(400, "bad_json"); });
  if (typeof body.jws !== "string" || body.jws.length > 20000) throw new HttpError(400, "bad_jws");

  const tx = await verifyTransaction(body.jws).catch((e) => { console.error("apple verify", e); throw new HttpError(400, "invalid_transaction"); });
  if (!tx.originalTransactionId) throw new HttpError(400, "invalid_transaction");
  if (tx.appAccountToken && tx.appAccountToken.toLowerCase() !== user.id) throw new HttpError(403, "bought_by_another_account");
  const revoked = tx.revocationDate ? new Date(tx.revocationDate).toISOString() : null;
  const db = admin();

  if (tx.productId === MEMBERSHIP_PRODUCT) {
    const { data, error } = await db.rpc("apply_apple_membership", {
      p_otid: tx.originalTransactionId, p_user: user.id, p_env: String(tx.environment), p_revoked: revoked,
    });
    if (error?.code === "P0001") throw new HttpError(409, "purchase_on_another_account");
    if (error) throw error;
    return json({ member_since: data });
  }

  if (tx.productId !== PLUS_PRODUCT || !tx.expiresDate) throw new HttpError(400, "wrong_product");
  const { data, error } = await db.rpc("apply_apple_plus", {
    p_otid: tx.originalTransactionId, p_user: user.id, p_product: tx.productId, p_env: String(tx.environment),
    p_expires: new Date(tx.expiresDate).toISOString(), p_revoked: revoked,
  });
  if (error?.code === "P0001") throw new HttpError(409, "subscription_on_another_account");
  if (error) throw error;
  return json({ plus_until: data });
});
