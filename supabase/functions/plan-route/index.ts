import { admin, HttpError, json, num, requireUser, serve } from "../_shared/http.ts";
import { type Meal, MEAL_WINDOWS, mealsInTrip } from "../_shared/meals.ts";
import { type Plan, planDetour, type Stop } from "../_shared/planner.ts";
import { isInterest, isTheme, mixWeight, THEMES } from "../_shared/themes.ts";
import { allowsEstimateFallback, boundedRouter, scheduleStops, verifyRoadPlan } from "../_shared/road-detour.ts";
import { createRouter, estimateMinutes, haversineM, type LatLng, matrixMinutes, METERS_PER_MIN, type Mode, type RoadRoute } from "../_shared/valhalla.ts";

interface Candidate {
  id: number; name: string; name_th: string | null; category: string; lat: number; lng: number;
  open_min: number | null; close_min: number | null; dwell_min: number; rating: number | null;
  is_partner: boolean; is_demo: boolean; min_level: number; exclusive_kind: string | null; perk_text: string | null;
  price_level: number | null;
}
interface NearPlace {
  id: number; name: string; category: string; lat: number; lng: number; rating: number;
  is_partner: boolean; dist_m: number; is_demo: boolean; min_level: number; exclusive_kind: string | null;
}

const MAX_BUDGET = 240; // v4: 4-hour detours for everyone (Plus is cosmetic only)
const CARD_CATEGORIES = new Set(["park", "viewpoint", "temple"]); // "Near this spot" cards sit under these
const MAX_CARDS = 2;
const MAX_CANDIDATES = 22; // up to 5 per theme group, so every themed plan has its kind of stop to pick
const MODES = new Set<Mode>(["pedestrian", "bicycle", "auto"]);
const MIN_RATINGS = new Set([0, 3.5, 4, 4.5]);

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
  if (body.mode != null && !MODES.has(body.mode)) throw new HttpError(400, "bad_mode");
  const mode: Mode = body.mode ?? "pedestrian";
  if (body.theme != null && !isTheme(body.theme)) throw new HttpError(400, "bad_theme");
  // planner preferences, all optional; omitted = the defaults every plan used before
  const interests: string[] = body.interests ?? [];
  if (!Array.isArray(interests) || interests.length > 6 || !interests.every(isInterest)) throw new HttpError(400, "bad_interests");
  const minRating = body.min_rating ?? 4;
  if (!MIN_RATINGS.has(minRating)) throw new HttpError(400, "bad_min_rating");
  const includeUnrated = body.include_unrated === true;
  const maxStops = body.max_stops == null ? undefined : num(body.max_stops, 1, 6, "bad_max_stops");
  if (maxStops != null && !Number.isInteger(maxStops)) throw new HttpError(400, "bad_max_stops");
  const maxPrice = body.max_price == null ? null : num(body.max_price, 0, 3, "bad_max_price");
  if (maxPrice != null && !Number.isInteger(maxPrice)) throw new HttpError(400, "bad_max_price");
  const filters = { p_min_rating: minRating, p_unrated: includeUnrated, p_max_price: maxPrice };

  const db = admin();
  const { data: profile } = await db.from("profiles").select("plus_until, member_since").eq("id", user.id).maybeSingle();
  const plus = !!profile?.plus_until && new Date(profile.plus_until) > new Date();
  const member = !!profile?.member_since;
  // members unlock exclusive places up to their level; everyone else sees level 0 (no exclusives)
  const { data: level, error: lErr } = await db.rpc("unlock_level", { p_user: user.id });
  if (lErr) throw lErr;
  const budgetMin = num(body.budget_min, 0, MAX_BUDGET, "bad_budget_min");

  const warnings: string[] = [];
  const shortTrip = haversineM(origin, dest) <= 10000;
  const localWalkingFallback = allowsEstimateFallback(mode, haversineM(origin, dest));
  const routeRoad = createRouter(Deno.env.get("VALHALLA_URL") ?? "https://valhalla1.openstreetmap.de");
  let baseline: RoadRoute | null = null;
  try { baseline = await routeRoad([origin, dest], mode); }
  catch (error) {
    console.error("baseline routing failed", error);
    if (!localWalkingFallback) throw new HttpError(503, "routing_unavailable");
    warnings.push("estimated_local_walk");
  }
  const maxCandidates = shortTrip ? 16 : MAX_CANDIDATES;
  const { data: cands, error } = baseline
    ? await db.rpc("route_detour_candidates", {
      p_geometry: baseline.geometry,
      p_radius_m: Math.min(20000, budgetMin * METERS_PER_MIN[mode] / 2),
      p_budget_min: budgetMin, p_level: level, p_max_n: maxCandidates, p_per_group: shortTrip ? 4 : 5, ...filters,
    })
    : await db.rpc("detour_candidates", {
      o_lat: origin.lat, o_lng: origin.lng, d_lat: dest.lat, d_lng: dest.lng,
      extra_m: budgetMin * 80, max_n: 16, p_level: level, p_per_group: 4, ...filters,
    });
  if (error) { console.error("candidate lookup failed", error); warnings.push("places_unavailable"); }
  const candidates = (cands ?? []) as Candidate[];
  const points: LatLng[] = [origin, dest, ...candidates.map((c) => ({ lat: c.lat, lng: c.lng }))];
  let matrix = estimateMinutes(points, mode);
  if (baseline && shortTrip) {
    try {
      const roadMatrix = await matrixMinutes(points, mode);
      if (!Number.isFinite(roadMatrix[0]?.[1])) throw new Error("unreachable_baseline");
      matrix = roadMatrix;
    } catch (error) { console.error("local matrix failed", error); warnings.push("matrix_unavailable"); }
  }
  // Long trips use an estimated matrix to propose orders, NEVER to approve a road detour.
  // Calibrate proposals to the known direct road duration; verify complete routes below.
  if (baseline && (!shortTrip || warnings.includes("matrix_unavailable"))) {
    const scale = matrix[0][1] > 0 ? baseline.travelMin / matrix[0][1] : 1;
    matrix = matrix.map((row) => row.map((minutes) => minutes * scale));
  }
  const routing = baseline ? "valhalla" : "estimate";

  const stops: Stop[] = candidates.map((c, i) => ({
    idx: i + 2, id: c.id, category: c.category, rating: c.rating == null ? null : Number(c.rating), dwellMin: c.dwell_min,
    openMin: c.open_min, closeMin: c.close_min,
  }));
  const travelMin = (a: number, b: number) => matrix[a][b];
  // meals the whole trip window (direct time + extra budget) runs through get a food stop
  const meals = mealsInTrip(startMin, startMin + (baseline?.travelMin ?? matrix[0][1]) + budgetMin);

  // one plan per theme from the same shortlist + matrix; drop themed plans identical to an earlier one
  const seen = new Set<string>();
  const themed: { id: string; name: string; plan: Plan; geometry?: [number, number][]; etaMin?: number[] }[] = [];
  // "Your mix" (the user's interest chips) leads; the five themed plans follow as alternatives
  const variants = [
    ...(interests.length ? [{ id: "mix", name: "Your mix", weight: mixWeight(interests) }] : []),
    ...THEMES.map((t) => ({ id: t.id, name: t.name, theme: t.id })),
  ];
  const prefs = { minRating, allowUnrated: includeUnrated, maxStops };
  for (const t of variants) {
    const plan = planDetour({ originIdx: 0, destIdx: 1, startMin, budgetMin, stops, travelMin, meals, ...prefs,
                              theme: "theme" in t ? t.theme : undefined, weight: "weight" in t ? t.weight : undefined });
    const key = plan.order.map((s) => s.id).join(",");
    if (t.id !== "top_picks" && t.id !== "mix" && seen.has(key)) continue;
    seen.add(key);
    themed.push({ id: t.id, name: t.name, plan });
  }
  const verification = boundedRouter(routeRoad);
  const verifiedKeys = new Set<string>();
  for (let i = 0; i < themed.length; i++) {
    const t = themed[i];
    if (baseline) {
      const verified = await verifyRoadPlan({ plan: t.plan, origin, dest, candidates, mode,
        baseline, startMin, budgetMin, route: verification.route });
      t.plan = verified.plan; t.geometry = verified.geometry; t.etaMin = verified.etaMin;
      if (verified.failed) warnings.push("some_detours_unavailable");
      else if (verified.adjusted) warnings.push("detours_adjusted");
    } else {
      const legs = []; let at = 0;
      for (const s of t.plan.order) { legs.push(matrix[at][s.idx]); at = s.idx; }
      legs.push(matrix[at][1]);
      t.etaMin = scheduleStops(t.plan.order, legs, startMin, t.plan.mealOf).etaMin;
      t.geometry = [origin, ...t.plan.order.map((s) => candidates[s.idx - 2]), dest].map((p) => [p.lng, p.lat]);
    }
    const key = t.plan.order.map((s) => s.id).join(",");
    if (t.id !== "top_picks" && t.id !== "mix" && verifiedKeys.has(key)) { themed.splice(i--, 1); continue; }
    verifiedKeys.add(key);
  }
  // The asked-for theme goes first; top-level fields remain Top picks for existing clients.
  if (body.theme) themed.sort((a, b) => Number(b.id === body.theme) - Number(a.id === body.theme));

  // "Near this spot" cards under nature/temple stops: the best nearby place by quality (rating, then
  // distance), signed up or not. Another park/temple isn't a card; that would be a stop of its own.
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const nearCache = new Map<number, NearPlace[]>();
  const cardsFor = async (plan: Plan) => {
    const inRoute = new Set(plan.order.map((s) => s.id));
    const cards = new Map<number, NearPlace>();
    for (const s of plan.order) {
      if (cards.size >= MAX_CARDS) break;
      const c = byId.get(s.id)!;
      if (!CARD_CATEGORIES.has(c.category)) continue;
      if (!nearCache.has(c.id)) {
        const { data, error: nErr } = await db.rpc("places_near", { p_lat: c.lat, p_lng: c.lng, p_radius_m: 400, p_level: level });
        if (nErr) { console.error("nearby places failed", nErr); warnings.push("places_unavailable"); }
        nearCache.set(c.id, (data ?? []) as NearPlace[]);
      }
      const best = nearCache.get(c.id)!.find((p) =>
        !CARD_CATEGORIES.has(p.category) && !inRoute.has(p.id) && ![...cards.values()].some((x) => x.id === p.id));
      if (best) cards.set(s.id, best);
    }
    return cards;
  };

  const build = async ({ plan, geometry, etaMin }: typeof themed[number]) => {
    const cards = await cardsFor(plan);
    // ETA per stop for the UI; early arrivals at a meal stop wait for the window, as the planner does
    let t = startMin, at = 0;
    const ordered = plan.order.map((s, index) => {
      t += matrix[at][s.idx];
      const meal: Meal | null = plan.mealOf.get(s.id) ?? null;
      if (meal) t = Math.max(t, MEAL_WINDOWS[meal][0]);
      const c = byId.get(s.id)!;
      const eta = etaMin![index];
      t += s.dwellMin;
      at = s.idx;
      const card = cards.get(s.id);
      return {
        id: c.id, name: c.name, name_th: c.name_th, category: c.category, lat: c.lat, lng: c.lng,
        is_partner: c.is_partner, is_demo: c.is_demo,
        rating: c.rating == null ? null : Number(c.rating), price_level: c.price_level,
        dwell_min: c.dwell_min, eta_min: eta, meal,
        // exclusive places only reach a route when the member's level opens them
        min_level: c.min_level, exclusive_kind: c.exclusive_kind, perk_text: c.perk_text,
        // field name kept for existing clients; the card is any nearby place, picked by quality
        nearby_partner: card
          ? { id: card.id, name: card.name, category: card.category, lat: card.lat, lng: card.lng,
              distance_m: Math.round(card.dist_m), is_partner: card.is_partner, is_demo: card.is_demo,
              min_level: card.min_level, exclusive_kind: card.exclusive_kind }
          : null,
      };
    });

    return { ordered, cards, geometry };
  };

  const built = await Promise.all(themed.map(build));
  const topIdx = themed.findIndex((t) => t.id === "top_picks");
  const plan = themed[topIdx].plan;
  const { ordered, geometry } = built[topIdx];

  const { data: route, error: rErr } = await db.from("routes").insert({
    user_id: user.id,
    origin: `POINT(${origin.lng} ${origin.lat})`, dest: `POINT(${dest.lng} ${dest.lat})`,
    start_min: startMin, budget_min: budgetMin, extra_min: Math.round(plan.extraMin * 10) / 10,
  }).select("id").single();
  if (rErr) throw rErr;

  // impressions: every stop and card shown in any plan, once per place (a stop beats a card);
  // the 3 h billing window starts here
  const shownMap = new Map<number, { position: number | null; kind: string }>();
  for (const b of built) b.ordered.forEach((s, i) => { if (shownMap.get(s.id)?.kind !== "stop") shownMap.set(s.id, { position: i, kind: "stop" }); });
  for (const b of built) for (const c of b.cards.values()) if (!shownMap.has(c.id)) shownMap.set(c.id, { position: null, kind: "card" });
  const shown = [...shownMap].map(([place_id, v]) => ({ route_id: route.id, user_id: user.id, place_id, ...v }));
  if (shown.length) {
    const { error: sErr } = await db.from("route_stops").insert(shown);
    if (sErr) throw sErr;
  }

  return json({
    route_id: route.id, routing, mode, plus, member, level,
    base_min: Math.round(plan.baseMin), total_min: Math.round(plan.totalMin),
    extra_min: Math.round(plan.extraMin), budget_min: budgetMin,
    max_budget_min: MAX_BUDGET,
    candidates_considered: candidates.length,
    stops: ordered, geometry, base_geometry: baseline?.geometry ?? [],
    warnings: [...new Set(warnings)],
    meals, missed_meals: plan.missedMeals,
    plans: themed.map((t, i) => ({
      id: t.id, name: t.name, stops: built[i].ordered, geometry: built[i].geometry,
      extra_min: Math.round(t.plan.extraMin), total_min: Math.round(t.plan.totalMin),
      meals, missed_meals: t.plan.missedMeals,
    })),
  });
});
