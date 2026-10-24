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

## App shell (migration 024): Duolingo-style
Tabs: Map · Leaderboard · Quests · Feed · Profile (bottom bar on phones, sidebar on desktop). The top bar shows level/XP,
provinces N/77 and coins; tapping coins opens the Shop.

- **Avatar**: a mix-and-match character (`web/src/app/avatar/parts.tsx`): skin, face, eyes, brows, mouth, hair + colour,
  facial hair, glasses, headwear, outfit + colour, background. `public.avatar_parts` whitelists every part id
  (keep it in sync with `parts.tsx`); 15 premium parts are `shop_items` of kind `avatar` (100-500 coins) and are bought
  inside the builder. `set_avatar` checks ids and ownership.
- **Passport book**: cover, ID page, Thailand map, 77 province visa stamps (drawn from each province outline, region ink,
  one of five stamp shapes), place entries, photos. Illustrated art can replace a province stamp later by adding
  `/stamps/<iso>.webp` and its ISO code to `ART` in `ProvinceStamp.tsx`.
- **Feed** (`feed`, `react`, `nudge`): stamps, new provinces, level-ups, quests, badges and nudges from you and your
  friends, last 30 days. Reactions: heart, fire, clap, wow (one per person per item). Nudge: once per friend per 20 h.
- **Achievements** (`achievements`, computed): 10 badges with tiers I-V

  | Badge | Counts | Tiers |
  |---|---|---|
  | Province Hopper | provinces | 1 / 5 / 15 / 40 / 77 |
  | Landmark Hunter | landmark stamps | 1 / 5 / 15 / 40 / 100 |
  | Collector | stamps | 5 / 25 / 75 / 200 / 500 |
  | Shutterbug | photos | 1 / 10 / 50 / 150 / 400 |
  | Foodie | food stamps | 1 / 10 / 30 / 75 / 150 |
  | Temple Runner | temple stamps | 1 / 10 / 30 / 75 / 150 |
  | Social Butterfly | friends | 1 / 3 / 10 / 25 / 50 |
  | Road Crew | ride-along trips with others | 1 / 3 / 10 / 25 / 50 |
  | Quest Master | quests claimed | 5 / 25 / 100 / 250 / 500 |
  | High Flyer | level | 2 / 4 / 6 / 8 / 10 |

- **Friends Quest** (weekly): pick one friend (`set_friend_quest`); 10 new stamps between you this week gives both
  +150 XP and +40 coins. Opening the Quests tab claims finished quests (`claim_quests`).
- **Profile** (`profile_of`): yours or a friend's: avatar, title, joined date, stats, all-time rank, badges, passport.

## Siam Si (เซียมซี) fortune sticks
- Every first-visit (rewarded) check-in earns one shake, used in the check-in ceremony. Bonus shakes (kept up to 5):
  +1 per finished quest, +1 for a new province, +1 per ride-along group stamp (at most 3 a day).
- A shake gives a numbered stick (1-28; its fortune is in `web/src/app/fortune/fortunes.ts`) and a prize:

| Rarity | Odds (at a landmark) | Prize |
|---|---|---|
| Common | 60% (45%) | 10-20 coins or +30 XP |
| Rare | 30% (38%) | 40-60 coins, 24 h x1.5 stamp XP, or a shop item up to 150 coins you don't own |
| Epic | 9% (14%) | 120 coins, 3 days x1.5 stamp XP, or a shop item 200-500 coins you don't own |
| Legendary | 1% (3%) | A Siam Si-only item (titles Fortune's favourite / Siam Si master, Golden naga frame, Fortune flair, Red lacquer cover), else 500 coins |

- Pity: the 10th shake in a row without a Rare is Rare or better; the 80th without a Legendary is Legendary.
- Free and earned only: shakes can't be bought with money, coins or Plus. Odds are shown in the app. At most 30 shakes a day.
- Coins from shakes count for members (like every coin); guests and free users keep them for when they join.
- Server: `shake_fortune(p_checkin)` (migrations 049-050), odds in `fortune_rarity`, history in `fortune_pulls`.

## Profile, passport, shop, feed and sharing (migration 054)
- **Profile:**
  - a hero in your passport-cover colours, with your provinces filled in on a small map;
  - level and XP to the next level;
  - a showcase of 3 pinned badges or stamps;
  - quick buttons for Passport, Logbook, Shop and Siam Si.
  - Settings (demo mode, admin, account and membership) live in a sheet behind the gear.
- **Passport:** the book holds the 77 province visas and landmark stamps only. Every check-in is in the **Logbook**,
  newest first and grouped by day, with photos.
- **Shop:**
  - a featured themed set each week; buying the set costs 25% less than its missing items;
  - 6 daily picks, the same for everyone, new at midnight Bangkok time;
  - everything else by kind.
  - Rarity follows price, with the same names as Siam Si: up to 150 Common, up to 400 Rare, above that Epic; Siam Si-only items
    are Legendary.
  - Tap any item to try it on before buying.
  - Sets so far: Songkran, Loy Krathong, Isan Silk (5 items each: cover, frame, flair, title, avatar item).
- **Feed:**
  - A person's stamps from one day merge into one card, with a photo strip and place chips.
  - Reactions are a row of 4 emoji.
  - Friends can comment: 280 characters, 30 a day. The author or the post's owner can delete a comment.
- **Share cards** (`web/src/app/share/`), drawn on a canvas and shared or saved as PNG:
  - a photo story (1080x1920);
  - a clear sticker for Instagram Stories (1080x1080);
  - a province progress map;
  - milestones (new province, level-up, badge, Epic or Legendary Siam Si);
  - a ride-along trip card.
  - Classic is free; Postcard, Night neon and Indigo cloth come with Plus.
- **Ride-along album:** stays with the group. Save all and a trip card; nothing goes to the feed.

## Quests are claimed by hand (migration 057)
A finished quest's chest wobbles in the Quests tab until you tap **Claim**. Then the chest shakes, bursts open and shows the
XP, coins and bonus Siam Si shake. Check-ins only say a quest is ready.

## Passport photos (migration 056)
- **Visa pages:** a province's visa shows your first photo there, tucked behind the stamp.
- **Landmark pages:** each landmark stamp sits beside its check-in photo.
- **Memories:** every check-in photo, no longer capped at 48.
- **Ride-alongs page:** 3 photos from each trip's album (first, middle and last). People who were on the trip keep seeing those 3
  after it ends.
