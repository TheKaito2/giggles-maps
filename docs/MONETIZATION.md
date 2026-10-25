# Monetization plan (v5, decided 24 Oct 2026)

v5 replaces v4 (23 Oct). It **drops v3's "the route is never for sale"**: paying partners now come first on members' routes, always
labelled. Free users still get the quality order.

**Code:** migration `20261024000063_monetization_v5.sql`, `plan-route` (sign-in, quotas, partner boost, Partner picks plan),
`stripe-checkout` (partner / choice), web `AdBanner`, `Upgrade`, `BookingSheet`, the shop dashboard's Partner and Bookings sections.

## Prices

| What | Who pays | Price |
|---|---|---|
| Membership | user | ฿349 once, lifetime |
| Giggles Plus | user | ฿59 / month (30 days, no auto-renew on the web) |
| Partner | shop | ฿299 / month |
| Giggles Choice | a Partner we chose (apply first) | ฿799 / month, only after being chosen |
| Booking commission | shop | ฿20 flat per completed booking, from its prepaid credit |
| Verified visit | shop | its per-visit price, from its prepaid credit (unchanged from v3) |

## Users

### Everyone (free)
- Map, stamps, passport, photos, quests, coins, levels, the shop and Siam Si. Coins and levels are no longer a membership perk.
- A banner ad on the Feed, Quests, Leaderboard and Profile tabs. Never on the map, in directions, the detour planner or check-in.
- **Guests try one detour a day** (1 destination, 3 changes; then `403 sign_in_required`). Free accounts: 3 detours and 10 changes a day (Bangkok day).
  - A detour = one destination (rounded to ~100 m). The 3 time options and preference changes for it count once.
  - A change = one edit (add, remove or swap a stop). The planner's own retries of that edit count once.
  - Over the limit: `429 detour_limit` / `edit_limit`; the app shows today's usage and offers membership.
  - **Or watch an ad:** +1 detour (at the detour limit) or +5 changes (at the change limit), up to 3 ads a day, so at most 6 free
    detours a day. Google Ad Manager's web rewarded format fills it once `VITE_GAM_REWARDED_UNIT` is set (AdSense has no
    rewarded ads); until then it is our own 15-second ad. Web rewards can't be verified by Google, so the server pays out only
    15 s or more after the ad started (`start_ad_reward` / `claim_ad_reward`). On iOS, AdMob's server-side verification can
    replace this.

### Membership: ฿349 once
- No ads, forever.
- Unlimited detours and changes, inside a rate limit that keeps the router alive: 20 plans a minute and 300 a day
  (`429 slow_down`). Free accounts also stop at 100 plans a day, and an edit of a destination not planned today counts as a detour.
- Partner and Giggles Choice stops first: in members' plans a Choice place scores ×2 and a Partner ×1.5 (`boost` in `planner.ts`).
- 3 months of Plus free, once per account (`profiles.membership_plus_given`; Stripe and App Store alike).
- iOS: non-consumable `com.kristpaul.gigglesmaps.membership` (its App Store description needs updating for v5).

### Giggles Plus: ฿59 / month
- No ads.
- +20 coins the first time you open the app each day (`plus_daily`).
- The Plus shelf: items worn while Plus is active and never sold (`shop_items.plus_only`): the Plus explorer title, Holo foil and
  Aurora frames, Aurora flair. The existing Plus covers and flair stay free with Plus.
- 25% more coins from quests and a stamp every month (from v4).

### The Partner picks plan
A plan card that uses only Giggles Choice places (plus anything you picked). Everyone gets it when a Choice place is along the way.

## Shops

1. **Free listing** (unchanged): claim or add the place, hours, photos, products, counter QR sticker, visitor numbers.
2. **Partner, ฿299 / month.** Needs: the owner signed in (not a guest account) and a verified place (its counter QR scanned
   at least once). Gets: first on members' routes, a Partner badge, bookings through Giggles Maps.
3. **Giggles Choice, by invitation (not a plan you can buy).** Only a live Partner can apply (`request_choice`, else
   `partners_only`). An admin chooses (Profile → Settings → admin list). Only a chosen shop can then switch it on for
   ฿799 / month (checkout refuses Choice before approval). Gets: a Giggles Choice badge, ×2 on members' routes, and the
   Partner picks plan for everyone.
4. A tier runs 30 days per payment; paying again adds 30 days.

**Labelling:** every paid place shows its badge (Partner / Giggles Choice) on detour cards and the place page, with a tooltip
saying it pays. (Map pins don't show it yet.)

## Bookings

- Any Partner or Choice place shows a **Book** button: day (today up to 6 months), party size (1–20) and a note.
- Signed-in users only; at most 5 open bookings per user.
- One open booking per user, place and day. The shop sees the guest's nickname, day, party size and note (PDPA: no email or
  phone), and accepts (only with credit for the fee) or declines.
- **Charge:** when the guest's check-in there is approved within a day of the booked date, the booking is completed and ฿20 comes off the
  shop's credit (never more than the credit left; `bookings.charged_thb` records what was taken). Declined, cancelled and
  no-show bookings cost nothing.
- The guest pays the shop directly, as before; Giggles Maps never holds the money.

## Ads

- `web/src/app/AdBanner.tsx`. With `VITE_ADSENSE_CLIENT` and `VITE_ADSENSE_SLOT` set at build time, Google AdSense fills it.
  Without them it shows our own ads (membership, Plus, become a partner).
- Hidden for members and Plus. Every banner has a "Remove ads" link to the membership / Plus sheet.
- Still to do by hand: AdSense (web) and AdMob (iOS) accounts and their IDs.

## Security

Clients cannot write `profiles`, `shops.tier*`, `plan_usage`, `plus_logins` or `bookings` directly. Membership, Plus and tiers
change only through `apply_payment` (Stripe webhook) and the Apple functions. Quotas are checked server-side in `plan_allowed`
(service role only).

## Billing rules (attribution)

A shop is charged only for something it can see and check.

**Bookings**
- The booking comes through the app and the shop accepts it, so the booking itself is the proof.
- The stay or visit is confirmed with a check-in (counter QR scan + GPS ≤ 60 m + selfie).
- Commission is charged after checkout. No charge for declined bookings or for no-shows (beyond what the deposit rules say).

**Verified visits (no booking)**
- Check-in at a signed-up shop = **counter QR sticker scan** + GPS ≤ 60 m + selfie.
- Billable only if that place was **shown to the user (route stop or card) within ~3 hours** before the check-in.
- First visit per user per shop per **30 days** only.
- Tourists have a reason to scan: deals and stamps unlock only through the counter QR.

**For both**
- Auto-deducted from the shop's prepaid wallet; the shop can **dispute within 7 days**.
- The dashboard lists every charge (time, party size, booking code).
- Never bill for visits from before the shop signed up.
- An unsigned place is never shown as a partner or as if it pays.

## Partner contracts: hotels, homestays and restaurants (researched 23 Oct 2026)

### How the big platforms earn money

| Model | What happens | Reference numbers |
|---|---|---|
| Agency commission | Guest books on the platform and pays the hotel. The hotel pays the platform a % after the stay. | Booking.com about 15% base, Agoda about 15–20% (third-party figures). Booking Holdings agency revenue 2025: $7.97B (−6.5%). |
| Merchant (platform takes payment) | Platform charges the guest, keeps its margin, pays the hotel the rest. | Booking Holdings merchant revenue 2025: $17.76B (+25.5%). Expedia: $10.26B of $14.73B total. |
| Paid visibility | Hotel pays extra commission or funds a discount to rank higher. | Booking.com Preferred Partner about +2–3 points; Visibility Booster; Genius (hotel-funded discount). Advertising revenue 2025: Booking $1.19B, Expedia $1.29B. **Giggles Maps v5 does a flat-fee version (Partner / Giggles Choice), for members' routes only, always labelled.** |
| Per diner (restaurants) | Restaurant pays a fee per guest seated through the platform. | OpenTable $149–499/month + about $1–1.50 per network diner, about $0.25 via the restaurant's own widget. TheFork about €2–2.60 per diner. |
| Off-peak deals (restaurants) | Restaurant gives 10–50% off at quiet hours to fill empty tables. | Eatigo (Thailand). |
| Order commission (delivery) | Platform takes a % of each order. | GrabFood / LINE MAN about 15–30% (vendor estimates). |

Overall, Booking Holdings kept 14.5% of gross bookings in 2025. Hotel and restaurant rates above come from third-party sources; confirm with the platforms before quoting them in a pitch.

### What Giggles Maps will do

1. **Hotels and homestays: agency commission, charged after the stay.**
   - The guest sends a booking request in the app. The hotel confirms or declines it in the shop dashboard. The guest pays the hotel on arrival (plus an optional PromptPay deposit).
   - The stay is verified with the same check-in as other stops (QR sticker + GPS + selfie).
   - After checkout, the commission (within the 10–20% range in "Who pays") is auto-deducted from the hotel's prepaid wallet. The 7-day dispute rule applies.
   - Giggles Maps never holds the room payment, so refunds stay between guest and hotel.
   - Needs: a `bookings` table (dates, party size, room price, status), a confirm/decline screen and LINE notification for the hotel, and a stay check-in that triggers the charge.
2. **Restaurants: per verified visit.** Works like OpenTable's per-diner fee. Later options:
   - Table bookings charged per diner (party size × the shop's per-diner fee).
   - Off-peak deals in the Eatigo style, shown on the card when the place is already on the route.
3. **Later, only with real booking volume: merchant model.** Take the guest's payment through Stripe Connect (PromptPay is supported for connected accounts in Thailand) and pay the hotel out. This brings in more money but adds refunds, chargebacks and VAT work. Deposits use the same Stripe Connect setup.

### Contract terms

The agreement is a click-through in the shop dashboard, accepted when the shop claims its listing. Store the agreement version and acceptance time with the shop. It must cover:

- **Rate:** commission % (hotels) or per-visit / per-diner fee (restaurants), and the base it is calculated on (for example, the room price before tax).
- **No paid ranking:** signing up and fees never change route ranking.
- **When a fee is earned:** after a verified check-in or a completed stay.
- **No-shows, cancellations and deposits:** who pays what when the guest does not arrive or cancels.
- **Payment:** auto-deducted from the prepaid wallet; disputes within 7 days.
- **Licence warranty:** the hotel confirms it holds a Hotel Act licence or a homestay registration.
- **Personal data (PDPA):** which guest data Giggles Maps passes to the shop, and for what purpose.
- **Content licence:** the shop lets Giggles Maps use its photos and descriptions in the app.
- **Liability and role:** Giggles Maps is only the intermediary; the shop is responsible for its service.
- **Termination** by either side.
- **Tax invoices** for every charge.

### Thai legal checklist

- [ ] **Platform notification to ETDA.** Under the Royal Decree on digital platform services (B.E. 2565 / 2022), a platform that connects users for transactions must notify ETDA even if it is free. Source: law-firm commentary; check the Gazette text.
- [ ] **Hotel Act.** Section 15 makes daily or weekly rental without a hotel licence illegal. Take bookings only for licensed hotels and registered homestays, and keep the licence warranty from the contract.
- [ ] **PDPA.** Get the guest's consent before sharing their name or phone number with a hotel or restaurant.
- [ ] **VAT.** Register for VAT once revenue passes ฿1.8M a year (not re-checked).
- [ ] **Payments.** Deposits and any merchant-model payments go through Stripe Connect so Stripe holds and moves the money.

### Sources

- Booking Holdings FY2025 10-K: https://www.sec.gov/Archives/edgar/data/1075531/000107553126000009/bkng-20251231.htm
- Expedia Group FY2025 10-K: https://www.sec.gov/Archives/edgar/data/1324424/000132442426000008/expe-20251231.htm
- Booking.com Genius and Preferred Partner (Houst): https://www.houst.com/blog/booking-com-genius-program
- Agoda commission (Zeevou): https://zeevou.com/channels/agoda
- OpenTable pricing (Eat App): https://restaurant.eatapp.co/blog/opentable-pricing
- TheFork comparison (Carbonara): https://www.carbonaraapp.com/?p=20418
- Thai delivery commission (Klikit): https://klikit.io/en/learn/food-delivery-commission-fees-thailand-guide
- Eatigo model (YourStory): https://yourstory.com/2017/07/eatigo-startup-discounts-diners-restaurant
- ETDA notification (Tilleke & Gibbins): https://www.tilleke.com/insights/deadline-looms-for-digital-platform-notification-requirement-in-thailand/27/
- Hotel Act and short-term rentals (Mondaq): https://www.mondaq.com/hotels-hospitality/983656/airbnb-is-it-legal-in-thailand
- Stripe PromptPay: https://docs.stripe.com/payments/promptpay
