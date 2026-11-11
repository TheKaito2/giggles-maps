import { admin, HttpError, json, readJson, requireUser, serve } from "../_shared/http.ts";
import { LIFETIME_PRODUCT, MEMBERSHIP_PRODUCT, PLUS_PRODUCTS, TRIP_PASS_DAYS, TRIP_PASS_PRODUCT, verifyTransaction } from "../_shared/apple.ts";

// The iOS app sends each signed StoreKit transaction after a purchase or restore. We verify it came from Apple
// and was bought for this account (appAccountToken = user id), then turn on what it bought:
//   Lifetime / membership (one-time) -> profiles.member_since (Lifetime: plus_until forever too)
//   Plus yearly (auto-renewing) and the Trip Pass (7 days from purchase) -> profiles.plus_until
serve(async (req) => {
  const user = await requireUser(req);
  if (user.is_anonymous) throw new HttpError(403, "sign_in_required");   // purchases must survive a reinstall
  const body = await readJson(req);
  if (typeof body.jws !== "string" || body.jws.length > 20000) throw new HttpError(400, "bad_jws");

  const tx = await verifyTransaction(body.jws).catch((e) => { console.error("apple verify", e); throw new HttpError(400, "invalid_transaction"); });
  if (!tx.originalTransactionId) throw new HttpError(400, "invalid_transaction");
  if (tx.appAccountToken && tx.appAccountToken.toLowerCase() !== user.id) throw new HttpError(403, "bought_by_another_account");
  const revoked = tx.revocationDate ? new Date(tx.revocationDate).toISOString() : null;
  const db = admin();

  if (tx.productId === MEMBERSHIP_PRODUCT || tx.productId === LIFETIME_PRODUCT) {
    const { data, error } = await db.rpc("apply_apple_membership", {
      p_otid: tx.originalTransactionId, p_user: user.id, p_env: String(tx.environment), p_revoked: revoked,
      p_lifetime: tx.productId === LIFETIME_PRODUCT,
    });
    if (error?.code === "P0001") throw new HttpError(409, "purchase_on_another_account");
    if (error) throw error;
    return json({ member_since: data });
  }

  // a Trip Pass has no expiry from Apple (non-renewing): it lasts 7 days from when it was bought
  const expires = tx.productId === TRIP_PASS_PRODUCT && tx.purchaseDate ? tx.purchaseDate + TRIP_PASS_DAYS * 86400_000
    : PLUS_PRODUCTS.has(tx.productId ?? "") ? tx.expiresDate : undefined;
  if (!expires) throw new HttpError(400, "wrong_product");
  const { data, error } = await db.rpc("apply_apple_plus", {
    p_otid: tx.originalTransactionId, p_user: user.id, p_product: tx.productId, p_env: String(tx.environment),
    p_expires: new Date(expires).toISOString(), p_revoked: revoked,
  });
  if (error?.code === "P0001") throw new HttpError(409, "subscription_on_another_account");
  if (error) throw error;
  return json({ plus_until: data });
});
