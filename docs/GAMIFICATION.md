# Passport & gamification (phase 1)

Check-in works like a PokéStop: places around you show on the map (gold = landmark, silver = worth a visit,
bronze = everyday) and glow when you're inside their zone. Tap **Check in**, take any photo, done.

## Check-in rules (`record_checkin`, called by `record_checkin_v5`)
| Rule | Value |
|---|---|
| Zone | 150 m for landmarks (tier 3) and parks, 50 m elsewhere |
| Photo | required, anything (no face check); kept as the passport album until hidden/deleted |
| GPS | accuracy over 75 m → review; fake GPS or >150 km/h since the last check-in → rejected |
| Rewards | first visit to a place only; repeat visits just add a photo |
| Members-only places | need the member level (unchanged) |

## Rewards (first visit)
| | Landmark | Worth a visit | Everyday |
|---|---|---|---|
| XP | 150 | 75 | 30 |
| Coins | 30 | 10 | 3 |

- +100 XP for your first stamp in a new province.
- XP is banked for everyone; **levels and coins need the ฿349 membership**. Coins are computed (`coins_of`):
  stamp coins + challenge coins + 50 per level reached, so joining pays out everything already earned.
- Giggles Plus: +25% coins from stamps and challenges. Coins can't be bought.
- Levels: `level_for(xp)`, thresholds 300, 800, 1500, 2500, 4000, 6000, 8500, 11500, 15000.

## Challenges (`challenge_progress`, claimed automatically by `claim_challenges`)
| Challenge | Goal | XP | Coins |
|---|---|---|---|
| Daily | check in somewhere today | 30 | 5 |
| Weekly | 3 landmarks this week | 200 | 40 |
| Weekly | a kind of place new to you this week | 100 | 20 |
| Province set (one per province, shown once you've stamped there) | 5 of its landmarks, or all if fewer; title "<Province> Explorer" | 500 | 100 |
| Collections | 10 waterfalls · 20 temples · 5 national parks · 10 museums · 5 night markets | 300 | 60 |

Days and weeks use Bangkok time. Each claim is stored once per period (`challenge_claims`).

## Events
Rows in `events` (slug, names, start, end). A first visit during an event also tags the stamp with that event.
Empty by default: add one with SQL, e.g.
`insert into events values ('loy-krathong-2026', 'Loy Krathong 2026', 'ลอยกระทง 2569', '2026-11-24 00:00+07', '2026-11-26 00:00+07');`

## Data
- `provinces`: 77 provinces from OpenStreetMap admin boundaries; `places.province_id` set by a trigger.
  The web map uses a simplified copy, `web/public/provinces.geojson`.
- `stamps` (one per user and place) and `challenge_claims` are the reward ledger.
- `passport_v2()` returns profile, stamps, photos, provinces and challenge progress in one call.
- `stops_near(lat, lng, radius)` returns map stops with zone size and whether you have the stamp.

## Social (phase 2, migration 022)
- **Names**: everyone picks a nickname (2–20 chars) and one of 8 avatar colours (`set_me`). Other people never see emails.
- **Friends**: every profile has an 8-character `friend_code`. The friend QR is a link, `/app/?friend=CODE`, that phone
  cameras open. `add_friend(code)` sends a request, or accepts one if they already asked you. Requests expire after 7 days.
  Friends see each other's passport (`friend_passport`): stamps, province map, level and photos that aren't hidden.
- **Leaderboard** (`leaderboard`): all time, by XP; top 50 plus your own row and rank. Shows nickname, colour, level,
  XP and stamp and province counts, never photos. Everyone with a nickname and XP is on it unless they opt out.
- **Ride along**: `start_trip` gives a 6-character code; others join with `/app/?trip=CODE` or `join_trip`. A trip runs
  at most 12 hours (or until the owner ends it), with up to 20 people, and you're in one trip at a time.
  - Live positions (`trip_ping`, sent at most every 30 s by the web app) are shown to trip members only. A position
    older than 10 minutes is hidden, and all positions are wiped when the trip ends or you leave.
  - The shared album is every member's photo (not hidden) taken during the trip.
  - **Group bonus**: if you get a stamp at a place where another member of your running trip checked in within the
    last 60 minutes, your stamp gets +50% XP and coins, and so does their stamp at that place (once, `stamps.group_bonus`).
- Photos: the storage policy `can_see_photo` lets friends and trip-mates (for photos from that trip) open a photo,
  unless it is hidden or the check-in was rejected.

## Coin shop
Coins are earned only, never bought. `coins_of` = earned − spent (`coin_spends`). Members buy (`buy_item`), anyone
wears what they own (`equip`). Items marked Plus are included while Plus is active; `look_of` drops anything you
no longer own, e.g. after Plus ends. Titles can also be a completed province set ("<Province> Explorer").

| Kind | Items (coins) |
|---|---|
| Passport covers | Classic 0 · Indigo cloth 150 · Lotus 150 · Rainy season 150 · Night market 200 · Temple gold 300 (all except Classic included with Plus) |
| Name flair | Plain 0 · Marigold 100 · Indigo 100 · Lotus 100 · Sparkle 250 (included with Plus) |
| Map skins | Standard 0 · Bright 150 · Paper 150 (OpenFreeMap styles) |
| Photo frames | None 0 · Polaroid 100 · Film strip 150 · Postage stamp 200 · Gold leaf 250 |
| Titles | Wanderer 50 · Foodie 150 · Temple hopper 150 · Road tripper 200 · Trailblazer 400 · Legend of the road 1000 |
