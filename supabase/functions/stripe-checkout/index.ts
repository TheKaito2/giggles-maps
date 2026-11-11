import { admin, HttpError, json, readJson, requireUser, serve } from "../_shared/http.ts";

// What can be bought on the web (Stripe). iOS/Android sell Plus through StoreKit / Play Billing instead.
//   credit     : prepaid credit for a shop (verified visits and bookings are paid from it)
//   trip_pass  : Giggles Plus for a user, 7 days (no ads, unlimited detours and stops, daily coins, themes and flair)
//   plus_year  : Giggles Plus for a user, 365 days, the main plan
//   lifetime   : Plus forever, one payment, never renews
//   partner    : a shop's Partner tier, 30 days (members' routes put it first; guests can book it)
//   choice     : Giggles Choice, 30 days: a Partner we hand-picked (needs our approval first), also in the Partner picks plan
// Prices v6 (= PRICES in web/src/lib/api.ts and the App Store products). Monthly Plus and the ฿349 membership are no longer sold.
const CREDIT_PACKS = [500, 1000, 3000];
const PLUS_THB = { trip_pass: 79, plus_year: 890 } as const;
const LIFETIME_THB = 2990;
const TIER_THB = { partner: 990, choice: 2490 } as const;
const KINDS = ["credit", "trip_pass", "plus_year", "lifetime", "partner", "choice"];

serve(async (req) => {
  const user = await requireUser(req);
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new HttpError(503, "payments_not_configured");
  if (!/^(sk|rk)_test_/.test(key) && Deno.env.get("STRIPE_LIVE") !== "1") throw new HttpError(503, "live_payments_disabled");

  const body = await readJson(req);
  // an app older than v6 asking for monthly Plus or the membership: no longer sold
  if (body.kind === "plus" || body.kind === "membership") throw new HttpError(410, "no_longer_sold");
  const kind = KINDS.includes(body.kind) ? body.kind : "credit";
  const site = Deno.env.get("SITE_URL") ?? "https://gigglesmap.xyz";

  let amount: number, name: string, back: string;
  const meta: Record<string, string> = { kind };
  if (kind === "trip_pass" || kind === "plus_year" || kind === "lifetime") {
    if (user.is_anonymous) throw new HttpError(403, "sign_in_required"); // must survive a reinstall
    // Lifetime already: nothing more to buy
    const { data: p } = await admin().from("profiles").select("plus_until").eq("id", user.id).maybeSingle();
    if (p?.plus_until && new Date(p.plus_until).getUTCFullYear() >= 2099) throw new HttpError(409, "already_lifetime");
    amount = kind === "lifetime" ? LIFETIME_THB : PLUS_THB[kind as keyof typeof PLUS_THB];
    name = kind === "trip_pass" ? "Giggles Trip Pass, 7 days" : kind === "plus_year" ? "Giggles Plus, 1 year" : "Giggles Plus Lifetime (one-time)";
    back = `${site}/app/`;
    meta.user_id = user.id;
  } else if (kind === "partner" || kind === "choice") {
    // a signed-in owner of a verified place (its counter QR has been scanned) only
    if (user.is_anonymous) throw new HttpError(403, "sign_in_required");
    const shopId = typeof body.shop_id === "string" ? body.shop_id : "";
    const db = admin();
    const { data: shop } = await db.from("shops").select("id, name, owner_id, choice_approved").eq("id", shopId).maybeSingle();
    if (!shop || shop.owner_id !== user.id) throw new HttpError(403, "not_your_shop");
    const { count } = await db.from("places").select("id", { count: "exact", head: true })
      .eq("shop_id", shop.id).not("qr_code", "is", null).not("last_qr_scan_at", "is", null);
    if (!count) throw new HttpError(409, "not_verified");
    if (kind === "choice" && !shop.choice_approved) throw new HttpError(409, "choice_not_approved");
    amount = TIER_THB[kind as keyof typeof TIER_THB];
    name = `${kind === "choice" ? "Giggles Choice" : "Giggles Partner"}, 30 days — ${shop.name}`;
    back = `${site}/shop/`;
    meta.shop_id = shop.id;
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
