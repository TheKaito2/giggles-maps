import { admin, HttpError, json, num, requireUser, serve } from "../_shared/http.ts";
import { type Meal, MEAL_WINDOWS } from "../_shared/meals.ts";
import { insertBest, insertionCost, type Plan, planDetour, type Stop } from "../_shared/planner.ts";
import { fitsInterests, independent, isInterest, mixWeight, type Tier, THEMES, toTheme } from "../_shared/themes.ts";
import { allowsEstimateFallback, boundedRouter, scheduleStops, verifyRoadPlan } from "../_shared/road-detour.ts";
import { createRouter, estimateMinutes, haversineM, type LatLng, matrixMinutes, METERS_PER_MIN, type Mode, type RoadRoute } from "../_shared/valhalla.ts";

interface Candidate {
  id: number; name: string; name_th: string | null; category: string; lat: number; lng: number;
  open_min: number | null; close_min: number | null; dwell_min: number; rating: number | null;
  is_partner: boolean; is_demo: boolean; min_level: number; exclusive_kind: string | null; perk_text: string | null;
  price_level: number | null;
  tier: Tier;   // 3 landmark, 2 worth a visit, 1 everyday
  frac?: number;   // 0 start .. 1 destination along the direct route (route shortlist only)
  local?: boolean; otop?: boolean; community?: boolean;   // local-first flags (route shortlist only)
}
interface NearPlace {
  id: number; name: string; category: string; lat: number; lng: number; rating: number;
  is_partner: boolean; dist_m: number; is_demo: boolean; min_level: number; exclusive_kind: string | null;
}

const MAX_BUDGET = 240; // v4: 4-hour detours for everyone (Plus is cosmetic only)
const CARD_CATEGORIES = new Set(["park", "viewpoint", "temple"]); // "Near this spot" cards sit under these
const MAX_CARDS = 2;
const QUICK_DWELL_MIN = 10; // time counted at each stop on a short (Quick) detour
const PIT_DWELL_MIN = 5;    // a convenience-store pit stop on a Quick detour: snacks, a drink, the toilet
const PIT_RESERVE_MIN = 7;  // kept free for it while the sight is chosen (5 there + a little driving)
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
  const requestedTheme = body.theme == null ? null : toTheme(body.theme);   // "scenic" works as well as "nature"
  if (body.theme != null && !requestedTheme) throw new HttpError(400, "bad_theme");
  // planner preferences, all optional; omitted = the defaults every plan used before
  const interests: string[] = body.interests ?? [];
  if (!Array.isArray(interests) || interests.length > 6 || !interests.every(isInterest)) throw new HttpError(400, "bad_interests");
  const minRating = body.min_rating ?? 4;
  if (!MIN_RATINGS.has(minRating)) throw new HttpError(400, "bad_min_rating");
  // most of Thailand is unrated OpenStreetMap data: unrated places join by default (scored below rated ones)
  const includeUnrated = body.include_unrated !== false;
  const maxStops = body.max_stops == null ? undefined : num(body.max_stops, 1, 6, "bad_max_stops");
  if (maxStops != null && !Number.isInteger(maxStops)) throw new HttpError(400, "bad_max_stops");
  const maxPrice = body.max_price == null ? null : num(body.max_price, 0, 3, "bad_max_price");
  if (maxPrice != null && !Number.isInteger(maxPrice)) throw new HttpError(400, "bad_max_price");
  // meals the user asked to stop for ("Stop for a meal?"); none = no food stop is forced into the plans
  const meals: Meal[] = body.meals ?? [];
  if (!Array.isArray(meals) || meals.length > 3 || !meals.every((m) => m in MEAL_WINDOWS)) throw new HttpError(400, "bad_meals");
  const filters = { p_min_rating: minRating, p_unrated: includeUnrated, p_max_price: maxPrice };
  // stricter filters (all optional): only places whose opening hours we know (the planner then checks you arrive
  // while they're open), and no chain shops, cafés or restaurants
  const openOnly = body.open_only === true, noChains = body.no_chains === true;
  // places the user picked or added from "along your route" (up to 6); they go into every plan when they fit
  const ids = (v: unknown, max: number, code: string): number[] => {
    if (v == null) return [];
    if (!Array.isArray(v) || v.length > max || !v.every((id) => Number.isSafeInteger(id) && id > 0)) throw new HttpError(400, code);
    return v;
  };
  // stops the user removed or swapped out: never offered again in this plan
  const exclude = new Set(ids(body.exclude, 30, "bad_exclude"));
  const mustInclude = ids(body.must_include, 6, "bad_must_include").filter((id) => !exclude.has(id));

  const db = admin();
  const { data: profile } = await db.from("profiles").select("plus_until, member_since").eq("id", user.id).maybeSingle();
  const plus = !!profile?.plus_until && new Date(profile.plus_until) > new Date();
  const member = !!profile?.member_since;
  // members unlock exclusive places up to their level; everyone else sees level 0 (no exclusives)
  const { data: level, error: lErr } = await db.rpc("unlock_level", { p_user: user.id });
  if (lErr) throw lErr;
  // "auto": half the direct trip, set once the direct route time is known (below)
  const autoBudget = body.budget_min === "auto";
  let budgetMin = autoBudget ? 0 : num(body.budget_min, 0, MAX_BUDGET, "bad_budget_min");

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
  if (autoBudget) {
    const direct = baseline?.travelMin ?? estimateMinutes([origin, dest], mode)[0][1];
    budgetMin = Math.min(180, Math.max(45, Math.round(direct / 2 / 15) * 15));
    budgetMin = Math.min(MAX_BUDGET, budgetMin + 35 * meals.length);   // room to actually sit down and eat
  }
  const maxCandidates = shortTrip ? 16 : MAX_CANDIDATES;
  // a short budget (Quick, +15) plans quick stops: about 10 minutes at each (a look, the photo, the stamp), whatever the
  // place's usual visit time. Otherwise a 20-minute temple could never fit in 15 minutes and Quick came back empty.
  const quickStops = budgetMin < 30 && !meals.length;
  const dwellOf = (m: number) => quickStops ? Math.min(m, QUICK_DWELL_MIN) : m;
  const narrowed = interests.length > 0 || openOnly || noChains;   // the filters below drop places: fetch more first
  // spread stops along the way: 5 stretches on long drives, 3 on short ones, none inside a city block
  const directM = haversineM(origin, dest);
  const SEGMENTS = () => directM < 3000 ? 0 : directM < 30000 ? 3 : 5;
  const { data: cands, error } = baseline
    ? await db.rpc("route_detour_candidates", {
      p_geometry: baseline.geometry,
      p_radius_m: Math.min(20000, budgetMin * METERS_PER_MIN[mode] / 2),
      // over-fetch by the excluded count so removed stops don't eat the shortlist (they're dropped below)
      // quick stops: any place qualifies, since its time there is capped
      p_budget_min: quickStops ? MAX_BUDGET : budgetMin, p_level: level, p_max_n: maxCandidates + exclude.size + (narrowed ? 20 : 0),
      p_per_group: (shortTrip ? 4 : 5) + Math.min(exclude.size, 3) + (narrowed ? 4 : 0), ...filters,
      p_meal_slots: meals.length ? 4 : 0,   // nearest restaurants always make the shortlist when a meal is asked for
      p_segments: SEGMENTS(),
    })
    : await db.rpc("detour_candidates", {
      o_lat: origin.lat, o_lng: origin.lng, d_lat: dest.lat, d_lng: dest.lng,
      extra_m: budgetMin * 80, max_n: 16 + exclude.size, p_level: level, p_per_group: 4 + Math.min(exclude.size, 3), ...filters, p_meal_slots: meals.length ? 4 : 0,
    });
  if (error) { console.error("candidate lookup failed", error); warnings.push("places_unavailable"); }
  // the start and destination themselves aren't detours: drop places within 150 m of either end
  // "only these kinds" (a meal asked for still allows restaurants), confirmed opening hours, no chains;
  // places the user named as must-visit always stay in
  const keep = (c: Candidate) => mustInclude.includes(c.id) || (
    (fitsInterests(interests, c.category, c.tier) || (meals.length > 0 && c.category === "food"))
    && (!openOnly || (c.open_min != null && c.close_min != null))
    && (!noChains || independent(c)));
  const candidates = ((cands ?? []) as Candidate[]).filter((c) => !exclude.has(c.id) && keep(c) && haversineM(c, origin) > 150 && haversineM(c, dest) > 150)
    .slice(0, maxCandidates);   // over-fetched for the filters: the road-time matrix stays its usual size
  if (mustInclude.length) {
    const { data: picked, error: pErr } = await db.rpc("places_by_ids", { p_ids: mustInclude, p_level: level });
    if (pErr) throw pErr;
    // a pick that can't fit even in a straight line stays out of the matrix (a far point can break the routing call);
    // the planner then reports it in unfit_required
    const reach = budgetMin * METERS_PER_MIN[mode], direct = haversineM(origin, dest);
    for (const p of (picked ?? []) as Candidate[]) {
      if (candidates.some((c) => c.id === p.id)) continue;
      if (haversineM(origin, p) + haversineM(p, dest) - direct <= reach) candidates.push(p);
    }
  }
  // Quick: the convenience stores nearest the road, for a pit stop after the sight. They share the travel-time matrix,
  // but the sight planner never sees them; each plan gets the cheapest one afterwards if time is left (insertBest).
  const pitIds = new Set<number>();
  if (quickStops && baseline) {
    const { data: pits, error: pitErr } = await db.rpc("route_pit_stops", { p_geometry: baseline.geometry, p_radius_m: 800, p_max_n: 6 });
    if (pitErr) console.error("pit stops failed", pitErr);
    for (const p of (pits ?? []) as Candidate[]) {
      if (exclude.has(p.id) || candidates.some((c) => c.id === p.id) || haversineM(p, origin) <= 150 || haversineM(p, dest) <= 150) continue;
      candidates.push({ ...p, dwell_min: PIT_DWELL_MIN });
      pitIds.add(p.id);
    }
  }
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

  // one photo per place for the cards (Wikimedia or the owner's), first one wins
  const photoOf = new Map<number, string>();
  if (candidates.length) {
    const { data: photos, error: phErr } = await db.from("place_photos").select("place_id, url, source").in("place_id", candidates.map((c) => c.id)).order("id");
    if (phErr) console.error("photos failed", phErr);
    // owner photos are storage paths in the public shop-photos bucket; Wikimedia ones are full URLs
    const storage = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/`;
    for (const ph of (photos ?? []) as { place_id: number; url: string; source: string }[]) {
      if (!photoOf.has(ph.place_id)) photoOf.set(ph.place_id, ph.source === "owner" ? storage + ph.url : ph.url);
    }
  }

  const allStops: Stop[] = candidates.map((c, i) => ({
    idx: i + 2, id: c.id, category: c.category, rating: c.rating == null ? null : Number(c.rating), tier: c.tier ?? 2, dwellMin: dwellOf(c.dwell_min),
    openMin: c.open_min, closeMin: c.close_min, frac: c.frac, local: c.local, otop: c.otop, community: c.community,
  }));
  const stops = allStops.filter((st) => !pitIds.has(st.id)), pitStops = allStops.filter((st) => pitIds.has(st.id));
  const travelMin = (a: number, b: number) => matrix[a][b];

  // one plan per theme from the same shortlist + matrix; drop themed plans identical to an earlier one
  const seen = new Set<string>();
  const themed: { id: string; name: string; plan: Plan; geometry?: [number, number][]; etaMin?: number[]; travelMin?: number }[] = [];
  // "Your mix" (the user's interest chips) leads; the five themed plans follow as alternatives
  const variants = [
    ...(interests.length ? [{ id: "mix", name: "Your mix", weight: mixWeight(interests) }] : []),
    ...THEMES.map((t) => ({ id: t.id, name: t.name, theme: t.id })),
  ];
  const prefs = { minRating, allowUnrated: includeUnrated, maxStops, requiredIds: mustInclude };
  for (const t of variants) {
    const sightsWithin = (budget: number) => planDetour({ originIdx: 0, destIdx: 1, startMin, budgetMin: budget, stops, travelMin, meals, ...prefs,
      segments: SEGMENTS(), theme: "theme" in t ? t.theme : undefined, weight: "weight" in t ? t.weight : undefined });
    // Quick: plan the sight leaving room for a pit stop, then add the cheapest store that fits; no store fits, the sight gets it all
    const sights = pitStops.length ? sightsWithin(budgetMin - PIT_RESERVE_MIN) : null;
    const plan = (sights && pitStops.map((pit) => insertBest(sights, pit, travelMin, budgetMin)).filter((x): x is Plan => !!x)
      .sort((a, b) => a.extraMin - b.extraMin)[0]) || sightsWithin(budgetMin);
    const key = plan.order.map((s) => s.id).join(",");
    if (t.id !== "top_picks" && t.id !== "mix" && seen.has(key)) continue;
    seen.add(key);
    themed.push({ id: t.id, name: t.name, plan });
  }
  // up to 12 routing calls per request, shared by all plans: one per plan plus retries when a long route times out
  const verification = boundedRouter(routeRoad, 12);
  const verifiedKeys = new Set<string>();
  for (let i = 0; i < themed.length; i++) {
    const t = themed[i];
    if (baseline) {
      const verified = await verifyRoadPlan({ plan: t.plan, origin, dest, candidates, mode,
        baseline, startMin, budgetMin, route: verification.route });
      t.plan = verified.plan; t.geometry = verified.geometry; t.etaMin = verified.etaMin; t.travelMin = verified.travelMin;
      if (verified.failed) warnings.push("some_detours_unavailable");
      // an alternative plan the routing server couldn't check at all isn't worth a tab; Top picks always stays
      if (verified.failed && t.id !== "top_picks") { themed.splice(i--, 1); continue; }
      else if (verified.adjusted) warnings.push("detours_adjusted");
    } else {
      const legs = []; let at = 0;
      for (const s of t.plan.order) { legs.push(matrix[at][s.idx]); at = s.idx; }
      legs.push(matrix[at][1]);
      t.etaMin = scheduleStops(t.plan.order, legs, startMin, t.plan.mealOf).etaMin;
      t.travelMin = legs.reduce((a, b) => a + b, 0);
      t.geometry = [origin, ...t.plan.order.map((s) => candidates[s.idx - 2]), dest].map((p) => [p.lng, p.lat]);
    }
    const key = t.plan.order.map((s) => s.id).join(",");
    if (t.id !== "top_picks" && t.id !== "mix" && verifiedKeys.has(key)) { themed.splice(i--, 1); continue; }
    verifiedKeys.add(key);
  }
  // The asked-for theme goes first; top-level fields remain Top picks for existing clients.
  if (requestedTheme) themed.sort((a, b) => Number(b.id === requestedTheme) - Number(a.id === requestedTheme));

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
        !CARD_CATEGORIES.has(p.category) && !inRoute.has(p.id) && !exclude.has(p.id) && ![...cards.values()].some((x) => x.id === p.id));
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
      const late = plan.lateMeals.get(s.id) ?? null;   // a restaurant for this meal, outside its usual hours
      const meal: Meal | null = plan.mealOf.get(s.id) ?? late;
      if (meal && !late) t = Math.max(t, MEAL_WINDOWS[meal][0]);
      const c = byId.get(s.id)!;
      const eta = etaMin![index];
      t += s.dwellMin;
      at = s.idx;
      const card = cards.get(s.id);
      return {
        id: c.id, name: c.name, name_th: c.name_th, category: c.category, lat: c.lat, lng: c.lng,
        is_partner: c.is_partner, is_demo: c.is_demo,
        rating: c.rating == null ? null : Number(c.rating), price_level: c.price_level, tier: c.tier ?? 2,
        dwell_min: s.dwellMin, eta_min: eta, pit_stop: pitIds.has(c.id), meal, meal_late: !!late, picked: mustInclude.includes(c.id),
        // about how many minutes this stop adds (road detour + time there): what removing it would save
        extra_min: ((x) => Number.isFinite(x) ? Math.round(x) : null)(insertionCost(plan.order.map((o) => o.idx), s.idx, travelMin, s.dwellMin)),
        photo: photoOf.get(c.id) ?? null,
        local: !!c.local, otop: !!c.otop, community: !!c.community,
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

    // "add along your route": the shortlist places this plan left out, cheapest first
    const inPlan = new Set(plan.order.map((x) => x.id));
    const along = stops.filter((st) => !inPlan.has(st.id)).map((st) => {
      const c = byId.get(st.id)!;
      return { id: c.id, name: c.name, name_th: c.name_th, category: c.category, lat: c.lat, lng: c.lng, tier: c.tier ?? 2,
        rating: c.rating == null ? null : Number(c.rating), local: !!c.local, otop: !!c.otop, community: !!c.community,
        photo: photoOf.get(c.id) ?? null,
        extra_min: Math.round(insertionCost(plan.order.map((x) => x.idx), st.idx, travelMin, st.dwellMin)) };
    }).filter((a) => Number.isFinite(a.extra_min)).sort((a, b) => a.extra_min - b.extra_min).slice(0, 30);

    return { ordered, cards, geometry, along };
  };

  const built = await Promise.all(themed.map(build));
  // where the extra time goes: more time on the road, time at the stops, and waiting for a meal window to open
  const split = (t: typeof themed[number]) => {
    const travel = t.travelMin ?? t.plan.totalMin, stopMin = t.plan.order.reduce((a, s) => a + s.dwellMin, 0);
    return { road_extra_min: Math.max(0, Math.round(travel - t.plan.baseMin)), stop_min: stopMin,
             wait_min: Math.max(0, Math.round(t.plan.totalMin - travel - stopMin)) };
  };
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
    extra_min: Math.round(plan.extraMin), budget_min: budgetMin, budget_auto: autoBudget, quick_stops: quickStops, ...split(themed[topIdx]),
    max_budget_min: MAX_BUDGET,
    candidates_considered: candidates.length,
    stops: ordered, geometry, base_geometry: baseline?.geometry ?? [],
    warnings: [...new Set(warnings)],
    meals, missed_meals: plan.missedMeals, unfit_required: plan.unfitRequired,
    plans: themed.map((t, i) => ({
      id: t.id, name: t.name, stops: built[i].ordered, geometry: built[i].geometry, along: built[i].along,
      extra_min: Math.round(t.plan.extraMin), total_min: Math.round(t.plan.totalMin), ...split(t),
      meals, missed_meals: t.plan.missedMeals, unfit_required: t.plan.unfitRequired,
    })),
  });
});
