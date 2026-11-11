import { admin, HttpError, json, readJson, requireUser, serve } from "../_shared/http.ts";

// A shop owner stops (or restarts) the monthly renewal of their Partner / Giggles Choice subscription. Stopping keeps the
// tier until the period it already paid for ends; nothing is refunded. Stripe's own event (customer.subscription.updated)
// confirms the status through stripe-webhook; we set it here too so the dashboard updates at once.
serve(async (req) => {
  const user = await requireUser(req);
  if (user.is_anonymous) throw new HttpError(403, "sign_in_required");
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new HttpError(503, "payments_not_configured");
  const body = await readJson(req);
  if (body.action !== "cancel" && body.action !== "resume") throw new HttpError(400, "bad_action");
  const shopId = typeof body.shop_id === "string" ? body.shop_id : "";
  const db = admin();
  const { data: shop } = await db.from("shops").select("id, owner_id, stripe_subscription_id, subscription_status").eq("id", shopId).maybeSingle();
  if (!shop || shop.owner_id !== user.id) throw new HttpError(403, "not_your_shop");
  if (!shop.stripe_subscription_id || shop.subscription_status === "cancelled") throw new HttpError(409, "no_subscription");

  const cancel = body.action === "cancel";
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(shop.stripe_subscription_id)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ cancel_at_period_end: String(cancel) }),
  });
  const sub = await res.json();
  if (!res.ok) { console.error(sub); throw new HttpError(502, "stripe_error"); }
  const status = cancel ? "cancelling" : "active";
  const { error } = await db.from("shops").update({ subscription_status: status }).eq("id", shop.id);
  if (error) throw error;
  return json({ status });
});
