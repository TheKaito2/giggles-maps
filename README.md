# Giggles Maps

Tell it where you're going and how much extra time you're OK with. It fills that time with the best local stops in Sakon Nakhon (at most one paid Partner stop), and you check in with a selfie to collect stamps. Shops pay only for verified visits.

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

Place data © OpenStreetMap contributors (ODbL).
