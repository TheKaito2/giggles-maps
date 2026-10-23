# Monetization plan (v3, decided 23 Oct 2026)

v3 replaces v2 (22 Oct). The main change: **no paid placement anywhere.** Shops pay for customers we deliver (bookings and verified visits), never for position.

**Code:** migration `20261023000009_monetization_v3.sql` + `plan-route` remove the paid slot, `partner_live` and the Starter plan, and replace `partners_near` with quality-only `places_near`. Not built yet: bookings, deposits, listing claims, deals/stamps unlocking only via the counter QR.

## Principle: the route is never for sale

1. Stops are ranked by quality only: rating, uniqueness (variety of categories), and fit inside the user's extra-time budget. Nature, scenic spots, temples, free places, unsigned places and signed-up shops are all ranked the same way.
2. Signing up, paying or bidding never changes a place's rank or whether it appears on a route.
3. "Near this spot" cards at nature/temple stops are picked the same way: best nearby places by quality, signed up or not.
4. No "Partner" slot and no paid stops.

## What a shop gets for signing up

Signing up (claiming the listing) is free. Unsigned places stay in routes as normal listings with information and directions only. Signed-up shops get:

1. **Bookings.** A Book / Reserve button on their card. Requests (name, dates, party size, booking code) arrive in the shop dashboard and as a LINE message. The shop accepts or declines.
2. **Listing control.** Correct opening hours, a "closed today" switch, photos, menu and prices, and descriptions in Thai, English and Chinese. Unsigned listings use our data, which can go stale.
3. **Deals.** An offer on their card, such as a free drink with a check-in or 20% off from 2–4 pm. A deal is shown only when the place is already on the route or card by quality. Deals also appear in the **free** coupon spin after a check-in. No paid spins (odds-disclosure rules, and possible Thai gambling-law problems).
4. **Visitor data.** How many tourists were routed past or stopped, at which hours, where they came from, and how many came back.
5. **Deposits.** Homestays, guides and boat trips can take a PromptPay deposit at booking, so a no-show still leaves them something.
6. **Their own stamp.** A custom stamp design in the badge collection. Collectors choose to go; rank is unchanged.
7. **Replies** to reviews and guest questions.

The pitch to an unsigned place: "Giggles sent 34 tourists near you last month and none of them could book. Sign up to take bookings, show a deal and see your numbers."

## Who pays

| Payer | What they pay |
|---|---|
| Hotels, homestays, guides, boat trips | Booking commission (10–20%), charged after the stay or trip |
| Restaurants, cafés, shops | Per verified visit (their per-visit fee), or per diner for table bookings |
| Community enterprises | Same as shops, possibly subsidised |
| Province / TAT | Sponsored trails (themed collections users choose to follow; every stop still meets the quality rules) + visit reports |
| Users | **Giggles Plus**: bigger extra-time limit, cosmetic badges, offline maps later. iOS sells it through StoreKit, Android through Google Play Billing, web through Stripe. |

No monthly plans for shops: no customers, no bill. The v2 Starter ฿299/month plan is dropped.

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
| Paid visibility | Hotel pays extra commission or funds a discount to rank higher. | Booking.com Preferred Partner about +2–3 points; Visibility Booster; Genius (hotel-funded discount). Advertising revenue 2025: Booking $1.19B, Expedia $1.29B. **Giggles Maps does not do this.** |
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
