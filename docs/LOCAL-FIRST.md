# Local first: local shops, community enterprises and OTOP

Giggles Maps sends travellers to independent and community businesses first. This page is the published rule.

## The boost (free, the same for everyone)
- Every place carries three flags: `local` (an independent food, café, craft or market business, not a chain),
  `otop` (an OTOP producer or shop) and `community` (a community enterprise, วิสาหกิจชุมชน).
- The detour planner multiplies a stop's score by **1.6** for OTOP and community places and **1.3** for other local
  places. Every plan that has room left in its time and stop limit includes at least one local stop.
- The Local gems style only uses local places. Map pins rank landmarks first, then OTOP and community places, then
  local ones. OTOP & local is the second Explore chip.
- **Payment never changes ranking.** Partner shops pay per verified visit (see `MONETIZATION.md`), but that money buys
  analytics and the counter sticker, never a higher place in a plan or on the map. The local boost is separate and free.

## Where the places come from
1. **OpenStreetMap + Claude Haiku tagging.** The importer (`supabase/tools/import_thailand_places.py`) sorts places
   into kinds and flags OTOP and community names. Chains are recognised by their `brand` tag or a hand-checked list of
   national chains. OSM tags only 46 OTOP places in Thailand, so the other sources matter.
2. **Owners add or claim their shop** at `/shop/`. It is free and needs a signed-in account (not a guest). Owners set
   their hours, phone, website, a short description, their products (name, price, photo) and photos. OTOP status, the
   OTOP star level (★1-5) and community enterprise status are **requested** and confirmed by an admin (ideally against
   the CDD register) before they show, because they pay travellers extra XP. Only shops can be claimed (not temples,
   parks, landmarks, partner or example listings); an admin can release a wrong claim. Claiming issues a counter QR
   code; the place shows **Verified shop** after a traveller scans it at a check-in.
3. **Traveller nominations.** Add place → a local kind → a photo, pinned where you stand (signed-in accounts only).
   Two other travellers with accounts at least a week old confirm it within 50 m (Quests → Local Hero) and it goes
   live; unconfirmed nominations expire after 30 days. The nominator gets +100 XP and progress on the Local Hero
   badge; each confirmer gets +20 XP.
4. **Community Development Department lists.** Provincial CDD offices keep OTOP producer lists. `docs/CDD-letter.md`
   is a request letter; `supabase/tools/import_otop_csv.py` turns a list (name, product, district, address or lat/lng)
   into reviewable SQL, geocoding addresses with Photon.

## Making people go
- Quest: **Support local**, stamp 3 OTOP or community places this week (+200 XP, +40 coins).
- Collections: **OTOP Explorer** 10 / 25 / 50 places.
- OTOP and community stamps give **+50% XP**.
- Feed: a weekly **Local spotlight**, one OTOP or community place per province chosen by visits, reviews and photos.
- Place pages explain what an OTOP producer or community enterprise is and show the products.

## Measuring it
Admins see, per province over 30 days, OTOP and community check-ins, new shops, nominations and the share of planned
stops that were local (Profile → admin section, `local_stats()`).
