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

## Phase 2 (not built yet)
Friends (passports visible to friends only), Ride along (shared trip by link, group check-in bonus, shared album,
live locations during the trip), public all-time leaderboard, coin shop (passport covers, map skins, photo frames and
stickers, flair and titles).
