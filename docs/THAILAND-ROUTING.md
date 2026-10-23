# Thailand routing integration (PR #1)

## Integration with current main

This branch includes membership v4 (`757d7b5`) and the themed/meal-aware engine
(`8c9607d`). The routing migration is **20261023000012_thailand_route_corridor.sql**,
after the membership and route-theme migrations already applied in production.

- `unlock_level` is computed server-side and passed to the corridor RPC, which
  calls `place_open_to(p, p_level)`. Public POI search returns only `min_level = 0`.
- Everyone can request up to 240 extra minutes. The response retains `member`,
  `level`, `plus`, `plans`, `meals`, `missed_meals`, and each stop's membership metadata.
- Shared `planner.ts`, `themes.ts` and `meals.ts` produce proposals for all five
  themes. Theme boosts, category variety and quality govern selection; fees never do.
  Top-level fields remain Top picks. A requested theme only reorders `plans`.

## Road routing and fallback

The public Valhalla matrix rejected Khon Kaen -> Sakon Nakhon in testing, even
though its route endpoint could supply detailed road geometry. The old fallback
silently turned long trips into straight segments. The integrated approach is:

1. Request the direct A -> B road route.
2. Short trips (endpoints within 10 km) retain a 16-place matrix shortlist.
   Intercity trips use a 22-place shortlist in a spatially indexed road corridor.
   Each shortlist has a quota per nature/food/culture/shopping/other group.
3. For intercity proposals, scale estimated travel by the known direct road time.
   These estimates propose orders only; they never approve a road detour.
4. Check complete road routes for proposed themes, including dwell, arrival hours
   and meal waiting time. Trim discretionary stops before meals if the actual road
   time exceeds the allowance. Lost meals appear in `missed_meals`.
5. Share a route-response cache and seven additional route-call limit across all
   themes, with a 24-second start deadline and 8-second request timeouts. Verification
   is sequential; local matrix chunks run at most two at a time. The baseline call
   and up to four local matrix calls (16 candidates) are separate from this cap.
6. If a candidate route fails, keep the verified direct road route and warn.
   If the baseline fails, only local pedestrian trips may use the estimate fallback.
   Its line is dashed and labelled approximate, never presented as road directions.
   Intercity/driving baseline failures return 503 `routing_unavailable`.

Times remain estimates of future travel; traffic and actual visit durations vary.
This is a bounded heuristic, not exhaustive optimization. The corridor radius is
capped at 20 km. Configure `VALHALLA_URL` for a dedicated Thailand-capable routing
service before relying on it for production availability; the public demo has
fair-use limits. Requests carry `X-Client-Id: giggles-maps.pages.dev`.

## Nationwide seed and staged rollout

`supabase/seed_thailand.sql` has 5,070 named OSM places: 3,163 attractions/viewpoints,
1,408 parks and 499 museums. National parks recognizable by tags or Thai/English
names are categorized as parks with 90-minute dwell; waterfalls use 45-minute dwell.
These are planning defaults, not verified visit-duration data. Other dwell defaults
remain category-based. Real opening hours, entrance positions and reviews need curation.
The existing schema's 4.2 rating is a placeholder, not an assertion of quality.

Source: offline OpenStreetMap/Overpass Thailand snapshot, OSM timestamp
`2026-10-23T03:02:49Z`, ODbL attribution. The original query selected named
`tourism=museum|viewpoint|attraction` and `leisure=park` features in the Thailand
admin-level-2 area, using `out center tags`. It is never run for a user's trip.

The importer skips existing OSM IDs and approximately deduplicates named node/way
representations. It never overwrites partner, QR, wallet or billing records.
Rounding boundaries, alternate names and way-center entrance positions need review.
No new collection membership is added. Coverage is not a complete address database.

Start with a reviewed region instead of applying every row immediately:

```sh
python supabase/tools/import_thailand_places.py thailand-attractions.json --output region-places.sql --bbox 16.8 103.8 17.5 104.5
```

The box is an example rollout region around Sakon Nakhon, not an administrative
boundary. Omit `--bbox` for the full national seed. Standard Python supports JSON.
The optional Geofabrik PBF path requires `osmium`; it was not verified on this
Windows host because application control blocked its native DLL. Raw extracts
must stay outside Git. Relations are omitted by that optional PBF path.

## Deployment handoff

No production database/import/deployment was performed from this workspace.

1. Review and merge PR #1 after approval; pull the merged `main`.
2. In the existing Supabase project, preview pending migrations with
   `supabase db push --dry-run`, then apply them with `supabase db push`.
   Confirm membership 010 and route themes 011 precede corridor **012**.
3. Review/apply a regional seed with the SQL Editor or authenticated `psql`:
   `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f region-places.sql`.
   Roll out `supabase/seed_thailand.sql` after regional verification. The seed is
   separate from migrations and will not overwrite existing OSM IDs.
4. Deploy `plan-route` with its existing authentication:
   `supabase functions deploy plan-route --use-api`.
5. Build/deploy web with the existing publishable config in `web/.env`:
   `npm ci`, `npm run build`, then
   `wrangler pages deploy dist --project-name giggles-maps --branch main`.
6. Verify all themed plans, meals/early waiting, membership-gated places and public
   search. Test Khon Kaen -> Sakon Nakhon (Drive, +45), Bangkok -> Chiang Mai,
   short Sakon walks, zero budget, empty coverage and provider failures.
   Check the corridor query with `EXPLAIN (ANALYZE, BUFFERS)` on PostGIS.

## Validation

```sh
node --test supabase/functions/_shared/road-detour.node.test.ts
python -m unittest discover -s supabase/tools -p 'test_*.py'
cd web && npm ci && npm run build
```

Routing regressions cover complete-road duration/dwell, destination preservation,
meal waits and trimming, the shared provider cap/cache, local-only estimate policy,
theme scoring and provider failures. Import tests cover regional rollout, nature
visit defaults, SQL escaping, duplicate POIs and JSON way centers. Edge TypeScript
is checked with a local Deno environment declaration. Native Deno installation,
PostGIS execution/performance and deployed end-to-end behavior remain unverified
on this host. Live checks of the integrated helpers returned Khon Kaen -> Sakon Nakhon with
a ~15-minute detour and 1,990 road points, and Bangkok -> Chiang Mai with 5,752
road points (~564.88 driving minutes). These are provider/helper checks, not
proof of deployed database/membership behavior; repeat end-to-end checks after rollout.
