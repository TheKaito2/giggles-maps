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
| Email OTP / magic link | On (default Supabase mailer, low rate limit; add SMTP before launch). |
| Sign in with Apple, Google | Next: needs Apple Services ID + Google OAuth client in the dashboard. Native apps use `signInWithIdToken`. |
| LINE | Planned via Edge Function (see `PLATFORMS.md`). |

Redirect URLs allowed: `https://giggles-maps.pages.dev/**`, `http://localhost:5173/**`, `giggles://auth-callback`.

## `plan-route`

Plan a detour that fits the user's extra-time budget, partner stops first.

Request
```json
{
  "origin": { "lat": 17.17313, "lng": 104.14488 },
  "dest":   { "lat": 17.16445, "lng": 104.15345 },
  "start_min": 600,
  "budget_min": 45,
  "mode": "pedestrian"
}
```
- `start_min`: minutes after local midnight (0–1439). Used for opening hours.
- `budget_min`: extra minutes the user accepts (0–240). Never exceeded.
- `mode`: `"pedestrian"` (default) or `"auto"`.
- Coordinates must be inside Thailand (lat 5–21, lng 97–106).

Response
```json
{
  "route_id": "uuid", "routing": "valhalla", "mode": "pedestrian",
  "base_min": 21, "total_min": 66, "extra_min": 44, "budget_min": 45,
  "expected_thb": 3.44, "candidates_considered": 15,
  "stops": [{ "id": 31, "name": "…", "name_th": "…", "category": "craft", "lat": 17.16, "lng": 104.14,
              "is_partner": true, "bid_thb": 15, "is_demo": true, "rating": 4.2, "dwell_min": 20, "eta_min": 617 }],
  "geometry": [[104.14488, 17.17313], "…"]
}
```
- `routing: "estimate"` means the routing server was down and times are straight-line estimates.
- `geometry` is `[lng, lat]` pairs (GeoJSON order) for the polyline.
- `is_partner` stops must show a **Partner** label (`Example partner` when `is_demo`).

Errors: `not_signed_in` 401, `bad_origin` / `bad_dest` / `bad_start_min` / `bad_budget_min` / `bad_json` 400.

## `verify-checkin`

Upload the selfie first: Storage bucket `selfies`, path `<user_id>/<anything>.jpg` (private bucket, JPEG/WebP/PNG, max 3 MB; users can only write their own folder).

Request
```json
{
  "place_id": 31, "lat": 17.16392, "lng": 104.14845, "accuracy_m": 8,
  "selfie_path": "<user_id>/1761148800000.jpg", "face_count": 1,
  "client": { "platform": "ios", "is_mock": false, "attest": "<App Attest / Play Integrity token>", "demo": false }
}
```

Response
```json
{ "checkin_id": "uuid", "status": "approved", "reasons": [], "rewarded": true,
  "billed_thb": 15, "distance_m": 2.7, "new_badges": [{ "slug": "indigo-and-silk", "name": "Indigo & Silk" }] }
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

A rewarded check-in at a partner bills the shop its bid (if its wallet covers it) and awards any collection badge it completes. All in one DB transaction (`public.record_checkin`).

Errors: `place_not_found` 404, `demo_only_at_example_places` 403, `bad_*` 400.

## `delete-account`

Body `{}`. Deletes the user's selfies, then the auth user (cascades check-ins, badges, routes). Required by App Store guideline 5.1.1(v).

## `stripe-checkout` (shop dashboard, web only)

Body `{ "shop_id": "uuid", "pack": 500 | 1000 | 3000 }` → `{ "url": "<Stripe Checkout URL>" }`.
Returns 503 `payments_not_configured` until `STRIPE_SECRET_KEY` is set. Only `sk_test_` keys are accepted unless `STRIPE_LIVE=1`.

## `stripe-webhook`

Stripe only. Verifies the `Stripe-Signature` header with `STRIPE_WEBHOOK_SECRET`, then credits the shop once per Checkout session on `checkout.session.completed` (paid) or `checkout.session.async_payment_succeeded` (PromptPay).

## Direct table reads (RLS)

| Table | Who can read |
|---|---|
| `places`, `collections`, `collection_places` | everyone |
| `checkins`, `user_badges`, `routes`, `route_stops`, `profiles` | own rows |
| `shops`, `billable_visits`, `wallet_topups` | shop owner, or anyone for demo shops |

No client can write to check-ins, billing, badges or wallets directly; only the functions above can.
