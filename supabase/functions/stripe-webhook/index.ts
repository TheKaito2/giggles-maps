import { admin, json, serve } from "../_shared/http.ts";

// Stripe calls this; no user JWT (verify_jwt = false). Trust comes from the signature.
// metadata.kind = credit (shop wallet) | trip_pass | plus_year | lifetime (user) | partner | choice (shop tier); see stripe-checkout.
// (plus and membership are no longer sold, but apply_payment still accepts them for sessions already open)
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
  const db = admin();

  // shop subscriptions (Partner / Choice monthly): each paid invoice runs the tier to the end of its period
  if (event.type === "invoice.paid") {
    const inv = event.data.object;
    // the subscription and its metadata moved under `parent` in newer Stripe API versions: read both places
    const subRef = inv.subscription ?? inv.parent?.subscription_details?.subscription ?? null;
    const sub: string | null = typeof subRef === "string" ? subRef : subRef?.id ?? null;
    const meta = inv.subscription_details?.metadata ?? inv.parent?.subscription_details?.metadata ?? {};
    // not one of our shop subscriptions (or a malformed one): acknowledged, never retried for days
    if (!sub || typeof meta.shop_id !== "string" || (meta.kind !== "partner" && meta.kind !== "choice")) return json({ received: true });
    // the billing period comes from the invoice line (invoice.period_* is the previous cycle for subscriptions)
    const period = inv.lines?.data?.[0]?.period;
    if (!period?.start || !period?.end) { console.error("invoice without a line period", inv.id); return json({ error: "no_period" }, 500); }
    const { data: result, error } = await db.rpc("apply_shop_invoice", {
      p_invoice: inv.id, p_shop: meta.shop_id, p_kind: meta.kind, p_amount: inv.amount_paid / 100,
      p_period_start: new Date(period.start * 1000).toISOString(), p_period_end: new Date(period.end * 1000).toISOString(), p_subscription: sub,
    });
    if (error) { console.error(error); return json({ error: "apply_failed" }, 500); }   // Stripe retries
    // a second subscription for a shop that already has one (two checkouts at once): it counts this time, and never renews
    if (result === "duplicate") {
      const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(sub)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY")}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ cancel_at_period_end: "true" }),
      });
      if (!res.ok) { console.error("couldn't stop duplicate subscription", sub, await res.text()); return json({ error: "duplicate_not_stopped" }, 500); }
    }
    return json({ received: true });
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const s = event.data.object;
    // past_due / unpaid / incomplete: leave the status alone (the tier runs out by itself at tier_until)
    if (event.type === "customer.subscription.updated" && !["active", "trialing", "canceled"].includes(s.status)) return json({ received: true });
    const status = event.type === "customer.subscription.deleted" || s.status === "canceled" ? "cancelled"
      : s.cancel_at_period_end ? "cancelling" : "active";
    const { error } = await db.rpc("set_shop_subscription_status", { p_subscription: s.id, p_status: status });
    if (error) { console.error(error); return json({ error: "apply_failed" }, 500); }
    return json({ received: true });
  }

  // cards complete immediately; PromptPay may complete asynchronously
  const paid = (event.type === "checkout.session.completed" && event.data.object.payment_status === "paid")
    || event.type === "checkout.session.async_payment_succeeded";
  if (!paid) return json({ received: true });

  const s = event.data.object;
  if (s.mode === "subscription") return json({ received: true });   // paid through invoice.paid above, never twice
  const { error } = await db.rpc("apply_payment", {
    p_session: s.id, p_kind: s.metadata.kind ?? "credit", p_amount: s.amount_total / 100,
    p_shop: s.metadata.shop_id ?? null, p_user: s.metadata.user_id ?? null,
  });
  if (error) { console.error(error); return json({ error: "credit_failed" }, 500); } // Stripe retries
  return json({ received: true });
});
