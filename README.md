# Giggles Maps

Tell it where you're going and how much extra time you're OK with. It fills that time with the best local stops in Sakon Nakhon (ranked on quality only; paying never moves a shop up), and you check in with a selfie to collect stamps. Shops pay only for verified visits.

- Live: https://giggles-maps.pages.dev (landing) · `/app/` (web app) · `/shop/` (shop dashboard)
- Docs: [architecture](docs/ARCHITECTURE.md) · [API contract](docs/API.md) · [iOS vs Android](docs/PLATFORMS.md) · [Android roadmap](docs/ANDROID-ROADMAP.md) · [monetization plan](docs/MONETIZATION.md)
- Agents: start at [AGENTS.md](AGENTS.md); Android: [android/AGENTS.md](android/AGENTS.md)

## Run the web app

```bash
cd web
cp .env.example .env   # fill in the Supabase URL + publishable key
npm install
npm run dev
```

## Run the iOS app

```bash
cd ios
xcodegen generate                      # creates GigglesMaps.xcodeproj (not committed)
open GigglesMaps.xcodeproj             # or: xcodebuild test -scheme GigglesMaps -destination 'platform=iOS Simulator,name=iPhone 17'
```

In the Simulator use the check-in sheet's demo toggle: simulator GPS is flagged as simulated, and Vision falls back to Core Image there.

## Backend

```bash
supabase link --project-ref xrlxfvwrkowaybtkkrdl
supabase db push                         # migrations
supabase functions deploy --use-api      # edge functions
bun test supabase/functions/_shared      # planner tests
```

Secrets (set with `supabase secrets set`): `CRON_SECRET`, `SITE_URL`, later `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VALHALLA_URL`.

## Deploy the web app

```bash
cd web && npm run build && wrangler pages deploy dist --project-name giggles-maps --branch main
```

## Map layers and offline maps

- Night map (Layers button on the map): OpenFreeMap `dark`, Auto from 18:30 to 06:00, or always on/off.
- Offline province maps: one Protomaps PMTiles pack per province in the R2 bucket `giggles-maps-offline`
  (public at `https://pub-33a938fc0962483c8bdce739ffec9e22.r2.dev`, CORS for the site and `localhost:5181`).
  Rebuild from a newer Protomaps daily build (needs the `pmtiles` CLI at `.tools/bin/pmtiles`, not committed):

```bash
python3 supabase/tools/offline_packs.py --build 20261020 --upload
```

  The app saves a pack in Cache Storage and switches to it when the device goes offline; `public/sw.js` keeps the app
  itself, the map fonts and icons loadable with no signal. Planning, directions and check-ins still need a connection.

Place data © OpenStreetMap contributors (ODbL).
