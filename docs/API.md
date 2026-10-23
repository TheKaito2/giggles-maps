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
  "theme": "food"
}
```
- `start_min`: minutes after local midnight (0–1439). Used for opening hours.
- `budget_min`: extra minutes the user accepts (0–240). Never exceeded.
- `mode`: `"pedestrian"` (default) or `"auto"`.
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
              "meal": null, "min_level": 0, "exclusive_kind": null, "perk_text": null,
              "nearby_partner": null }],
  "geometry": [[104.14488, 17.17313], "…"],
  "meals": ["lunch"], "missed_meals": [],
  "plans": [{ "id": "top_picks", "name": "Top picks", "stops": ["…same shape as stops…"],
              "geometry": ["…"], "extra_min": 44, "total_min": 66, "meals": ["lunch"], "missed_meals": [] }]
}
```
- `routing: "estimate"` means the routing server was down and times are straight-line estimates.
- `geometry` is `[lng, lat]` pairs (GeoJSON order) for the polyline.
- Stops are chosen by quality only (rating, variety, fit inside the budget). Paying never changes rank; there is no paid slot.
- `is_partner: true` means the place is a signed-up shop that pays per verified visit. It can appear any number of times, only on merit. Show a **Partner** label (`Example partner` when `is_demo`) so users know the shop pays.
- `nearby_partner` (on park/viewpoint/temple stops, max 2 per route): a "Near this spot" card `{id, name, category, lat, lng, distance_m, is_partner, is_demo}`. It is the best nearby place by quality (rating, then distance), signed up or not; the field name is kept from v2 so existing clients keep working. Show the Partner label only when the card's `is_partner` is true. Users can check in there too.
- `budget_min` goes up to 240 for everyone. Plus is cosmetic; members (`level` > 0) also get exclusive places their level opens (`min_level`, `exclusive_kind`, `perk_text`).
- `plans`: one per theme, Top picks first (or the requested `theme` first). A themed plan with exactly the same stops as an earlier one is dropped, so there can be 1–5 plans. Themes and their ×2-boosted categories (`_shared/themes.ts`): Top picks (none), Nature lover (park, viewpoint), Food lover (cafe, food, market), Culture & temples (temple, museum, art), Shopping & crafts (craft, market). Other kinds can still appear.
- Meals: when the trip window (start → start + direct time + budget) overlaps breakfast 07:00–09:30, lunch 11:30–13:30 or dinner 17:30–20:00 by ≥ 30 min, the meal is in `meals` and every plan tries to place a cafe/food/market stop arriving inside that window; that stop has `meal: "lunch"` etc. Arriving early means waiting for the window (counted in the extra time). If nothing fits, the meal is in that plan's `missed_meals`.
- Every stop and card in any plan counts as an impression, once per place per route.

Errors: `not_signed_in` 401, `bad_origin` / `bad_dest` / `bad_start_min` / `bad_budget_min` / `bad_theme` / `bad_json` 400.

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
  "spin": { "won": true, "title": "Free cookie with any drink (example)", "place": "Fika Cafe", "code": "0F9707EA", "odds": 0.31 } }
```

| Rule | Result | Reason code |
|---|---|---|
| More than 60 m from the place | rejected | `too_far` |
| `face_count < 1` | rejected | `no_face` |
| Selfie missing from the user's folder | rejected | `no_selfie` |
| `client.is_mock` | rejected | `mock_location` |
| Faster than 150 km/h since last check-in (24 h) | rejected | `speed_jump` |
| GPS accuracy over 50 m | review | `low_accuracy` |
| Already rewarded here today (Bangkok time) | approved, no stamp | `already_rewarded_today` |

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
| `{ "kind": "plus" }` | Giggles Plus for the signed-in user, ฿59 / 30 days (403 `sign_in_required` for guests) |

→ `{ "url": "<Stripe Checkout URL>" }` (card + PromptPay, one-time, no auto-renew). Test keys only unless `STRIPE_LIVE=1`.
**iOS/Android must not use this for Plus**: sell Plus through StoreKit / Google Play Billing (server receipt check not built yet).

## `stripe-webhook`

Stripe only. Verifies the `Stripe-Signature` header with `STRIPE_WEBHOOK_SECRET`, then applies the payment once per Checkout session (`apply_payment`: credit → wallet, plus → `profiles.plus_until` +30 days) on `checkout.session.completed` (paid) or `checkout.session.async_payment_succeeded` (PromptPay).

## Database functions (RPC)

| Function | Who | Returns |
|---|---|---|
| `place_for_checkin(p_id)` | anyone | `{id, name, lat, lng, is_partner, is_demo}` for a QR deep link |
| `shop_overview(p_shop)` | shop owner / demo shop | wallet, per place: bid, QR code, last scan, impressions and visits (30 days) |
| `dispute_visit(p_visit, p_reason)` | shop owner / demo shop | refunds a charged visit within 7 days |

## Direct table reads (RLS)

| Table | Who can read |
|---|---|
| `places` (all columns except `qr_code`), `collections`, `collection_places`, active `coupons` | everyone |
| `profiles` (incl. `plus_until`), `coupon_wins` | own rows |
| `checkins`, `user_badges`, `routes`, `route_stops`, `profiles` | own rows |
| `shops`, `billable_visits` (no `user_id`), `payments` | shop owner (or payer), or anyone for demo shops |

No client can write to check-ins, billing, badges or wallets directly; only the functions above can.
