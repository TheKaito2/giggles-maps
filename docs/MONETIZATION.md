# Monetization plan (decided 22 Oct 2026, built 23 Oct 2026)

Live on the backend and web app (migration `20261023000004_monetization.sql`, `docs/API.md`). Not built yet: booking commissions, province visit reports, StoreKit / Play Billing receipt checks for Plus, offline maps.

## Principle: the route is never for sale

1. Stops are ranked by quality: rating, uniqueness (variety of categories), and fit inside the user's extra-time budget. Nature, scenic spots, temples and free places are included on merit.
2. **At most 1 paid slot per route.** It only uses leftover minutes and never pushes out a better free stop. Quality floor: rating ≥ 4.0. Always labelled **Partner**.
3. Which partner gets the slot: **relevance × bid**. A café next to a waterfall already on the route beats a higher bid that's off the route.

## Where ads appear

- One Partner detour stop per route (rule 2).
- "Near this spot" card at nature/temple stops: a nearby café, rental or food stall. A card, not a stop.
- Coupons in a **free** spin after a check-in. No paid spins (odds-disclosure rules, and possible Thai gambling-law problems).
- Sponsored trails (collections) paid by the province or TAT.

## Who pays

| Payer | What they pay |
|---|---|
| Nearby businesses | Per verified visit (their bid) from prepaid credit, or a flat **Starter ฿299 / month** |
| Homestays, guides, boat trips | 10–20% booking commission (later) |
| Community enterprises | Same as businesses, possibly subsidised |
| Province / TAT | Sponsored trails + visit reports |
| Users (new) | **Giggles Plus**: removes the Partner stop and cards, bigger extra-time limit, cosmetic badges, offline maps later. Extra revenue on top of shop payments. iOS must sell it through StoreKit, Android through Google Play Billing, web through Stripe. |

## Billing rules (attribution)

- Triggered by the tourist; the shop can't block it.
- Check-in at a partner = **counter QR sticker scan** + GPS ≤ 60 m + selfie.
- Billable only if that stop or card was **shown in the user's route within ~3 hours** before the check-in.
- First visit per user per shop per **30 days** only.
- Auto-deducted from the shop's prepaid wallet. The shop can **dispute within 7 days**.
- The planner only routes to partners with recent verified QR scans, so hiding the QR sticker means no traffic.
- Shop dashboard shows impressions (times shown on routes or cards) and verified visits.
