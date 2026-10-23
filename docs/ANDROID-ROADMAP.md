# Android roadmap: features ranked by importance

Ranked by what matters most: first a working demo with the same features as the web app (judges score completeness 30/100 and business model 30/100), then what a Play Store launch needs, then the monetization rebuild.

The backend is already live and shared. Android only builds the client. Reference implementation for every screen: the web app in `web/src/app/` (React). If Android and web disagree, `docs/API.md` wins.

Status key: ✅ backend ready · 🟡 backend partly ready · 🔴 backend not built yet (don't start until it ships)

---

## P0: demo parity with the web app (build these first, in this order)

| Rank | Feature | Done when | Backend |
|---|---|---|---|
| 1 | **Supabase client + anonymous session** | App opens, signs in anonymously on first launch, session survives app restart. | ✅ `signInAnonymously` |
| 2 | **Map screen** | MapLibre Native map centred on Sakon Nakhon (17.163, 104.149), zoom ~13.4, OSM attribution visible. | ✅ none needed |
| 3 | **Plan a route** | Start + destination (tap map, or "use my location" for start), leave time, extra-minutes slider 0–120 step 5, Walk/Drive toggle, "Find my detours" button. Draws `geometry` polyline, A/B pins, numbered stop pins. Stop list shows ETA (HH:mm from `eta_min`), category, dwell minutes, Partner chip. Summary: `+extra_min of +budget_min min used`, `trip total_min min instead of base_min`. Shows "Times are estimates" when `routing == "estimate"`. | ✅ `plan-route` |
| 4 | **Selfie check-in** | Tap "Check in" on a stop → consent (first time only) → CameraX front preview → capture → ML Kit face count → Fused location (high accuracy, accuracy + isMock) → upload JPEG to `selfies/<user_id>/<millis>.jpg` → call `verify-checkin` → result screen. | ✅ `verify-checkin` + Storage |
| 5 | **Result + stamp** | Approved + rewarded → stamp animation + "Checked in!". Show every `reasons[]` with the user text from `android/AGENTS.md`. Show `new_badges[]`. | ✅ |
| 6 | **PDPA consent screen** | Shown before the first selfie, stored locally (DataStore). Text: one selfie + location; face presence only, no recognition; selfie private, auto-deleted after 30 days; delete account any time. | ✅ |
| 7 | **Passport tab** | 4 collections with dot progress (distinct rewarded places in the collection vs `required_count`), "Earned" stamp when badge exists, last 8 check-ins with status chip. | ✅ table reads (RLS) |
| 8 | **Delete account** | Button in Passport with an in-app confirm step → `delete-account` → sign out → fresh anonymous session next time. | ✅ `delete-account` |
| 9 | **Demo mode toggle** | Debug/demo builds only: "I'm not in Sakon Nakhon: simulate being here". Sends the stop's own lat/lng, accuracy 5, `client.demo = true`. Server only allows it at example places. | ✅ |

**P0 exit check:** on a physical phone, plan a +45 min walking route from Phu Phan Museum (17.17313, 104.14488) to Wat Phra That Choeng Chum (17.16445, 104.15345) at 10:00, check in at stop 1 in demo mode with a real selfie, see the stamp, see it in Passport, then delete the account.

## P1: needed for a Play Store launch

| Rank | Feature | Done when | Backend |
|---|---|---|---|
| 10 | **Google sign-in + upgrade anonymous account** | Credential Manager → Google ID token → `signInWithIdToken`, linking to the existing anonymous user so stamps survive. | 🟡 Google is on; send Krist your package name + signing SHA-1 so he can add the Android client ID |
| 11 | **Play Integrity token** | Standard request with `requestHash` = SHA-256 of the check-in body; send as `client.attest`. | 🟡 stored now, verified later |
| 12 | **Mock-location + permission handling** | `Location.isMock()` (API 31+) / `isFromMockProvider()` below; clear messages when location or camera permission is denied, with a path to Settings. | ✅ |
| 13 | **App Links for shop QR codes** | `https://giggles-maps.pages.dev/app/?scan=<place_id>-<code>` opens the app straight into check-in for that place. Needs `assetlinks.json` on the site (send Krist the SHA-256 cert fingerprint). | 🟡 web hosting ready, file not added yet |
| 14 | **Thai + English strings** | All UI strings in `values/` (EN) and `values-th/` (TH). Place names: show `name`, and `name_th` under it when different. | ✅ |
| 15 | **Errors, offline, retries** | Every error code in `docs/API.md` maps to a friendly message. No crash with no network; retry button. | ✅ |
| 16 | **Next-stop geofence nudge** | Geofence (radius 100 m) on the next 1–3 stops of the active route; local notification "You're near <stop>". | ✅ client-only |
| 17 | **Live Update during a trip** | Android 16 `ProgressStyle` notification "Next stop: N min, 2 of 3 stops". Navigation-type use only, never promos. Fall back to a normal ongoing notification below API 36. | ✅ client-only |

## P2: monetization rebuild and extras (wait for backend 🔴)

Monetization v3 (no paid placement; see `docs/MONETIZATION.md`, `docs/API.md`). Plus via Play Billing still needs a server-side receipt check before launch.

| Rank | Feature | Backend |
|---|---|---|
| 18 | Counter QR scan at partner stops (ML Kit barcode scanner + code entry fallback; sticker link `/app/?scan=<id>-<code>`) | ✅ |
| 19 | Quality-only route (Partner label on any signed-up shop) + "Near this spot" cards under nature/temple stops (Partner label only when the card's `is_partner`) | ✅ |
| 20 | Free coupon spin after a rewarded check-in, with odds shown + coupon wallet in Passport | ✅ |
| 21 | **Giggles Plus** subscription (bigger extra-time limit, cosmetic badges, offline maps later) via Google Play Billing | 🟡 routing ready; Play receipt check not built |
| 22 | LINE login | 🔴 |
| 23 | Home-screen widget (Glance): badge count / nearest stop | ✅ |
| 24 | Push notifications (FCM): new badge, trail updates | 🔴 |

## Not for the Android app

- Shop dashboard and shop payments: web only (`/shop/`), Stripe. Never link to shop top-ups from the consumer app.
- Any write to check-ins, billing, wallets or badges: server only.
