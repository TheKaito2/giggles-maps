# Thailand road routing and place coverage

## What changed

The public Valhalla route service can route Khon Kaen to Sakon Nakhon, but its matrix
service rejects that trip (150 km driving / 30 km walking distance caps observed on
23 October 2026). Previously a matrix failure switched both times and the map to
straight-line estimates. A final geometry failure also silently drew straight lines.

`plan-route` now obtains the direct A -> B road route first. A PostGIS geography
index shortlists places within a corridor along that road line. Each proposed detour
is a complete road route ending at B, including stop dwell times and arrival hours.
The selected route's own leg times produce its ETAs and total. No straight-line
fallback is returned. A baseline routing failure returns 503 `routing_unavailable`.
Candidate lookup/routing failures preserve the verified direct route with warnings.

Work is capped: six free candidates, two paid candidates, at most two free stops and
one paid stop, at most thirteen additional route requests, concurrency two, and a
22-second candidate-search deadline (in-flight requests have an 8-second timeout).
The baseline request is separate. This is a bounded heuristic, not an exhaustive
search for every possible detour. The search corridor is capped at 20 km. Paid
stops cannot remove free stops; Plus has no paid stops. Times are road-travel
estimates, not a guarantee against traffic or unexpectedly long visits.

The web app accepts Thai/English POI searches, map pins, and `latitude, longitude`.
It shows the direct road route dashed grey and the chosen detour in indigo.
Search covers imported named POIs; it is not a full address/city geocoder.
If destination/time/mode changes while a request is pending, its old response is discarded.

## Nationwide seed

`supabase/seed_thailand.sql` contains 5,070 named POIs: 3,181 attractions/viewpoints,
499 museums, and 1,390 parks. Source: OpenStreetMap through an offline Overpass
Thailand extract, OSM timestamp `2026-10-23T03:02:49Z`; attribution ODbL.
Raw query (not called when a user plans a trip):

```overpass
[out:json][timeout:120];
area["ISO3166-1"="TH"]["admin_level"="2"]->.th;
(nwr["tourism"~"^(museum|viewpoint|attraction)$"]["name"](area.th);
 nwr["leisure"="park"]["name"](area.th););
out center tags;
```

The seed skips duplicate normalized name/category/rounded-coordinate records and
does not overwrite existing OSM IDs, partners, QR codes, bids, or wallets.
Close duplicates across coordinate rounding boundaries and alternate names may
still need curation. Way positions are POI centers, not verified entrances; route
snapping may fail at inaccessible places. OSM coverage varies, and national cafés,
temples and every address are not included in this first extract. Existing local
records remain. Ratings retain the existing schema's **4.2 placeholder**, not real
reviews; opening hours remain unknown rather than being fabricated. National
collection membership is not added by this seed.

To regenerate from an Overpass JSON snapshot (standard Python only):

```sh
python supabase/tools/import_thailand_places.py thailand-attractions.json --output thailand-places.sql
```

For a larger [Geofabrik Thailand PBF](https://download.geofabrik.de/asia/thailand.html):
install `osmium` and pass the PBF file instead. PBF parsing is optional and was not
verified on this Windows host: application control blocked the native osmium DLL.
JSON conversion, SQL escaping and deduplication are covered by Python tests.
Do not put raw PBF files in Git. Relations are not imported by the PBF path.

## Deployment handoff (Krist / backend owner)

The live app does not change until this branch is reviewed and deployed.

1. Apply migration `20261023000007_thailand_route_corridor.sql` to the shared
   Supabase project, then review/apply `supabase/seed_thailand.sql` using the SQL
   editor or an authenticated database connection (`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed_thailand.sql`).
2. Deploy the updated `plan-route` Edge Function. Keep its existing authentication.
   The new corridor RPC is service-role only. POI search returns only public fields.
3. Build/deploy the web app. API fields are additive, and the existing iOS DTO
   accepts `routing: "valhalla"` and ignores the new optional fields.
4. Confirm a +45 minute driving route Khon Kaen -> Sakon Nakhon follows roads,
   still ends at the selected destination, and includes dwell within its budget.
   Test Bangkok, Chiang Mai, Phuket, zero budget, empty coverage, and provider outages.
5. Check the indexed corridor query with `EXPLAIN (ANALYZE, BUFFERS)` on the actual
   database. PostGIS migration execution and query latency require a deployed DB;
   they were not tested locally on this Windows host.

For production reliability, set `VALHALLA_URL` to a dedicated Thailand-capable
instance/service. The public demo has fair-use limits and is not an availability
guarantee. The code identifies requests with `X-Client-Id`; coordinate data goes to
the configured routing provider, as it did before.

## Validation

```sh
node --test supabase/functions/_shared/road-detour.node.test.ts
python -m unittest discover -s supabase/tools -p 'test_*.py'
cd web && npm ci && npm run build
```

Nine routing regressions cover budget/dwell, destination preservation, free/paid
priority, Plus, closed/overnight visits, bounded calls, and provider failures.
Three importer tests cover classification, duplicate POIs, apostrophe-safe SQL,
and JSON way centers. Live smoke testing uses the actual `/route` endpoint, not
a straight-line route mock. No database migration/import or production deployment
is implied by passing these local checks.
