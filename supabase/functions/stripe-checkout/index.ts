import { admin, HttpError, json, readJson, requireUser, serve } from "../_shared/http.ts";

// What can be bought on the web (Stripe). iOS/Android sell Plus through StoreKit / Play Billing instead.
//   credit     : prepaid visit credit for a shop (each verified visit deducts the shop's bid)
//   plus       : Giggles Plus for a user, 30 days (no ads, daily coins, Plus shelf and title, themes and flair)
//   plus_year  : Giggles Plus for a user, 365 days (web only; the iOS app sells monthly Plus through StoreKit)
//   membership : one-time lifetime membership (no ads, unlimited detours, partners first, 3 months of Plus), never renews
//   partner    : a shop's Partner tier, 30 days (members' routes put it first; guests can book it)
//   choice     : Giggles Choice, 30 days: a Partner we hand-picked (needs our approval first), also in the Partner picks plan
const CREDIT_PACKS = [500, 1000, 3000];
// ponytail: prices are defaults awaiting the owner's decision (= PRICES.plus / plusYear in web/src/lib/api.ts)
const PLUS_THB = { plus: 59, plus_year: 590 } as const;
const MEMBERSHIP_THB = 349;
const TIER_THB = { partner: 299, choice: 799 } as const;

serve(async (req) => {
  const user = await requireUser(req);
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new HttpError(503, "payments_not_configured");
  if (!/^(sk|rk)_test_/.test(key) && Deno.env.get("STRIPE_LIVE") !== "1") throw new HttpError(503, "live_payments_disabled");

  const body = await readJson(req);
  const kind = ["credit", "plus", "plus_year", "membership", "partner", "choice"].includes(body.kind) ? body.kind : "credit";
  const site = Deno.env.get("SITE_URL") ?? "https://giggles-maps.pages.dev";

  let amount: number, name: string, back: string;
  const meta: Record<string, string> = { kind };
  if (kind === "plus" || kind === "plus_year" || kind === "membership") {
    if (user.is_anonymous) throw new HttpError(403, "sign_in_required"); // must survive a reinstall
    if (kind === "membership") {
      const { data: p } = await admin().from("profiles").select("member_since").eq("id", user.id).maybeSingle();
      if (p?.member_since) throw new HttpError(409, "already_member");
    }
    amount = kind === "membership" ? MEMBERSHIP_THB : PLUS_THB[kind as keyof typeof PLUS_THB];
    name = kind === "plus" ? "Giggles Plus, 30 days" : kind === "plus_year" ? "Giggles Plus, 1 year" : "Giggles Maps membership (one-time)";
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
