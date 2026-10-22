import { admin, HttpError, json, requireUser, serve } from "../_shared/http.ts";

// prepaid credit packs shops buy; each verified visit deducts the shop's bid
const PACKS: Record<string, number> = { "500": 500, "1000": 1000, "3000": 3000 };

serve(async (req) => {
  const user = await requireUser(req);
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new HttpError(503, "payments_not_configured");
  if (!key.startsWith("sk_test_") && Deno.env.get("STRIPE_LIVE") !== "1") throw new HttpError(503, "live_payments_disabled");

  const body = await req.json().catch(() => { throw new HttpError(400, "bad_json"); });
  const amount = PACKS[String(body.pack)];
  if (!amount) throw new HttpError(400, "bad_pack");
  const shopId = typeof body.shop_id === "string" ? body.shop_id : "";

  const { data: shop } = await admin().from("shops").select("id, name, owner_id, is_demo").eq("id", shopId).maybeSingle();
  if (!shop || (shop.owner_id !== user.id && !shop.is_demo)) throw new HttpError(403, "not_your_shop");

  const site = Deno.env.get("SITE_URL") ?? "https://giggles-maps.pages.dev";
  const form = new URLSearchParams({
    mode: "payment",
    "payment_method_types[0]": "card",
    "payment_method_types[1]": "promptpay",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "thb",
    "line_items[0][price_data][unit_amount]": String(amount * 100), // satang
    "line_items[0][price_data][product_data][name]": `Giggles Maps visit credit ฿${amount} — ${shop.name}`,
    "metadata[shop_id]": shop.id,
    "metadata[amount_thb]": String(amount),
    success_url: `${site}/shop/?topup=success`,
    cancel_url: `${site}/shop/?topup=cancelled`,
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const session = await res.json();
  if (!res.ok) { console.error(session); throw new HttpError(502, "stripe_error"); }
  return json({ url: session.url });
});
