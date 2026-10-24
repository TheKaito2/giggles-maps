import { admin, json, serve } from "../_shared/http.ts";

// Stripe calls this; no user JWT (verify_jwt = false). Trust comes from the signature.
// metadata.kind = credit (shop wallet) | plus | membership (user) | partner | choice (shop tier); see stripe-checkout.
async function verify(payload: string, header: string, secret: string): Promise<boolean> {
  // "t=...,v1=...,v1=...": during a secret rotation Stripe signs with each secret, so any v1 may match
  const parts = header.split(",").map((p) => p.split("=", 2));
  const ts = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k, v]) => k === "v1" && v).map(([, v]) => v);
  if (!ts || !sigs.length || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${payload}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((v1) => {
    // constant-time compare
    if (hex.length !== v1.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
    return diff === 0;
  });
}

// serve() leaves the raw body unread and needs no auth, so the signature check still sees the exact payload
serve(async (req) => {
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) return json({ error: "payments_not_configured" }, 503);
  const payload = await req.text();
  if (!(await verify(payload, req.headers.get("stripe-signature") ?? "", secret))) {
    return json({ error: "bad_signature" }, 400);
  }
  const event = JSON.parse(payload);
  // cards complete immediately; PromptPay may complete asynchronously
  const paid = (event.type === "checkout.session.completed" && event.data.object.payment_status === "paid")
    || event.type === "checkout.session.async_payment_succeeded";
  if (!paid) return json({ received: true });

  const s = event.data.object;
  const { error } = await admin().rpc("apply_payment", {
    p_session: s.id, p_kind: s.metadata.kind ?? "credit", p_amount: s.amount_total / 100,
    p_shop: s.metadata.shop_id ?? null, p_user: s.metadata.user_id ?? null,
  });
  if (error) { console.error(error); return json({ error: "credit_failed" }, 500); } // Stripe retries
  return json({ received: true });
});
