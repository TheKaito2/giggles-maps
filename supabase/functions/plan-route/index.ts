import { admin, HttpError, json, num, requireUser, serve } from "../_shared/http.ts";
import { planDetour, type Stop } from "../_shared/planner.ts";
import { estimateMinutes, type LatLng, matrixMinutes, type Mode, routeLine } from "../_shared/valhalla.ts";

interface Candidate {
  id: number; name: string; name_th: string | null; category: string; lat: number; lng: number;
  open_min: number | null; close_min: number | null; dwell_min: number; rating: number;
  is_partner: boolean; is_demo: boolean;
}
interface NearPlace {
  id: number; name: string; category: string; lat: number; lng: number; rating: number;
  is_partner: boolean; dist_m: number; is_demo: boolean;
}

const FREE_MAX_BUDGET = 120;
const PLUS_MAX_BUDGET = 240;
const CARD_CATEGORIES = new Set(["park", "viewpoint", "temple"]); // "Near this spot" cards sit under these
const MAX_CARDS = 2;

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
  const mode: Mode = body.mode === "auto" ? "auto" : "pedestrian";

  const db = admin();
  const { data: profile } = await db.from("profiles").select("plus_until").eq("id", user.id).maybeSingle();
  const plus = !!profile?.plus_until && new Date(profile.plus_until) > new Date();
  const budgetMin = num(body.budget_min, 0, PLUS_MAX_BUDGET, "bad_budget_min");
  if (!plus && budgetMin > FREE_MAX_BUDGET) throw new HttpError(402, "plus_required");

  const metersPerMin = mode === "pedestrian" ? 80 : 500;
  const { data: cands, error } = await db.rpc("detour_candidates", {
    o_lat: origin.lat, o_lng: origin.lng, d_lat: dest.lat, d_lng: dest.lng,
    extra_m: budgetMin * metersPerMin, max_n: 16,
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
    idx: i + 2, id: c.id, category: c.category, rating: Number(c.rating), dwellMin: c.dwell_min,
    openMin: c.open_min, closeMin: c.close_min,
  }));
  const plan = planDetour({ originIdx: 0, destIdx: 1, startMin, budgetMin, stops, travelMin: (a, b) => matrix[a][b] });

  // "Near this spot" cards under nature/temple stops: the best nearby place by quality (rating, then
  // distance), signed up or not. Another park/temple isn't a card; that would be a stop of its own.
  const inRoute = new Set(plan.order.map((s) => s.id));
  const cards = new Map<number, NearPlace>();
  for (const s of plan.order) {
    if (cards.size >= MAX_CARDS) break;
    const c = candidates.find((x) => x.id === s.id)!;
    if (!CARD_CATEGORIES.has(c.category)) continue;
    const { data, error: nErr } = await db.rpc("places_near", { p_lat: c.lat, p_lng: c.lng, p_radius_m: 400 });
    if (nErr) throw nErr;
    const best = ((data ?? []) as NearPlace[]).find((p) =>
      !CARD_CATEGORIES.has(p.category) && !inRoute.has(p.id) && ![...cards.values()].some((x) => x.id === p.id));
    if (best) cards.set(s.id, best);
  }

  // ETA per stop for the UI
  let t = startMin, at = 0;
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const ordered = plan.order.map((s) => {
    t += matrix[at][s.idx];
    const c = byId.get(s.id)!;
    const eta = Math.round(t);
    t += s.dwellMin;
    at = s.idx;
    const card = cards.get(s.id);
    return {
      id: c.id, name: c.name, name_th: c.name_th, category: c.category, lat: c.lat, lng: c.lng,
      is_partner: c.is_partner, is_demo: c.is_demo,
      rating: Number(c.rating), dwell_min: c.dwell_min, eta_min: eta,
      // field name kept for existing clients; the card is any nearby place, picked by quality
      nearby_partner: card
        ? { id: card.id, name: card.name, category: card.category, lat: card.lat, lng: card.lng,
            distance_m: Math.round(card.dist_m), is_partner: card.is_partner, is_demo: card.is_demo }
        : null,
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

  // impressions: every stop and card shown; the 3 h billing window starts here
  const shown = [
    ...ordered.map((s, i) => ({ route_id: route.id, user_id: user.id, place_id: s.id, position: i, kind: "stop" })),
    ...[...cards.values()].map((c) => ({ route_id: route.id, user_id: user.id, place_id: c.id, position: null, kind: "card" })),
  ];
  if (shown.length) {
    const { error: sErr } = await db.from("route_stops").insert(shown);
    if (sErr) throw sErr;
  }

  return json({
    route_id: route.id, routing, mode, plus,
    base_min: Math.round(plan.baseMin), total_min: Math.round(plan.totalMin),
    extra_min: Math.round(plan.extraMin), budget_min: budgetMin,
    max_budget_min: plus ? PLUS_MAX_BUDGET : FREE_MAX_BUDGET,
    candidates_considered: candidates.length,
    stops: ordered, geometry,
  });
});
