# Giggles Maps API (shared by web, iOS and Android)

Base URL: `https://xrlxfvwrkowaybtkkrdl.supabase.co`
Public key: the project's **publishable key** (`sb_publishable_…`, safe to ship in apps). Send it as `apikey` on every request.

All Edge Functions take `POST` with a JSON body and the user's access token: `Authorization: Bearer <access_token>`.
Errors come back as `{ "error": "<code>" }` with a 4xx/5xx status. Codes are stable; show your own text for them.

## Auth

Supabase Auth via `supabase-js` / `supabase-swift` / `supabase-kt`.

| Method | Status |
|---|---|
| Anonymous (`signInAnonymously`) | On. Use it so people can try the app with no account. |
| Email magic link | On. Sent via Resend from `noreply@kristpaulstudio.com`, 30 emails/hour. |
| Google | On. Web client + iOS client IDs accepted (Android client ID to be added). Native apps: `signInWithIdToken`. |
| Apple | On. Services ID `com.kristpaul.gigglesmaps.web` (web) + bundle ID `com.kristpaul.gigglesmaps` (iOS). |
| Linking | Manual linking on: a guest calls `linkIdentity` so stamps/coupons stay on the same account. |
| LINE | Planned via Edge Function (see `PLATFORMS.md`). |

Redirect URLs allowed: `https://giggles-maps.pages.dev/**`, `http://localhost:5173/**`, `giggles://auth-callback`.

## `plan-route`

Plan a detour that fits the user's extra-time budget. Stops are ranked on quality only (`docs/MONETIZATION.md`).
The engine returns several themed plans for the same trip (`plans`) and the user picks one; the top-level fields are always the **Top picks** plan, so older clients keep working.

Request
```json
{
  "origin": { "lat": 17.17313, "lng": 104.14488 },
  "dest":   { "lat": 17.16445, "lng": 104.15345 },
  "start_min": 600,
  "budget_min": 45,
  "mode": "pedestrian",
  "theme": "food",
  "interests": ["cafes", "culture"],
  "min_rating": 4, "include_unrated": false, "max_stops": 3, "max_price": 1
}
```
- `start_min`: minutes after local midnight (0–1439). Used for opening hours.
- `budget_min`: extra minutes the user accepts (0–240). Never exceeded.
- `mode`: `"pedestrian"` (default), `"bicycle"` or `"auto"`; anything else is 400 `bad_mode`.
- Planner preferences (all optional; omitted = the defaults below):
  - `interests`: up to 6 of `food`, `cafes`, `culture`, `nature`, `shopping`, `landmarks`. Adds a **Your mix** plan (`id: "mix"`) first, boosting (×2) every kind of stop the picks cover. Empty or omitted = no mix plan ("Surprise me"). 400 `bad_interests`.
  - `min_rating`: `0`, `3.5`, `4` (default) or `4.5`. 400 `bad_min_rating`.
  - `include_unrated`: `true` lets unrated places (`rating: null`, e.g. the OpenStreetMap seed) join routes. Default false.
  - `max_stops`: 1–6 stops per plan; omitted = no cap. Meal stops count. 400 `bad_max_stops`.
  - `max_price`: 0 (free) to 3 (฿฿฿). Drops places whose **known** price is higher; places with no listed price stay. 400 `bad_max_price`.
- `theme` (optional): `top_picks`, `nature`, `food`, `culture` or `shopping`. Only reorders `plans` so that one comes first; anything else is 400 `bad_theme`.
- Coordinates must be inside Thailand (lat 5–21, lng 97–106).

Response
```json
{
  "route_id": "uuid", "routing": "valhalla", "mode": "pedestrian",
  "base_min": 21, "total_min": 66, "extra_min": 44, "budget_min": 45,
  "plus": false, "member": false, "level": 0, "max_budget_min": 240, "candidates_considered": 15,
  "stops": [{ "id": 31, "name": "…", "name_th": "…", "category": "craft", "lat": 17.16, "lng": 104.14,
              "is_partner": true, "is_demo": true, "rating": 4.2, "dwell_min": 20, "eta_min": 617,
              "meal": null, "price_level": 0, "min_level": 0, "exclusive_kind": null, "perk_text": null,
              "nearby_partner": null }],
  "geometry": [[104.14488, 17.17313], "…"],
  "meals": ["lunch"], "missed_meals": [],
  "plans": [{ "id": "top_picks", "name": "Top picks", "stops": ["…same shape as stops…"],
              "geometry": ["…"], "extra_min": 44, "total_min": 66, "meals": ["lunch"], "missed_meals": [] }]
}
```
- `routing: "estimate"` means the routing server was down and times are straight-line estimates.
- `geometry` is `[lng, lat]` pairs (GeoJSON order) for the polyline.
- Routing update: optional `base_geometry` is the direct road line. Optional `warnings`
  includes `estimated_local_walk`, `places_unavailable`, `matrix_unavailable`,
  `some_detours_unavailable` and `detours_adjusted`. Only local pedestrian trips
  (endpoints within 10 km) may return approximate geometry after a baseline outage;
  render it dashed and label it as approximate. Other baseline outages return
  503 `routing_unavailable`. Road detours include verified leg times, dwell and
  meal waiting within the budget. See `THAILAND-ROUTING.md` for rollout.
- Stops are chosen by quality only (rating, variety, fit inside the budget). Paying never changes rank; there is no paid slot.
- `is_partner: true` means the place is a signed-up shop that pays per verified visit. It can appear any number of times, only on merit. Show a **Partner** label (`Example partner` when `is_demo`) so users know the shop pays.
- `nearby_partner` (on park/viewpoint/temple stops, max 2 per route): a "Near this spot" card `{id, name, category, lat, lng, distance_m, is_partner, is_demo}`. It is the best nearby place by quality (rating, then distance), signed up or not; the field name is kept from v2 so existing clients keep working. Show the Partner label only when the card's `is_partner` is true. Users can check in there too.
- `budget_min` goes up to 240 for everyone. Plus is cosmetic; members (`level` > 0) also get exclusive places their level opens (`min_level`, `exclusive_kind`, `perk_text`).
- `plans`: one per theme, Top picks first (or the requested `theme` first). A themed plan with exactly the same stops as an earlier one is dropped, so there can be 1–5 plans. Themes and their ×2-boosted categories (`_shared/themes.ts`): Top picks (none), Nature lover (park, viewpoint), Food lover (cafe, food, market), Culture & temples (temple, museum, art), Shopping & crafts (craft, market). Other kinds can still appear.
- Meals: when the trip window (start → start + direct time + budget) overlaps breakfast 07:00–09:30, lunch 11:30–13:30 or dinner 17:30–20:00 by ≥ 30 min, the meal is in `meals` and every plan tries to place a cafe/food/market stop arriving inside that window; that stop has `meal: "lunch"` etc. Arriving early means waiting for the window (counted in the extra time). If nothing fits, the meal is in that plan's `missed_meals`.
- Every stop and card in any plan counts as an impression, once per place per route.

- Each stop has `rating` (number, or `null` = unrated) and `price_level` (0 free, 1–3 = ฿–฿฿฿, `null` = not listed).

Errors: `not_signed_in` 401, `routing_unavailable` 503, `bad_origin` / `bad_dest` / `bad_start_min` / `bad_budget_min` / `bad_mode` / `bad_theme` / `bad_interests` / `bad_min_rating` / `bad_max_stops` / `bad_max_price` / `bad_json` 400.

## `verify-checkin`

Upload the selfie first: Storage bucket `selfies`, path `<user_id>/<anything>.jpg` (private bucket, JPEG/WebP/PNG, max 3 MB; users can only write their own folder).

Request
```json
{
  "place_id": 31, "lat": 17.16392, "lng": 104.14845, "accuracy_m": 8,
  "selfie_path": "<user_id>/1761148800000.jpg", "face_count": 1, "qr_code": "ABC123",
  "client": { "platform": "ios", "is_mock": false, "attest": "<App Attest / Play Integrity token>", "demo": false }
}
```

Response
```json
{ "checkin_id": "uuid", "status": "approved", "reasons": [], "rewarded": true,
  "billed_thb": 15, "billing": "charged", "qr_ok": true, "distance_m": 2.7,
  "new_badges": [{ "slug": "indigo-and-silk", "name": "Indigo & Silk" }],
  "spin": { "won": true, "title": "Free cookie with any drink (example)", "place": "Fika Cafe", "code": "0F9707EA", "odds": 0.31 },
  "xp_gained": 250, "xp": 1600, "level": 4, "level_up": true, "member": true }
```
- `xp_gained` / `xp` / `level` / `level_up`: everyone earns XP (+100 rewarded check-in, +50 partner shop, +100 first visit to a new category). `level` is from XP; it only unlocks places when `member` is true. For a non-member, say "Level N banked: become a member to unlock it".

| Rule | Result | Reason code |
|---|---|---|
| More than 60 m from the place | rejected | `too_far` |
| `face_count < 1` | rejected | `no_face` |
| Selfie missing from the user's folder | rejected | `no_selfie` |
| `client.is_mock` | rejected | `mock_location` |
| Faster than 150 km/h since last check-in (24 h) | rejected | `speed_jump` |
| GPS accuracy over 50 m | review | `low_accuracy` |
| Already rewarded here today (Bangkok time) | approved, no stamp | `already_rewarded_today` |
| Exclusive place above the user's unlock level (or event outside its window) | rejected, nothing recorded; response has `required_level` | `level_locked` |

`qr_code` is the code under the counter QR sticker (also arrives via the sticker link `/app/?scan=<place_id>-<code>`). Example shops use `DEMO`.

`billing` (what happened on the shop side): `charged` · `no_qr` · `not_shown_on_route` (not shown to this user in the last 3 h) · `repeat_visit_30d` · `wallet_empty` · `not_rewarded` · `not_partner`. A shop is charged only when the check-in is rewarded, the QR matches, the stop/card was shown to this user within 3 h, and it's the user's first billed visit there in 30 days.

`spin`: free coupon spin after every rewarded check-in (never sold). 50% overall win chance among active coupons from signed-up shops with credit within 3 km; `odds` is this prize's chance. `null` when no coupons are available.

All of it runs in one DB transaction (`public.record_checkin`).

Errors: `place_not_found` 404, `demo_only_at_example_places` 403, `bad_*` 400.

## `delete-account`

Body `{}`. Deletes the user's selfies, then the auth user (cascades check-ins, badges, routes). Required by App Store guideline 5.1.1(v).

## `stripe-checkout` (web only)

| Body | Buys |
|---|---|
| `{ "kind": "credit", "shop_id": "uuid", "pack": 500 \| 1000 \| 3000 }` | Prepaid visit credit for a shop |
| `{ "kind": "plus" }` | Giggles Plus (cosmetic) for the signed-in user, ฿59 / 30 days (403 `sign_in_required` for guests) |
| `{ "kind": "membership" }` | One-time membership, ฿349 (403 `sign_in_required` for guests, 409 `already_member`) |

→ `{ "url": "<Stripe Checkout URL>" }` (card + PromptPay, one-time, no auto-renew). Test keys only unless `STRIPE_LIVE=1`.
**iOS/Android must not use this**: sell membership and Plus through StoreKit / Google Play Billing.

## `apple-plus` (iOS)

Body `{ "jws": "<StoreKit 2 signed transaction>" }` after every purchase, restore and `Transaction.updates` item. Buy with `appAccountToken` = the Supabase user id. The server verifies Apple's signature, then:
- `com.kristpaul.gigglesmaps.membership` → `{ "member_since": "…" }`
- `com.kristpaul.gigglesmaps.plus.monthly` → `{ "plus_until": "…" }`

Errors: `sign_in_required` 403 (guests), `invalid_transaction` 400, `bought_by_another_account` 403, `purchase_on_another_account` / `subscription_on_another_account` 409, `wrong_product` 400.
`apple-notifications` receives App Store Server Notifications V2 (renewals, refunds, revokes) with no user JWT.

## `stripe-webhook`

Stripe only. Verifies the `Stripe-Signature` header with `STRIPE_WEBHOOK_SECRET`, then applies the payment once per Checkout session (`apply_payment`: credit → wallet, plus → `profiles.plus_until` +30 days, membership → `profiles.member_since`) on `checkout.session.completed` (paid) or `checkout.session.async_payment_succeeded` (PromptPay).

## Database functions (RPC)

| Function | Who | Returns |
|---|---|---|
| `place_for_checkin(p_id)` | anyone | `{id, name, lat, lng, is_partner, is_demo}` for a QR deep link |
| `shop_overview(p_shop)` | shop owner / demo shop | wallet, per place: bid, QR code, last scan, impressions and visits (30 days) |
| `dispute_visit(p_visit, p_reason)` | shop owner / demo shop | refunds a charged visit within 7 days |
| `my_exclusives()` | signed in | every exclusive place: `{id, name, category, exclusive_kind, min_level, unlocked, lat, lng, perk_text, event_starts, event_ends, is_demo}`; `lat`/`lng`/`perk_text` are null while locked |
| `set_cosmetics(p_theme, p_flair)` | Plus only (`plus_required`) | saves `profiles.cosmetics`; pass null to keep a field. Themes `classic indigo lotus night-market temple-gold rain`, flairs `none marigold indigo lotus sparkle` (`bad_theme` / `bad_flair`) |
| `claim_monthly_stamp()` | signed in | this month's Plus stamp (date), or null without Plus. Read stamps from `plus_stamps` |

## Direct table reads (RLS)

| Table | Who can read |
|---|---|
| `places` (all columns except `qr_code`), `collections`, `collection_places`, active `coupons` | everyone |
| `profiles` (`member_since`, `xp`, `plus_until`, `cosmetics`), `coupon_wins`, `plus_stamps` | own rows |
| `checkins`, `user_badges`, `routes`, `route_stops` | own rows |
| `shops`, `billable_visits` (no `user_id`), `payments` | shop owner (or payer), or anyone for demo shops |

No client can write to profiles, check-ins, billing, badges or wallets directly; only the functions above can.

## Nationwide POI search (routing update)

`search_route_places(p_query)` returns up to 10 public named POIs with
`id`, `name`, `name_th`, `lat`, `lng`. Only `min_level = 0` records are returned;
exclusive names/coordinates are not exposed. Literal Thai/English queries are
2–100 characters. It searches imported POIs, not every address; any map pin or
coordinate can still be the destination.
