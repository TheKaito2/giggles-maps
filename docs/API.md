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
  "min_rating": 4, "include_unrated": true, "max_stops": 3, "max_price": 1,
  "must_include": [37420]
}
```
- `start_min`: minutes after local midnight (0–1439). Used for opening hours.
- `budget_min`: extra minutes the user accepts (0–240), or `"auto"`: half the direct trip time, rounded to 15 min, between 45 min and 3 h (the response's `budget_min` is the chosen value and `budget_auto: true`). Never exceeded.
- `mode`: `"pedestrian"` (default), `"bicycle"` or `"auto"`; anything else is 400 `bad_mode`.
- Planner preferences (all optional; omitted = the defaults below):
  - `interests`: up to 6 of `food`, `cafes`, `culture`, `nature`, `shopping`, `landmarks`. **Only those kinds**: every plan uses just places the picks cover (`landmarks` = tier 3 of any kind), plus a restaurant when a meal is asked for and any `must_include` place. A **Your mix** plan (`id: "mix"`) comes first. Empty or omitted = any kind. 400 `bad_interests`.
  - `open_only: true`: only places whose opening hours are known (the planner then checks you arrive while they're open; it does that for every place with known hours anyway). About 1 in 5 places lists hours, fewer in small towns.
  - `no_chains: true`: shops, cafés, restaurants and markets must be independent (`local`, OTOP or community); temples, parks and other sights are unaffected.
  - `min_rating`, `include_unrated`, `max_price`: still accepted, but the web app no longer sends them: OpenStreetMap has no ratings or prices, so they filter nothing useful until reviews and prices exist.
  - `min_rating`: `0`, `3.5`, `4` (default) or `4.5`. 400 `bad_min_rating`.
  - `include_unrated`: default **true**: unrated places (`rating: null`, most of the OpenStreetMap import) join routes, scored below rated ones (as 3.5/5). `false` = rated places only.
  - `must_include`: up to 6 place ids the user picked or added (from `search_places` or a plan's `along`). They go into every plan when they fit the budget, opening hours and `max_stops`, even below the rating floor; the rest are listed in each plan's `unfit_required`. Stops have `picked: true`. 400 `bad_must_include`.
  - `exclude`: up to 30 place ids never to use (stops the user removed or swapped out). 400 `bad_exclude`.
  - `keep_order` (optional): `true` = `must_include` is the route order, exactly; a list of stop ids = those stops keep that
    order and the rest of `must_include` is inserted where it fits best (400 `bad_keep_order` if it isn't a list of ids).
    The web app sends `true` after a drag or a + between two stops, and the current order as a list for "add along your
    route" once you've set the order yourself.
  - Places with no listed opening hours are planned inside the usual hours for their kind (temples 06:00–18:00, parks
    05:00–20:00, night and walking-street markets 17:00–23:00, …; `_shared/usual-hours.ts`).
  - Editing a plan, the way the web app does it: remove = `must_include` the other current stops + `exclude` the removed one; swap = the same (the planner picks the best replacement); add = `must_include` the current stops + the new place, with more `budget_min` when it doesn't fit. Send `theme` to keep the plan you were on first.
  - Each stop has `extra_min` (about how many minutes it adds: road detour + time there; null if unknown) and `photo` (a URL or null). Each plan has `along`: up to 30 shortlist places it left out, cheapest first, `{ id, name, name_th, category, lat, lng, tier, rating, local, otop, community, photo, extra_min }` (an estimate: "about +X min").
  - `max_stops`: 1–6 stops per plan; omitted = no cap. Meal stops count. 400 `bad_max_stops`.
  - `max_price`: 0 (free) to 3 (฿฿฿). Drops places whose **known** price is higher; places with no listed price stay. 400 `bad_max_price`.
- `theme` (optional): `top_picks` (Landmarks), `nature` or `scenic` (Scenic), `culture` (Culture & heritage), `local` (Local gems), `food` or `shopping`. Only reorders `plans` so that one comes first; anything else is 400 `bad_theme`.
- Coordinates must be inside Thailand (lat 5–21, lng 97–106).

Response
```json
{
  "route_id": "uuid", "routing": "valhalla", "mode": "pedestrian",
  "base_min": 21, "total_min": 66, "extra_min": 44, "budget_min": 45,
  "plus": false, "member": false, "level": 0, "max_budget_min": 240, "candidates_considered": 15,
  "stops": [{ "id": 31, "name": "…", "name_th": "…", "category": "craft", "lat": 17.16, "lng": 104.14,
              "is_partner": true, "is_demo": true, "rating": 4.2, "dwell_min": 20, "eta_min": 617, "travel_min": 12,
              "meal": null, "price_level": 0, "partner_tier": null,
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
- Guests (anonymous sessions) try it: 1 detour (destination) and 3 edits a Bangkok day, then 403 `sign_in_required` for a
  second destination or 403 `sign_in_edits` for a 4th edit (migrations 073, 080; show the sign-in sheet, not a retry). Free accounts: 3 detours (destinations) and 10 edits a Bangkok
  day (429 `detour_limit` / `edit_limit`); a request with `must_include` or `exclude` is an edit. Everyone: 20 plans a minute,
  members 300 and free accounts 100 a day (429 `slow_down`). An edit of a destination not planned today counts as a detour. `my_plan_usage()` reports today's counts.
- Stops are chosen by quality (rating, variety, fit inside the budget). For members, paid tiers score higher: Giggles Choice ×2,
  Partner ×1.5. Every stop and `along` place has `partner_tier: "partner" | "choice" | null`; show its badge whenever set.
- `plans` can include `{id: "giggles", name: "Giggles' picks"}`: Giggles Choice places only (plus picks), for everyone, when a
  Choice place fits.
- `is_partner: true` means the place is a signed-up shop that pays per verified visit. It can appear any number of times, only on merit. Show a **Partner** label (`Example partner` when `is_demo`) so users know the shop pays.
- `nearby_partner` (on park/viewpoint/temple stops, max 2 per route): a "Near this spot" card `{id, name, category, lat, lng, distance_m, is_partner, is_demo}`. It is the best nearby place by quality (rating, then distance), signed up or not; the field name is kept from v2 so existing clients keep working. Show the Partner label only when the card's `is_partner` is true. Users can check in there too.
- `budget_min` goes up to 240 for everyone. Exclusive places are gone (v5).
- Each plan (and the top level) splits `extra_min` into `road_extra_min` (more time on the road), `stop_min` (time at the stops, sum of `dwell_min`) and `wait_min` (waiting for a meal window). They add up to `extra_min` (±1 for rounding).
- `plans`: one per theme, Top picks first (or the requested `theme` first). A themed plan with exactly the same stops as an earlier one is dropped, so there can be 1–5 plans. Themes and their ×2-boosted categories (`_shared/themes.ts`): Top picks (none), Nature lover (park, viewpoint), Food lover (cafe, food, market), Culture & temples (temple, museum, art), Shopping & crafts (craft, market). Other kinds can still appear.
- Meals: only when asked. Request `meals`: any of `breakfast` (07:00–09:30), `lunch` (11:30–13:30), `dinner` (17:30–20:00); omitted = no meal stop. For each asked meal every plan adds a **restaurant** (OSM restaurants and food courts; breakfast may also be a cafe), arriving inside the window when the route can (arriving early waits, counted in the extra time). If the window can't be reached, a restaurant is still added at the best time the route allows and the stop has `meal_late: true`. The nearest restaurants always make the shortlist when a meal is asked for, and `budget_min: "auto"` adds 35 min per meal. A meal is in `missed_meals` only when no restaurant fits the budget at all. 400 `bad_meals`.
- Every stop and card in any plan counts as an impression, once per place per route.

- Each stop has `tier`: 3 = landmark (must-go: Wikipedia/Wikidata-linked, national parks, heritage, waterfalls, named peaks), 2 = worth a visit, 1 = everyday (cafes, food, crafts). Shown as a Landmark chip for tier 3.
- Each stop has `rating` (number, or `null` = unrated) and `price_level` (0 free, 1–3 = ฿–฿฿฿, `null` = not listed).

Errors: `not_signed_in` 401, `routing_unavailable` 503, `bad_origin` / `bad_dest` / `bad_start_min` / `bad_budget_min` / `bad_mode` / `bad_theme` / `bad_interests` / `bad_min_rating` / `bad_max_stops` / `bad_max_price` / `bad_must_include` / `bad_exclude` / `bad_meals` / `bad_json` 400.

Quick detours (budget under 30 min, no meal asked for): each stop counts as 10 minutes, every kind of place qualifies, and
after the sight the cheapest convenience store on the way (`route_pit_stops`, 5 minutes there) is added when it fits.
Those stops carry `pit_stop: true`; the response has `quick_stops: true`.

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
| `{ "kind": "plus" }` | Giggles Plus for the signed-in user, ฿59 / 30 days (403 `sign_in_required` for guests) |
| `{ "kind": "membership" }` | Lifetime membership, ฿349, with 90 days of Plus (403 `sign_in_required` for guests, 409 `already_member`) |
| `{ "kind": "partner", "shop_id": "uuid" }` | Partner tier for 30 days, ฿299 (403 `not_your_shop`, 409 `not_verified`) |
| `{ "kind": "choice", "shop_id": "uuid" }` | Giggles Choice for 30 days, ฿799 (also 409 `choice_not_approved`) |

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

## Passport (RPCs, signed-in user)

- `stops_near(p_lat, p_lng, p_radius_m default 1500)`: places around a point for the map: `id, name, name_th, category, tier, lat, lng, zone_m (150 landmark/park, 50 else), distance_m, stamped`.
- `passport_v2()`: `{ profile: {xp, level, member, plus, coins}, stamps: [...], photos: [...], provinces: [{id, iso, name_en, name_th, stamps}], challenges: [{slug, kind, title_en, title_th, have, need, xp, coins, claimed}] }`.
- `set_photo(p_checkin, p_hidden, p_caption)`: hide or caption one of your check-in photos.
- Photos are in the private `selfies` bucket under `<user id>/…`; use signed URLs.
- `verify-checkin` now returns, on top of the old fields: `stamp: {tier, new_province, province, event} | null` (first visit only), `challenges: [{slug, title, title_th, xp, coins}]` (completed by this check-in), `coins` (member balance). `face_count` is optional and ignored. Rules and numbers: `docs/GAMIFICATION.md`.

## Social and shop (RPCs, signed-in user; errors come back as the message, e.g. `code_not_found`)

- `me()`: `{member, xp, plus_until, nickname, colour, friend_code, on_leaderboard, look, title, owned: ["kind:id"]}`.
- `set_me(p_nickname, p_colour, p_on_leaderboard)`: any argument may be null (unchanged). Errors `bad_nickname`, `bad_colour`.
- `add_friend(p_code)` → `"requested" | "friends"`. Errors `nickname_required`, `code_not_found`, `own_code`.
- `answer_friend(p_from, p_accept)`, `remove_friend(p_id)`.
- `social()`: `{friends, incoming, outgoing}`, each a list of cards `{id, nickname, colour, xp, level, stamps, provinces, look, title}`.
- `friend_passport(p_id)`: `{card, stamps, photos, provinces}`. Error `not_friends`.
- `leaderboard()`: `{top: [card + rank], me: card + rank | null, total}`.
- `start_trip(p_name)`, `join_trip(p_code)`, `my_trip()` → `{id, code, name, owner, started_at, ends_at, members: [{id, me, owner, nickname, colour, lat, lng, seen_at}], album: [...]}` or null. Errors `trip_not_found`, `trip_full`.
- `trip_ping(p_lat, p_lng)`, `leave_trip()` (the owner leaving ends the trip).
- `buy_item(p_kind, p_id)` → coins left. Errors `plus_only`, `bad_item`, `already_owned`, `not_enough_coins` (v5: no membership needed).
- `equip(p_kind, p_id)` → the new look. Error `not_owned`. `shop_items` is a public table.
- `verify-checkin` also returns `group_bonus: boolean`.
- Reward pace (migration 051): at most 12 rewarded check-ins an hour, 60 a day, 30 s apart. Over that the check-in is
  still `approved` (photo kept) but `rewarded: false` with reason `slow_down`; the place can be stamped on a later visit.
- Demo mode (migration 052, anyone, Profile → Demo mode): the app fakes its location (tap the map, fast-forward to the next
  stop) and sends `client.demo: true`. Demo check-ins work at any place, skip the speed check, and are rewarded like real
  ones; they stay marked `client.demo = true` in `checkins`, and the pace limit still applies.
- The all-time leaderboard (migration 053) ranks by XP minus what demo check-ins earned (their stamps and Siam Si shakes),
  and its cards count only non-demo stamps and provinces. Your own profile still shows everything. Quests a demo
  check-in completes still count (a small leak, accepted).

## Profile, feed, quests (migration 024)
- `me()` also returns `avatar`, `joined`, `coins`, `provinces`.
- `set_avatar(p jsonb)`: `{slot: part}`; errors `bad_avatar`, `not_owned`. `equip('avatar', …)` raises `use_builder`.
- `profile_of(p_id)`: me or a friend: card + `photos, friends, rank, badges, friend_code (mine only)`. Error `not_friends`.
- `feed(p_scope 'all'|'friends'|'me')`: `[{id, kind, at, mine, data, who, to, place, province, photo, caption, reactions, my_reaction}]`.
- `react(p_activity, p_emoji 'heart'|'fire'|'clap'|'wow'|null)`, `nudge(p_friend)` (error `already_nudged`).
- Comments (migration 054), friends only (same rule as seeing the post):
  - `comment(p_activity, p_body)` → the new comment. Errors: `not_found`, `bad_comment` (1–280 characters), `comment_limit` (30 a day).
  - `comments_of(p_activity)` → `[{ id, body, at, mine, who }]`, oldest first.
  - `delete_comment(p_id)`: the author or the post's owner.
  - `feed()` items carry `comments` (count); a comment on someone else's post adds a `comment` item that only the two of you see.
- Leaderboard v2 (migration 060):
  - `board(p_scope 'everyone'|'friends', p_period 'week'|'all', p_metric 'xp'|'provinces'|'landmarks'|'temples'|'food')` →
    `{ top (50, with rank and value), me, next (the row just above you), total, ends (week only) }`.
    - Everyone means players on the leaderboard; friends means you and your friends.
    - The week starts Monday 00:00 Bangkok.
    - Demo check-ins never count.
  - `province_champions()` → per province, the player with the most visit-days (approved, non-demo check-ins, one per place per
    day) in 90 days, with `my_visits` and `need`.
  - `place_page.regular`: most visit-days at the place in 60 days (2 or more). `profile_of.crowns`: the provinces you lead.
  - Weekly rewards: `award_week()` (pg_cron, Monday 00:05 Bangkok) pays last week's top 3 +100/+60/+40 coins and each player who
    led their friends +30, each with a Siam Si shake and an `award` feed item. It runs once per week (`weekly_awards`).
- `claim_quest(p_slug)` → `{ slug, title, title_th, xp, coins, member, level, level_up, fortune_tickets }` (migration 057). Quests are
  claimed by hand: a finished quest waits until you claim it, and check-ins only list it in `challenges` with `ready: true`.
  Error `not_ready` if it isn't finished or is already claimed.
- `passport_v2()` also returns `trips`: each ride-along you shared, with its 3 memory photos (first, middle and last of the album).
  People who were on the trip can still see those 3 after it ends (`can_see_photo`, migration 056).
- `set_showcase(p)`: up to 3 `{type: 'badge'|'stamp', id}` you've earned (`not_earned`, `bad_showcase`); `profile_of` returns them as `showcase`.
- Shop sets and daily picks (migration 054):
  - `shop_today()` → `{ ends, picks: [{kind, id}] x6, sets: [{ id, name_en, name_th, blurb_en, items: ['kind:id'], full, price }] }`.
    Picks are the same for everyone and change at midnight Bangkok time. `sets[0]` is this week's featured set.
  - `buy_set(p_id)` → coins left. It buys the set's items you don't own at 75% each (rounded down). Errors:
    `already_owned`, `not_enough_coins`.
- `friend_quest()` → `{partner, week, me, them}` or null; `set_friend_quest(p_friend)` (error `already_paired`); `claim_quests()`.
- `verify-checkin` also returns `badges: [badge]` for tiers reached by that check-in.

## Map pins, kinds (migrations 028-034)
- Every place has a `kind` (39 types: restaurant, cafe, temple, waterfall, otop, community_enterprise, hospital, fuel,
  atm, hotel, ...; icons and colours in `web/src/app/kinds.ts`), plus `detour` (false for services, stays, health
  and big shops: they show on the map and in search but never become plan stops or passport stops), `opening_hours`,
  `phone`, `website`, `address`, `brand`, and the flags `local` (independent food/café/craft/market, not a chain),
  `otop`, `community`.
- `map_places(p_min_lng, p_min_lat, p_max_lng, p_max_lat, p_zoom, p_kinds text[] default null)`: up to 400 pins in
  the box. Zoomed out (< 11): landmarks, OTOP and community only; 11-14: plus every detour place and hospitals;
  14+: everything. `p_kinds` filters (Explore chips). Ranked landmark, OTOP/community, local, nearest the centre.
- `search_places` also returns `kind` and `tier`.

## Place page (migration 035)
- `place_page(p_id)`: details (hours, phone, website, address, flags), `rating` (review average, shown from 3 reviews),
  `review_count`, latest 20 `reviews`, `checked_in`, `stamped`, `photos` (Wikimedia `url` + author + licence, or a public
  check-in `path`), `busy` (check-ins per hour 6:00-23:00 for today's weekday, only once a place has 20+), `saved_in` (my list ids).
- Reviews: `write_review(p_place, p_rating 1-5, p_body)` needs an approved check-in there (error `check_in_first`) and returns
  `{xp, shake, tickets}`: +20 XP for the first review of a place, and one bonus Siam Si shake for the first review with 60+
  characters of text (migrations 072, 076). `place_page.review_shake` = that shake is still available here.
  `delete_review`, `report_review`. Three or more reviews set `places.rating`, which the planner uses.
- Photos: `set_public_photo(p_checkin, p_public)`; public check-in photos are readable by anyone signed in.
  Traveller photos of a place (migration 072): upload a JPEG to the public bucket `place-photos` at `<your uid>/<file>`, then
  `add_place_photo(p_place, p_path)` (needs a stamp there; at most 3 per place and 20 a day; errors `check_in_first`, `bad_photo`,
  `photo_limit`, `already_added`) returns `{coins_earned, coins}`: the first photo of a place pays 10 coins (plus coin perks).
  `delete_place_photo(p_id)` (yours; then delete the file), `report_place_photo(p_id)` (3 reports hide it). In `place_page.photos`
  they have `source: "traveller"`, `id`, `url: "place-photos/<path>"` and `mine`; `place_page.photo_reward` = your first photo here still pays.
  `place_photos` holds Wikimedia Commons photos (`supabase/tools/wikimedia_photos.py`, free licences only).
- Lists: `my_lists()` (makes "Want to go" + "Favourites" on first call), `save_place(p_list, p_place, p_saved)`,
  `create_list(p_name)`, `update_list(p_list, p_name, p_shared, p_delete)`, `friend_lists(p_friend)` (shared ones, friends only).
- Edits: `suggest_edit(p_place | null, p_payload, p_here_lat, p_here_lng)`: payload keys name, name_th, kind,
  opening_hours, phone, website, closed (+ lat, lng for a new place, which must be within 100 m of `p_here`).
  `admin_edits()` / `review_edit(p_edit, p_approve)` for `profiles.is_admin`; an approved edit gives +50 XP and counts
  toward the Map Maker badge.

## Turn-by-turn and live ETA (migrations 041-042)
- `POST /functions/v1/navigate` (signed in): `{ points: [{lat,lng}] (2-8, first = you, then stops left, last = destination),
  mode: "auto"|"bicycle"|"pedestrian", avoid?: { tolls, highways, ferries } }` returns `{ shape: [[lng,lat]], maneuvers:
  [{ type, instruction, street, begin, lengthM, timeS }], distanceM, timeS, legEnds }` (Valhalla maneuver types; `legEnds`
  = shape index where each stop is reached). Throttled to 40 requests per account per 10 minutes (`429 slow_down`).
  Clients: announce at 800/200/0 m driving, 300/80/0 cycling, 150/40/0 walking; reroute after 10 s more than 60 m off.
- `share_eta(p_dest_lat, p_dest_lng, p_dest_name, p_eta_min, p_refresh=false)` returns the link token (32 hex). Link:
  `https://giggles-maps.pages.dev/app/?eta=TOKEN`. Refresh the ETA every 30 s with `p_refresh => true` (returns null once
  sharing stopped; it never reopens a share). Position comes from `trip_ping`. `stop_eta()` ends it.
- `view_eta(p_token)` (anyone, no sign-in): `{ who (nickname, colour, avatar, level), dest, eta_at, at (fix from the last
  10 min) }`, or null once stopped, the trip ended, or 6 hours after sharing started.

## Search (`search_places` RPC)

`rpc("search_places", { p_query, p_lat?, p_lng?, p_kind?, p_limit? })`: our places by name (Thai or English, substring), nearest first when `p_lat`/`p_lng` are given.
- `p_kind`: `food` (food, market), `cafes`, `culture` (temple, museum, art), `nature` (park, viewpoint), `shopping` (craft, market).
- `p_query` may be empty when a kind and a point are given ("cafés near me", within 30 km).
- Returns `id, name, name_th, category, lat, lng, rating, price_level, distance_m`. Members-only places never appear.
- Clients fall back to an address geocoder for things we don't have: Apple MapKit search on iOS, Photon (`photon.komoot.io`, OpenStreetMap, fair use: query on Search/Enter only) on web. Android: Photon or Google's on-device Places is fine for addresses; pass the chosen coordinates as `origin`/`dest`.

## Database functions (RPC)

| Function | Who | Returns |
|---|---|---|
| `place_for_checkin(p_id)` | anyone | `{id, name, lat, lng, is_partner, is_demo}` for a QR deep link |
| `shop_overview(p_shop)` | shop owner / demo shop | wallet, per place: bid, QR code, last scan, impressions and visits (30 days) |
| `dispute_visit(p_visit, p_reason)` | shop owner / demo shop | refunds a charged visit within 7 days |
| `my_plan_usage()` | signed in | `{member, detours, edits, max_detours, max_edits, ads_left}` for today (Bangkok); the maxima include ad rewards |
| `start_ad_reward(p_kind)`, `claim_ad_reward(p_id)` | signed in, not members | a rewarded ad at the limit: `detour` (+1 detour) or `edit` (+5 changes) today. Claim ≥ 15 s after the start. Errors `ad_limit` (3 a day), `too_soon`, `not_needed` (members), `not_found` |
| `plus_daily()` | signed in | 20 the first call each Bangkok day while Plus is active, else 0 (the coins join `coins_of`) |
| `places_tiers(p_ids bigint[])` | anyone | `[{id, tier}]` for places with a live paid tier (`partner` / `choice`) |
| `request_booking(p_place, p_day, p_party, p_note)` | signed in | booking id. Errors `sign_in_required`, `not_bookable`, `bad_day`, `bad_party`, `too_many_bookings`, `already_booked` |
| `my_bookings()`, `cancel_booking(p_id)` | signed in | your bookings `{id, place_id, place, day, party, note, status}` / cancel a requested or accepted one |
| `shop_bookings(p_shop)`, `answer_booking(p_id, p_accept)` | shop owner | `{id, place, guest, day, party, note, status, fee, charged}` / accept or decline a request (accept needs credit for the fee: `top_up_first`) |
| `request_choice(p_shop)` | shop owner | apply for Giggles Choice; live Partners only (`partners_only`) |
| `shop_reach(p_place)` | anyone | `{name, shown_30d, trips_near_30d}`: times on a route and trips planned within 20 km, last 30 days (counts only) |
| `choice_requests()`, `approve_choice(p_shop, p_ok)` | admin | Giggles Choice applications / approve or turn down |
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

## Level rewards, waiting shakes (migrations 072-074)
- `me()` adds `perks: {luck, coins, chosen: [{level, perk}]}` and `pending_shakes: [{checkin, place}]`.
- Each level from 2 up gives one pick: `choose_level_perk(p_level, p_perk 'luck' | 'coins')` returns the new `perks`
  (errors `level_not_reached`, `already_chosen`, `bad_perk`). Levels reached but not picked = 2..level minus `chosen`.
  - luck: each pick multiplies the chance of every rarity above Common by 1.1 (the roll is divided by 1 + 0.1 × picks).
  - coins: each pick adds 10% to every coin earned afterwards (stamps, quests, weekly awards, Siam Si, place photos).
- Level cosmetics: `shop_items.level_req` (2-10). Worn free from that level (`can_wear`), never sold (`buy_item` → `level_reward`).
- `pending_shakes`: first-visit check-ins from the last 24 h whose shake wasn't taken; pass the id to `shake_fortune(p_checkin)`.
