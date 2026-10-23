# Giggles Maps architecture

Giggles Maps fills the extra time a traveller allows on a trip with local stops in Sakon Nakhon. Travellers use it free and collect stamps by checking in with GPS + a selfie. Shops pay per verified visit from prepaid credit.

```
 iOS app (SwiftUI) ─┐
 Android (Compose) ─┼──► Supabase ─ Auth (anonymous, email; Apple/Google/LINE next)
 Web app (React)  ──┘     │        ─ Postgres 17 + PostGIS + RLS
                          │        ─ Storage: private `selfies` bucket
                          │        ─ Edge Functions: plan-route, verify-checkin, delete-account,
                          │                          stripe-checkout, stripe-webhook, purge-selfies
                          ├──► Valhalla routing (public server now, self-hosted later)
                          └──► Stripe (Checkout: card + PromptPay; webhook credits wallets)
 Shop dashboard (web) ──► same Supabase project
 Landing + web app hosted on Cloudflare Pages
```

## Stack and why

| Layer | Choice | Why |
|---|---|---|
| Database | Supabase Postgres + PostGIS | Geo queries in SQL (`ST_DWithin`, distance), one backend for three clients, RLS for per-user data |
| Auth | Supabase Auth | Anonymous sign-in lets anyone try instantly; native ID-token sign-in for Apple/Google |
| Server logic | Edge Functions (Deno) + SQL functions | No servers to run; money and verification logic in one SQL transaction |
| Routing | Valhalla | Free, walking + driving, time matrix API. Public FOSSGIS server caps 100 location pairs per request, so we chunk |
| Maps | MapLibre GL + OpenFreeMap (web), MapKit (iOS), Maps Compose or MapLibre (Android) | No API keys or map bills; the route line comes from our server |
| Payments | Stripe Thailand, prepaid credit packs | Stripe's PromptPay is one-time only, so prepaid packs avoid recurring billing; shop billing stays on the web so the iOS app needs no in-app purchase |
| Face check | MediaPipe (web), Vision (iOS), ML Kit (Android) | On-device face *presence* count only: no recognition, so no biometric identification data under PDPA |
| Hosting | Cloudflare Pages | Free, fast in Thailand |

## Algorithms

**1. Candidate prefilter (SQL `detour_candidates`).** A stop is possible only if `d(origin,stop) + d(stop,dest) ≤ d(origin,dest) + budget × speed` (an ellipse). Takes the best 5 of each group (nature, food, culture, shopping, other; ties: smallest detour first), then the top 22 by rating, so every themed plan has its kind of stop. Level-gated by `place_open_to`. Partner status is not used.

**2. Detour planner (`_shared/planner.ts`).** One Valhalla time matrix for origin, destination and candidates, then:
- Phase 0, meals (`_shared/meals.ts`): for each meal the user asked to stop for (request `meals`), insert the best cafe/food/market stop that arrives inside the meal window (early arrival waits for the window; the wait counts as extra time). None fits → `missed_meals`.
- Phase 1: greedy insertion choosing the stop and position with the highest `quality × theme weight × variety / added_minutes` (quality = rating / 5; theme weight ×2 for the theme's categories, `_shared/themes.ts`; a repeated category counts half), subject to total extra time ≤ budget, arrival within opening hours, rating ≥ 4.0. After each insertion a 2-opt pass shortens the order.
- Preferences (`interests`, `min_rating`, `include_unrated`, `max_stops`, `max_price`, `mode: bicycle`): the candidate SQL filters rating and known price; the planner takes the rating floor, a stop cap and, for **Your mix**, a ×2 weight on every kind the user's interest chips cover (`_shared/themes.ts` `INTERESTS`). Unrated places score as 3.5/5.
- `plan-route` runs the planner once per theme on the same shortlist and matrix (no extra routing calls), drops duplicate plans, and fetches road geometry per plan in parallel (straight-line fallback).
- The planner never sees whether a place pays (monetization v3: no paid placement).
- "Near this spot" cards (`places_near`): under park/viewpoint/temple stops, the best place within 400 m by rating then distance, signed up or not.

**Search.** `search_places` (SQL, trigram index on Thai + English names) finds our ~49k places by name or kind, nearest first. Places the user picks are sent as `must_include` and inserted before meals (planner phase 0a); they skip the rating floor but never the budget, opening hours or stop cap. Addresses we don't hold come from Apple MapKit search (iOS) or Photon (web), both free and OpenStreetMap/Apple based, never Google.

**3. Conversion estimate (`place_stats` view).** `p_checkin = (verified_visits + 0.3·10) / (impressions + 10)`: Bayesian average with prior 0.3. Every stop shown on a route is an impression (`route_stops`).

**4. Check-in verification (SQL `record_checkin`).** Distance ≤ 60 m, face present, selfie exists, not mock GPS, speed since last check-in ≤ 150 km/h, accuracy ≤ 50 m (else review), one reward per place per Bangkok day. Billing, wallet debit (row-locked) and badge awards run in the same transaction.

**5. Badges.** Collections (`temple-trail`, `cafe-hopper`, `indigo-and-silk`, `city-explorer`) list their places; a badge is awarded when a user's distinct rewarded places in the collection reach `required_count`.

## Data model

`places` (geography point, category, hours, dwell, rating, partner + bid + shop), `shops` (wallet), `routes` / `route_stops` (impressions), `checkins`, `billable_visits`, `collections` / `collection_places`, `user_badges`, `wallet_topups`, `profiles`. Migrations in `supabase/migrations/`.

## Privacy (PDPA) and store rules

- Selfies: private bucket, owner-only folder, deleted after 30 days (`purge-selfies`, pg_cron daily 03:17 UTC). Consent screen before the first selfie.
- No face recognition or embeddings anywhere.
- In-app account deletion (`delete-account`), App Store 5.1.1(v).
- Sign in with Apple must ship on iOS once Google/LINE login exists (4.8).
- Places that pay per visit are always labelled Partner; paying never changes rank.

## Seed data

55 Sakon Nakhon city places from OpenStreetMap (ODbL, attribution shown in the app). Ratings are a flat 4.2 placeholder. Eight independent places are marked **example partners** with demo shops and ฿500 demo credit; none has signed up.

## Before a real launch

- Self-host Valhalla (Thailand extract) and set `VALHALLA_URL`, `MATRIX_MAX_PAIRS`.
- Stripe account → set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; register webhook URL `…/functions/v1/stripe-webhook`.
- Custom SMTP for auth emails; Apple + Google OAuth setup.
- Verify App Attest / Play Integrity tokens server-side (clients already send them in `client.attest`).
- Real ratings (reviews) and opening hours from field data.
- Shop sign-up flow (owner claims a place, sets bid).

## Repo

```
web/          landing (index.html), app/, shop/, src/
supabase/     migrations/, functions/, seed_places.sql, seed_demo.sql
docs/         ARCHITECTURE.md, API.md, PLATFORMS.md
data/         osm.json (source of the place seed)
```
