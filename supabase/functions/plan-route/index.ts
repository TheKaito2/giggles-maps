import { admin, HttpError, json, num, readJson, requireUser, serve, thaiPoint } from "../_shared/http.ts";
import { type Meal, MEAL_WINDOWS } from "../_shared/meals.ts";
import { insertBest, insertionCost, type Plan, planDetour, type Stop } from "../_shared/planner.ts";
import { fitsInterests, independent, INTERESTS, isInterest, mixWeight, type Tier, THEMES, toTheme } from "../_shared/themes.ts";
import { allowsEstimateFallback, boundedRouter, scheduleStops, verifyRoadPlan } from "../_shared/road-detour.ts";
import { corridorMatrix } from "../_shared/corridor.ts";
import { createRouter, estimateMinutes, RoutingError, haversineM, type LatLng, matrixMinutes, METERS_PER_MIN, type Mode, type RoadRoute } from "../_shared/valhalla.ts";

interface Candidate {
  id: number; name: string; name_th: string | null; category: string; lat: number; lng: number;
  open_min: number | null; close_min: number | null; dwell_min: number; rating: number | null;
  is_partner: boolean; is_demo: boolean;
  price_level: number | null;
  tier: Tier;   // 3 landmark, 2 worth a visit, 1 everyday
  frac?: number;   // 0 start .. 1 destination along the direct route (route shortlist only)
  local?: boolean; otop?: boolean; community?: boolean;   // local-first flags (route shortlist only)
}
interface NearPlace {
  id: number; name: string; category: string; lat: number; lng: number; rating: number;
  is_partner: boolean; dist_m: number; is_demo: boolean;
}

const MAX_BUDGET = 240; // 4-hour detours for everyone (Plus is cosmetic only)
const STOP_CAP = { free: 10, member: 15 };   // the most stops a plan holds, generated or added by hand
const CARD_CATEGORIES = new Set(["park", "viewpoint", "temple"]); // "Near this spot" cards sit under these
const MAX_CARDS = 2;
const QUICK_DWELL_MIN = 10; // time counted at each stop on a short (Quick) detour
const PIT_DWELL_MIN = 5;    // a convenience-store pit stop on a Quick detour: snacks, a drink, the toilet
const PIT_RESERVE_MIN = 7;  // kept free for it while the sight is chosen (5 there + a little driving)
const REFILL_MIN = 10;     // a road-checked plan with this much of its time left tries for another stop
const MAX_CANDIDATES = 22; // up to 5 per theme group, so every themed plan has its kind of stop to pick
const MODES = new Set<Mode>(["pedestrian", "bicycle", "auto"]);
const MIN_RATINGS = new Set([0, 3.5, 4, 4.5]);
const END_CLEARANCE_M = 150; // the start and destination themselves aren't detours: places this close to either end are dropped
// plans that are dropped when they repeat an earlier plan's stops (Top picks, Your mix and Giggle's picks always stay)
const dropsIfDuplicate = (id: string) => id !== "top_picks" && id !== "mix" && id !== "giggles";

serve(async (req) => {
  const user = await requireUser(req);
  // detours need a real account (a guest's quota would reset with every fresh anonymous sign-in)
  if (user.is_anonymous) throw new HttpError(403, "sign_in_required");
  const body = await readJson(req);
  const origin = thaiPoint(body.origin, "bad_origin");
  const dest = thaiPoint(body.dest, "bad_dest");
  const startMin = num(body.start_min, 0, 1439, "bad_start_min");
  if (body.mode != null && !MODES.has(body.mode)) throw new HttpError(400, "bad_mode");
  const mode: Mode = body.mode ?? "pedestrian";
  // "scenic" works as well as "nature"; edits name the plan they change, which can be "Your mix" or "Giggle's picks"
  const requestedTheme = body.theme == null ? null : body.theme === "mix" || body.theme === "giggles" ? body.theme : toTheme(body.theme);
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
  if (!Array.isArray(meals) || meals.length > 3 || !meals.every((m) => Object.hasOwn(MEAL_WINDOWS, m))) throw new HttpError(400, "bad_meals");
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
  // the stops an edited plan keeps (a half day can hold 7+); the time budget still decides what fits
  const mustInclude = ids(body.must_include, STOP_CAP.member, "bad_must_include").filter((id) => !exclude.has(id));
  // keep_order: the kept stops stay in exactly this order (the + between two stops puts a place right there)
  const fixedOrder = body.keep_order === true ? [...mustInclude] : undefined;

  const db = admin();
  const { data: profile } = await db.from("profiles").select("plus_until, member_since").eq("id", user.id).maybeSingle();
  const plus = !!profile?.plus_until && new Date(profile.plus_until) > new Date();
  const member = !!profile?.member_since;
  const stopCap = member ? STOP_CAP.member : STOP_CAP.free;
  if (mustInclude.length > stopCap) throw new HttpError(400, "stop_limit");
  // quotas: free accounts plan 3 destinations and make 10 edits a day; members are unlimited, everyone is rate-limited.
  // A detour is keyed by its destination (~100 m), so the 3 preset plans and preference changes count once; an edit by what it
  // keeps and removes, so the planner's own retries of one edit count once.
  const destKey = `${dest.lat.toFixed(3)},${dest.lng.toFixed(3)}`;
  const edit = mustInclude.length > 0 || exclude.size > 0;
  const quotaKey = edit ? `${destKey}|${[...mustInclude].sort((a, b) => a - b).join(".")}|${[...exclude].sort((a, b) => a - b).join(".")}` : destKey;
  // (an "edit" of a destination not planned today counts as a new detour; the database decides)
  const { data: allowed, error: qErr } = await db.rpc("plan_allowed", { p_user: user.id, p_edit: edit, p_key: quotaKey, p_dest: destKey, p_member: member });
  if (qErr) throw qErr;
  if (allowed !== "ok") throw new HttpError(429, allowed);
  // exclusive places are gone; the candidate queries still take a level and every place is level 0
  const { data: level, error: lErr } = await db.rpc("unlock_level", { p_user: user.id });
  if (lErr) throw lErr;
  // "auto": half the direct trip, set once the direct route time is known (below)
  const autoBudget = body.budget_min === "auto";
  let budgetMin = autoBudget ? 0 : num(body.budget_min, 0, MAX_BUDGET, "bad_budget_min");

  const warnings: string[] = [];
  const directM = haversineM(origin, dest);
  const shortTrip = directM <= 10000;
  const localWalkingFallback = allowsEstimateFallback(mode, directM);
  const routeRoad = createRouter(Deno.env.get("VALHALLA_URL") ?? "https://valhalla1.openstreetmap.de");
  let baseline: RoadRoute | null = null;
  try { baseline = await routeRoad([origin, dest], mode); }
  catch (error) {
    console.error("baseline routing failed", error);
    // the routing server's own limit (walking 100 km, cycling 150 km): say so instead of "couldn't route"
    if (error instanceof RoutingError && error.message.includes("max distance")) throw new HttpError(400, "too_far_for_mode");
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
  const segments = directM < 3000 ? 0 : directM < 30000 ? 3 : 5;
  const { data: cands, error } = baseline
    ? await db.rpc("route_detour_candidates", {
      p_geometry: baseline.geometry,
      // out and back off the road at town speed (x1.3 for the bends), with time left to look round: on long trips the
      // wider band only filled the shortlist with places the time can't reach
      p_radius_m: Math.min(20000, shortTrip ? budgetMin * METERS_PER_MIN[mode] / 2 : Math.max(budgetMin - 10, 5) * METERS_PER_MIN[mode] / 2.6),
      // over-fetch by the excluded count so removed stops don't eat the shortlist (they're dropped below)
      // quick stops: any place qualifies, since its time there is capped
      p_budget_min: quickStops ? MAX_BUDGET : budgetMin, p_level: level, p_max_n: maxCandidates + exclude.size + (narrowed ? 20 : 0),
      p_per_group: (shortTrip ? 4 : 5) + Math.min(exclude.size, 3) + (narrowed ? 4 : 0), ...filters,
      p_meal_slots: meals.length ? 4 : 0,   // nearest restaurants always make the shortlist when a meal is asked for
      p_segments: segments,
      // filter the corridor itself, so a narrow filter still gets a full shortlist (keep() below re-checks)
      p_kinds: interests.length ? interests.flatMap((i) => INTERESTS[i]) : null, p_landmarks: interests.includes("landmarks"),
      p_open_only: openOnly, p_no_chains: noChains,
    })
    : await db.rpc("detour_candidates", {
      o_lat: origin.lat, o_lng: origin.lng, d_lat: dest.lat, d_lng: dest.lng,
      extra_m: budgetMin * 80, max_n: 16 + exclude.size, p_level: level, p_per_group: 4 + Math.min(exclude.size, 3), ...filters, p_meal_slots: meals.length ? 4 : 0,
    });
  if (error) { console.error("candidate lookup failed", error); warnings.push("places_unavailable"); }
  // "only these kinds" (a meal asked for still allows restaurants), confirmed opening hours, no chains;
  // places the user named as must-visit always stay in
  const keep = (c: Candidate) => mustInclude.includes(c.id) || (
    (fitsInterests(interests, c.category, c.tier) || (meals.length > 0 && c.category === "food"))
    && (!openOnly || (c.open_min != null && c.close_min != null))
    && (!noChains || independent(c)));
  const candidates = ((cands ?? []) as Candidate[]).filter((c) => !exclude.has(c.id) && keep(c) && haversineM(c, origin) > END_CLEARANCE_M && haversineM(c, dest) > END_CLEARANCE_M)
    .slice(0, maxCandidates);   // over-fetched for the filters: the road-time matrix stays its usual size
  if (mustInclude.length) {
    const { data: picked, error: pErr } = await db.rpc("places_by_ids", { p_ids: mustInclude, p_level: level });
    if (pErr) throw pErr;
    // a pick far off the route stays out of the matrix (a far point can break the routing call); the planner then reports
    // it in unfit_required. The reach is the longest preset's, not this one: picks go in past the chosen time
    const reach = MAX_BUDGET * METERS_PER_MIN[mode];
    for (const p of (picked ?? []) as Candidate[]) {
      if (candidates.some((c) => c.id === p.id)) continue;
      if (haversineM(origin, p) + haversineM(p, dest) - directM <= reach) candidates.push(p);
    }
  }
  // Quick: the convenience stores nearest the road, for a pit stop after the sight. They share the travel-time matrix,
  // but the sight planner never sees them; each plan gets the cheapest one afterwards if time is left (insertBest).
  const pitIds = new Set<number>();
  if (quickStops && baseline) {
    const { data: pits, error: pitErr } = await db.rpc("route_pit_stops", { p_geometry: baseline.geometry, p_radius_m: 800, p_max_n: 6 });
    if (pitErr) console.error("pit stops failed", pitErr);
    for (const p of (pits ?? []) as Candidate[]) {
      if (exclude.has(p.id) || candidates.some((c) => c.id === p.id) || haversineM(p, origin) <= END_CLEARANCE_M || haversineM(p, dest) <= END_CLEARANCE_M) continue;
      candidates.push({ ...p, dwell_min: PIT_DWELL_MIN });
      pitIds.add(p.id);
    }
  }
  // paid tiers: Partner and Giggles Choice. Members' plans put them first; the Giggle's plan uses Choice stops only.
  const tierOf = new Map<number, "partner" | "choice">();
  if (candidates.length) {
    const { data: tiers, error: tErr } = await db.rpc("places_tiers", { p_ids: candidates.map((c) => c.id) });
    if (tErr) console.error("partner tiers failed", tErr);
    for (const t of (tiers ?? []) as { id: number; tier: "partner" | "choice" }[]) tierOf.set(t.id, t.tier);
    // demo mode only: the pretend partners (demo_partners) count too, so the demo shows badges and the Giggle's plan
    if (body.demo === true) {
      const { data: demo, error: dErr } = await db.from("demo_partners").select("place_id, tier").in("place_id", candidates.map((c) => c.id));
      if (dErr) console.error("demo partners failed", dErr);
      for (const d of (demo ?? []) as { place_id: number; tier: "partner" | "choice" }[]) if (!tierOf.has(d.place_id)) tierOf.set(d.place_id, d.tier);
    }
  }
  const boost = member ? (id: number) => tierOf.get(id) === "choice" ? 2 : tierOf.get(id) === "partner" ? 1.5 : 1 : undefined;
  const points: LatLng[] = [origin, dest, ...candidates.map((c) => ({ lat: c.lat, lng: c.lng }))];
  let matrix = estimateMinutes(points, mode);
  if (baseline && shortTrip) {
    try {
      const roadMatrix = await matrixMinutes(points, mode);
      if (!Number.isFinite(roadMatrix[0]?.[1])) throw new Error("unreachable_baseline");
      matrix = roadMatrix;
    } catch (error) { console.error("local matrix failed", error); warnings.push("matrix_unavailable"); }
  }
  // Long trips: off the route + along it + back on, with real road times for stops near each other (corridor.ts).
  // Still only proposals: complete routes are verified below.
  if (baseline && !shortTrip) matrix = (await corridorMatrix(points, baseline, mode)).matrix;
  // a short trip whose road matrix failed: straight lines scaled to the known direct road time
  if (baseline && shortTrip && warnings.includes("matrix_unavailable")) {
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
  let themed: { id: string; name: string; plan: Plan; geometry?: [number, number][]; etaMin?: number[]; travelMin?: number;
    refill?: (keep: number[], drop: Set<number>) => Plan }[] = [];
  // "Your mix" (the user's interest chips) leads; the themed plans follow as alternatives
  const choiceStops = stops.filter((st) => tierOf.get(st.id) === "choice" || mustInclude.includes(st.id));
  const variants = [
    ...(interests.length ? [{ id: "mix", name: "Your mix", weight: mixWeight(interests) }] : []),
    ...THEMES.map((t) => ({ id: t.id, name: t.name, theme: t.id })),
    // Giggle's picks: only places we hand-picked (Giggles Choice), for everyone, when any are along the way
    ...(choiceStops.some((st) => tierOf.get(st.id) === "choice") ? [{ id: "giggles", name: "Giggle's picks", only: choiceStops }] : []),
  ];
  const prefs = { minRating, allowUnrated: includeUnrated, maxStops: maxStops ?? stopCap, requiredIds: mustInclude };
  for (const t of variants) {
    const pool = ("only" in t && t.only) || stops;
    const sightsWithin = (budget: number, keep?: number[], drop?: Set<number>) => planDetour({ originIdx: 0, destIdx: 1, startMin, budgetMin: budget,
      stops: drop ? pool.filter((st) => !drop.has(st.id)) : pool,
      // a refill keeps the road-checked stops (their meals already placed) and fills around them
      travelMin, meals: keep ? [] : meals, ...prefs, requiredIds: keep ?? mustInclude, fixedIds: fixedOrder && (keep ?? fixedOrder), boost,
      segments, theme: "theme" in t ? t.theme : undefined, weight: "weight" in t ? t.weight : undefined });
    // Quick: plan the sight leaving room for a pit stop, then add the cheapest store that fits; no store fits, the sight gets it all
    const sights = pitStops.length ? sightsWithin(budgetMin - PIT_RESERVE_MIN) : null;
    const plan = (sights && pitStops.map((pit) => insertBest(sights, pit, travelMin, budgetMin)).filter((x): x is Plan => !!x)
      .sort((a, b) => a.extraMin - b.extraMin)[0]) || sightsWithin(budgetMin);
    const stopsKey = plan.order.map((s) => s.id).join(",");
    if (t.id === "giggles" && !plan.order.some((st) => tierOf.get(st.id) === "choice")) continue;   // no Choice place fits the time
    if (dropsIfDuplicate(t.id) && seen.has(stopsKey)) continue;
    seen.add(stopsKey);
    // Quick plans have no refill: their pit stop isn't in the sight pool, and little time is left to fill
    themed.push({ id: t.id, name: t.name, plan, refill: quickStops ? undefined : (keep, drop) => sightsWithin(budgetMin, keep, drop) });
  }
  // up to 18 routing calls per request, shared by all plans: one per plan, retries when a long route times out, refills
  const verification = boundedRouter(routeRoad, 18);
  const verifiedKeys = new Set<string>();
  const verifiedPlans: typeof themed = [];
  for (const t of themed) {
    if (baseline) {
      const check = (plan: Plan) => verifyRoadPlan({ plan, origin, dest, candidates, mode, baseline, startMin, budgetMin, route: verification.route });
      // real road minutes replace the estimates for these legs, for the refill and the plans after this one
      const learn = (v: Awaited<ReturnType<typeof check>>) => {
        const path = [0, ...v.plan.order.map((s) => s.idx), 1];
        v.legs.forEach((min, i) => { matrix[path[i]][path[i + 1]] = min; });
      };
      let verified = await check(t.plan);
      if (!verified.failed) learn(verified);
      // time left over on the real roads (stops dropped, or the estimates ran long): fill it from what's left, never a
      // dropped stop again, keeping every stop that passed; the refill must pass the road check too, or the first result stands
      if (t.refill && !verified.failed && budgetMin - verified.plan.extraMin >= REFILL_MIN) {
        const kept = verified.plan.order;
        const drop = new Set(t.plan.order.filter((s) => !kept.includes(s)).map((s) => s.id));
        const more = t.refill(kept.map((s) => s.id), drop);
        if (more.order.length > kept.length) {
          const again = await check({ ...more, mealOf: verified.plan.mealOf, lateMeals: verified.plan.lateMeals,
            missedMeals: verified.plan.missedMeals, requiredIds: verified.plan.requiredIds });
          if (!again.failed) learn(again);
          if (!again.failed && again.plan.order.length > kept.length && kept.every((s) => again.plan.order.some((o) => o.id === s.id))) verified = again;
        }
      }
      t.plan = verified.plan; t.geometry = verified.geometry; t.etaMin = verified.etaMin; t.travelMin = verified.travelMin;
      if (verified.failed) warnings.push("some_detours_unavailable");
      // an alternative plan the routing server couldn't check at all isn't worth a tab; Top picks always stays
      if (verified.failed && t.id !== "top_picks") continue;
      if (verified.adjusted) warnings.push("detours_adjusted");
    } else {
      const legs = []; let at = 0;
      for (const s of t.plan.order) { legs.push(matrix[at][s.idx]); at = s.idx; }
      legs.push(matrix[at][1]);
      t.etaMin = scheduleStops(t.plan.order, legs, startMin, t.plan.mealOf, t.plan.requiredIds).etaMin;
      t.travelMin = legs.reduce((a, b) => a + b, 0);
      t.geometry = [origin, ...t.plan.order.map((s) => candidates[s.idx - 2]), dest].map((p) => [p.lng, p.lat]);
    }
    const stopsKey = t.plan.order.map((s) => s.id).join(",");
    if (dropsIfDuplicate(t.id) && verifiedKeys.has(stopsKey)) continue;
    // an alternative with no stops is an empty tab (Local gems on a chain-store high street); Top picks always stays
    if (t.id !== "top_picks" && !t.plan.order.length) continue;
    verifiedKeys.add(stopsKey);
    verifiedPlans.push(t);
  }
  themed = verifiedPlans;
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
        closed: plan.closedPicks.includes(c.id),   // you added it, but it's closed when you get there
        // about how many minutes this stop adds (road detour + time there): what removing it would save
        extra_min: ((x) => Number.isFinite(x) ? Math.round(x) : null)(insertionCost(plan.order.map((o) => o.idx), s.idx, travelMin, s.dwellMin)),
        photo: photoOf.get(c.id) ?? null,
        local: !!c.local, otop: !!c.otop, community: !!c.community,
        partner_tier: tierOf.get(c.id) ?? null,
        // field name kept for existing clients; the card is any nearby place, picked by quality
        nearby_partner: card
          ? { id: card.id, name: card.name, category: card.category, lat: card.lat, lng: card.lng,
              distance_m: Math.round(card.dist_m), is_partner: card.is_partner, is_demo: card.is_demo }
          : null,
      };
    });

    // "add along your route": the shortlist places this plan left out, cheapest first
    const inPlan = new Set(plan.order.map((x) => x.id));
    const along = stops.filter((st) => !inPlan.has(st.id)).map((st) => {
      const c = byId.get(st.id)!;
      return { id: c.id, name: c.name, name_th: c.name_th, category: c.category, lat: c.lat, lng: c.lng, tier: c.tier ?? 2,
        rating: c.rating == null ? null : Number(c.rating), local: !!c.local, otop: !!c.otop, community: !!c.community,
        photo: photoOf.get(c.id) ?? null, partner_tier: tierOf.get(c.id) ?? null,
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
    max_budget_min: MAX_BUDGET, max_stops: stopCap,
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
