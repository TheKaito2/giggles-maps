import { admin, HttpError, json, requireUser, serve } from "../_shared/http.ts";

// What can be bought on the web (Stripe). iOS/Android sell Plus through StoreKit / Play Billing instead.
//   credit  : prepaid visit credit for a shop (each verified visit deducts the shop's bid)
//   plus    : Giggles Plus for a user, 30 days (longer extra-time limit, cosmetic badges)
const CREDIT_PACKS = [500, 1000, 3000];
const PLUS_THB = 59;

serve(async (req) => {
  const user = await requireUser(req);
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new HttpError(503, "payments_not_configured");
  if (!/^(sk|rk)_test_/.test(key) && Deno.env.get("STRIPE_LIVE") !== "1") throw new HttpError(503, "live_payments_disabled");

  const body = await req.json().catch(() => { throw new HttpError(400, "bad_json"); });
  const kind = ["credit", "plus"].includes(body.kind) ? body.kind : "credit";
  const site = Deno.env.get("SITE_URL") ?? "https://giggles-maps.pages.dev";

  let amount: number, name: string, back: string;
  const meta: Record<string, string> = { kind };
  if (kind === "plus") {
    if (user.is_anonymous) throw new HttpError(403, "sign_in_required"); // Plus must survive a reinstall
    amount = PLUS_THB; name = "Giggles Plus, 30 days"; back = `${site}/app/`;
    meta.user_id = user.id;
  } else {
    const shopId = typeof body.shop_id === "string" ? body.shop_id : "";
    const { data: shop } = await admin().from("shops").select("id, name, owner_id, is_demo").eq("id", shopId).maybeSingle();
    if (!shop || (shop.owner_id !== user.id && !shop.is_demo)) throw new HttpError(403, "not_your_shop");
    amount = Number(body.pack);
    if (!CREDIT_PACKS.includes(amount)) throw new HttpError(400, "bad_pack");
    name = `Visit credit ฿${amount} — ${shop.name}`;
    back = `${site}/shop/`;
    meta.shop_id = shop.id;
  }

  const form = new URLSearchParams({
    mode: "payment",
    "payment_method_types[0]": "card",
    "payment_method_types[1]": "promptpay",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "thb",
    "line_items[0][price_data][unit_amount]": String(amount * 100), // satang
    "line_items[0][price_data][product_data][name]": name,
    success_url: `${back}?paid=success`,
    cancel_url: `${back}?paid=cancelled`,
  });
  for (const [k, v] of Object.entries(meta)) form.set(`metadata[${k}]`, v);
  if (user.email) form.set("customer_email", user.email);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const session = await res.json();
  if (!res.ok) { console.error(session); throw new HttpError(502, "stripe_error"); }
  return json({ url: session.url });
});
