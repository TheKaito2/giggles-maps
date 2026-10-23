import { admin, HttpError, json, num, requireUser, serve } from "../_shared/http.ts";
import { toNavRoute } from "../_shared/navigation.ts";
import type { LatLng, Mode } from "../_shared/valhalla.ts";

const BASE = Deno.env.get("VALHALLA_URL") ?? "https://valhalla1.openstreetmap.de";
const MODES = new Set(["pedestrian", "bicycle", "auto"]);

// Turn-by-turn route for nav mode: from where you are, through the stops left, to the destination.
// Body: { points: [{lat,lng}, ...] (2-8, first = you), mode, avoid?: { tolls, highways, ferries } }
serve(async (req) => {
  const user = await requireUser(req);
  const body = await req.json().catch(() => { throw new HttpError(400, "bad_json"); });
  if (!body || typeof body !== "object") throw new HttpError(400, "bad_json");
  const { data: allowed, error } = await admin().rpc("nav_allowed", { p_user: user.id });
  if (error) throw error;
  if (!allowed) throw new HttpError(429, "slow_down");
  const pts = body.points;
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > 8) throw new HttpError(400, "bad_points");
  const points: LatLng[] = pts.map((p: { lat?: unknown; lng?: unknown }) => ({ lat: num(p?.lat, 5, 21, "bad_points"), lng: num(p?.lng, 97, 106, "bad_points") }));
  const mode: Mode = MODES.has(body.mode) ? body.mode : "auto";
  const avoid = body.avoid ?? {};
  const costing_options = mode === "auto" ? { auto: {
    ...(avoid.tolls ? { use_tolls: 0 } : {}), ...(avoid.highways ? { use_highways: 0 } : {}), ...(avoid.ferries ? { use_ferry: 0 } : {}),
  } } : mode === "bicycle" && avoid.ferries ? { bicycle: { use_ferry: 0 } } : undefined;
  const res = await fetch(`${BASE.replace(/\/$/, "")}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-Id": "giggles-maps.pages.dev" },
    body: JSON.stringify({ locations: points.map((p) => ({ lat: p.lat, lon: p.lng, type: "break" })),
      costing: mode, costing_options, directions_options: { units: "kilometers", language: "en-US" } }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new HttpError(502, "routing_unavailable");
  const data = await res.json();
  if (data.trip?.status !== 0 || !Array.isArray(data.trip?.legs)) throw new HttpError(502, "routing_unavailable");
  return json(toNavRoute(data.trip));
});
