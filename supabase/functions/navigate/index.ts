import { admin, HttpError, json, readJson, requireUser, serve, thaiPoint } from "../_shared/http.ts";
import { toNavRoute } from "../_shared/navigation.ts";
import { type LatLng, MAX_LOCATIONS, type Mode, pieces } from "../_shared/valhalla.ts";

const BASE = Deno.env.get("VALHALLA_URL") ?? "https://valhalla1.openstreetmap.de";
const MODES = new Set(["pedestrian", "bicycle", "auto"]);

// Turn-by-turn route for nav mode: from where you are, through the stops left, to the destination.
// Body: { points: [{lat,lng}, ...] (2-17: you, up to 15 stops, the destination), mode, avoid?: { tolls, highways, ferries } }
serve(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const pts = body.points;
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > 17) throw new HttpError(400, "bad_points");
  const points: LatLng[] = pts.map((p) => thaiPoint(p, "bad_points"));
  const mode: Mode = MODES.has(body.mode) ? body.mode : "auto";
  const avoid = body.avoid ?? {};
  const costing_options = mode === "auto" ? { auto: {
    ...(avoid.tolls ? { use_tolls: 0 } : {}), ...(avoid.highways ? { use_highways: 0 } : {}), ...(avoid.ferries ? { use_ferry: 0 } : {}),
  } } : mode === "bicycle" && avoid.ferries ? { bicycle: { use_ferry: 0 } } : undefined;
  // rate limit only once the request is valid, so bad requests don't use up the quota
  const { data: allowed, error } = await admin().rpc("nav_allowed", { p_user: user.id });
  if (error) throw error;
  if (!allowed) throw new HttpError(429, "slow_down");
  // the routing server takes MAX_LOCATIONS points a request: a longer trip goes in pieces, joined leg by leg
  const piece = async (part: LatLng[]) => {
    const res = await fetch(`${BASE.replace(/\/$/, "")}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": "giggles-maps.pages.dev" },
      body: JSON.stringify({ locations: part.map((p) => ({ lat: p.lat, lon: p.lng, type: "break" })),
        costing: mode, costing_options, directions_options: { units: "kilometers", language: "en-US" } }),
      signal: AbortSignal.timeout(12000),
    }).catch((e) => { console.error("navigate routing", e); throw new HttpError(502, "routing_unavailable"); });
    if (!res.ok) throw new HttpError(502, "routing_unavailable");
    const data = await res.json().catch(() => { throw new HttpError(502, "routing_unavailable"); });
    if (data.trip?.status !== 0 || !Array.isArray(data.trip?.legs)) throw new HttpError(502, "routing_unavailable");
    return data.trip;
  };
  const trips = await Promise.all(pieces(points, MAX_LOCATIONS).map(piece));
  return json(toNavRoute({ legs: trips.flatMap((t) => t.legs),
    summary: { length: trips.reduce((a, t) => a + t.summary.length, 0), time: trips.reduce((a, t) => a + t.summary.time, 0) } }));
});
