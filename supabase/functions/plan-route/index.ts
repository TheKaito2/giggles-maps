import { admin, HttpError, json, num, requireUser, serve } from "../_shared/http.ts";
import { expectedValue, planDetour, type Stop } from "../_shared/planner.ts";
import { estimateMinutes, type LatLng, matrixMinutes, type Mode, routeLine } from "../_shared/valhalla.ts";

interface Candidate {
  id: number; name: string; name_th: string | null; category: string; lat: number; lng: number;
  open_min: number | null; close_min: number | null; dwell_min: number; rating: number;
  is_partner: boolean; effective_bid: number; p_checkin: number; is_demo: boolean;
}

// Thailand bounding box: reject coordinates we can't route anyway
const point = (v: unknown, code: string): LatLng => {
  const p = v as { lat?: unknown; lng?: unknown } | null;
  return { lat: num(p?.lat, 5, 21, code), lng: num(p?.lng, 97, 106, code) };
};

serve(async (req) => {
  const user = await requireUser(req);
  const body = await req.json().catch(() => { throw new HttpError(400, "bad_json"); });
  const origin = point(body.origin, "bad_origin");
  const dest = point(body.dest, "bad_dest");
  const startMin = num(body.start_min, 0, 1439, "bad_start_min");
  const budgetMin = num(body.budget_min, 0, 240, "bad_budget_min");
  const mode: Mode = body.mode === "auto" ? "auto" : "pedestrian";

  const db = admin();
  const metersPerMin = mode === "pedestrian" ? 80 : 500;
  const { data: cands, error } = await db.rpc("detour_candidates", {
    o_lat: origin.lat, o_lng: origin.lng, d_lat: dest.lat, d_lng: dest.lng,
    extra_m: budgetMin * metersPerMin, max_n: 15,
  });
  if (error) throw error;
  const candidates = cands as Candidate[];

  // index 0 = origin, 1 = destination, 2.. = candidates
  const points: LatLng[] = [origin, dest, ...candidates.map((c) => ({ lat: c.lat, lng: c.lng }))];
  let routing = "valhalla";
  let matrix: number[][];
  try {
    matrix = await matrixMinutes(points, mode);
  } catch (e) {
    console.error(e);
    routing = "estimate";
    matrix = estimateMinutes(points, mode);
  }

  const stops: Stop[] = candidates.map((c, i) => ({
    idx: i + 2, id: c.id, rating: Number(c.rating), dwellMin: c.dwell_min,
    openMin: c.open_min, closeMin: c.close_min,
    value: expectedValue(Number(c.effective_bid), Number(c.p_checkin), Number(c.rating)),
  }));
  const plan = planDetour({
    originIdx: 0, destIdx: 1, startMin, budgetMin, stops, travelMin: (a, b) => matrix[a][b],
  });

  // ETA per stop for the UI
  let t = startMin, at = 0;
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const ordered = plan.order.map((s) => {
    t += matrix[at][s.idx];
    const c = byId.get(s.id)!;
    const eta = Math.round(t);
    t += s.dwellMin;
    at = s.idx;
    return {
      id: c.id, name: c.name, name_th: c.name_th, category: c.category, lat: c.lat, lng: c.lng,
      is_partner: c.is_partner, bid_thb: Number(c.effective_bid), is_demo: c.is_demo,
      rating: Number(c.rating), dwell_min: c.dwell_min, eta_min: eta,
    };
  });

  const linePts = [origin, ...ordered.map((s) => ({ lat: s.lat, lng: s.lng })), dest];
  let geometry: [number, number][];
  try {
    geometry = routing === "valhalla" ? await routeLine(linePts, mode) : linePts.map((p) => [p.lng, p.lat]);
  } catch {
    geometry = linePts.map((p) => [p.lng, p.lat]);
  }

  const { data: route, error: rErr } = await db.from("routes").insert({
    user_id: user.id,
    origin: `POINT(${origin.lng} ${origin.lat})`, dest: `POINT(${dest.lng} ${dest.lat})`,
    start_min: startMin, budget_min: budgetMin, extra_min: Math.round(plan.extraMin * 10) / 10,
  }).select("id").single();
  if (rErr) throw rErr;
  if (ordered.length) {
    const { error: sErr } = await db.from("route_stops").insert(
      ordered.map((s, i) => ({ route_id: route.id, place_id: s.id, position: i, bid_thb: s.bid_thb })),
    );
    if (sErr) throw sErr;
  }

  return json({
    route_id: route.id, routing, mode,
    base_min: Math.round(plan.baseMin), total_min: Math.round(plan.totalMin),
    extra_min: Math.round(plan.extraMin), budget_min: budgetMin,
    expected_thb: Math.round(plan.expectedThb * 100) / 100,
    candidates_considered: candidates.length,
    stops: ordered, geometry,
  });
});
