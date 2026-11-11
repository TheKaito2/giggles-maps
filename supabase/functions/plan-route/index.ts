import { admin, HttpError, json, num, readJson, requireUser, serve, thaiPoint } from "../_shared/http.ts";
import { type Meal, MEAL_WINDOWS } from "../_shared/meals.ts";
import { insertBest, insertionCost, type Plan, planDetour, type Stop } from "../_shared/planner.ts";
import { fitsInterests, independent, INTERESTS, isInterest, mixWeight, type Tier, THEMES, toTheme } from "../_shared/themes.ts";
import { allowsEstimateFallback, boundedRouter, scheduleStops, verifyRoadPlan } from "../_shared/road-detour.ts";
import { corridorMatrix } from "../_shared/corridor.ts";
import { plannedStops, STOP_CAP, stopCap as capFor, stopLimitCode } from "../_shared/tiers.ts";
import { loadTrip, saveTrip, tripKey } from "../_shared/trip-cache.ts";
import { createRouter, estimateMinutes, RoutingError, haversineM, type LatLng, matrixMinutes, METERS_PER_MIN, type Mode, pairsMinutes,
  pairKey, type RoadRoute } from "../_shared/valhalla.ts";

interface Candidate {
  id: number; name: string; name_th: string | null; category: string; lat: number; lng: number;
  dwell_min: number; rating: number | null;
  is_partner: boolean; is_demo: boolean;
  price_level: number | null;
  tier: Tier;   // 4 icon, 3 landmark, 2 worth a visit, 1 everyday
  frac?: number;   // 0 start .. 1 destination along the direct route (route shortlist only)
  local?: boolean; otop?: boolean; community?: boolean;   // local-first flags (route shortlist only)
  visitors?: number;   // real travellers who checked in here in the last 180 days (shortlist RPCs only)
}
interface NearPlace {
  id: number; name: string; category: string; lat: number; lng: number; rating: number;
  is_partner: boolean; dist_m: number; is_demo: boolean;
}

const MAX_BUDGET = 240; // 4-hour detours for everyone (Plus is cosmetic only)
const MAX_BUDGETS = 5;  // time options planned in one request (Quick, Relaxed, Day out, Half day and a custom time)
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
// plans that are dropped when they repeat an earlier plan's stops (Top picks, Your mix and Partner picks always stay)
const dropsIfDuplicate = (id: string) => id !== "top_picks" && id !== "mix" && id !== "giggles";

serve(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const origin = thaiPoint(body.origin, "bad_origin");
  const dest = thaiPoint(body.dest, "bad_dest");
  const startMin = num(body.start_min, 0, 1439, "bad_start_min");
  if (body.mode != null && !MODES.has(body.mode)) throw new HttpError(400, "bad_mode");
  const mode: Mode = body.mode ?? "pedestrian";
  // "scenic" works as well as "nature"; edits name the plan they change, which can be "Your mix" or "Partner picks"
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
  // stricter filter (optional): no chain shops, cafés or restaurants. Opening hours aren't used yet (no trustworthy data):
  // an old client's open_only is ignored
  const noChains = body.no_chains === true;
  // places the user picked or added from "along your route" (up to 6); they go into every plan when they fit
  const ids = (v: unknown, max: number, code: string): number[] => {
    if (v == null) return [];
    if (!Array.isArray(v) || v.length > max || !v.every((id) => Number.isSafeInteger(id) && id > 0)) throw new HttpError(400, code);
    return v;
  };
  // stops the user removed or swapped out: never offered again in this plan
  const exclude = new Set(ids(body.exclude, 30, "bad_exclude"));
  // the stops an edited plan keeps (a half day can hold 7+); the time budget still decides what fits
  const mustInclude = [...new Set(ids(body.must_include, STOP_CAP.member, "bad_must_include"))].filter((id) => !exclude.has(id));
  // keep_order: true = must_include is the order, exactly (the + between two stops puts a place right there). A list = those
  // stops keep that order and the rest of must_include goes where it fits best ("add along your route" after you dragged
  // stops into your own order: it used to re-sort them all)
  // (each stop once; an empty list pins nothing, so the planner still optimises the order)
  const keepList = body.keep_order === true ? mustInclude
    : Array.isArray(body.keep_order) ? [...new Set(ids(body.keep_order, STOP_CAP.member, "bad_keep_order"))].filter((id) => mustInclude.includes(id)) : [];
  const fixedOrder = keepList.length ? [...keepList] : undefined;
  // time options: one (budget_min, answered in the original shape) or several at once (budgets_min: they share one direct
  // route, one road-time matrix and one quota count, and `results` holds a full answer per option, in the order asked).
  // "auto": half the direct trip, set once the direct route time is known
  const multi = body.budgets_min != null;
  const specs: unknown[] = multi ? body.budgets_min : [body.budget_min];
  if (!Array.isArray(specs) || !specs.length || specs.length > MAX_BUDGETS) throw new HttpError(400, "bad_budget_min");
  const budgets = specs.map((b) => b === "auto" ? "auto" as const : num(b, 0, MAX_BUDGET, "bad_budget_min"));

  const db = admin();
  const { data: profile } = await db.from("profiles").select("plus_until, member_since").eq("id", user.id).maybeSingle();
  const plus = !!profile?.plus_until && new Date(profile.plus_until) > new Date();
  const member = !!profile?.member_since;
  // stops a plan holds (tiers.ts): free plans 3, members and Plus 15. Demo mode doesn't change it: demo is the client's own
  // flag (body.demo), so it can't unlock anything that's paid for.
  const unlimited = member || plus;
  const stopCap = capFor(unlimited);
  const stopRefusal = stopLimitCode(mustInclude.length, unlimited);
  if (stopRefusal) throw new HttpError(stopRefusal === "stop_limit_free" ? 403 : 400, stopRefusal);
  // quotas: free accounts plan 3 destinations and make 10 edits a day; members are unlimited, everyone is rate-limited.
  // A detour is keyed by its destination (~100 m), so the preset plans and preference changes count once; an edit by what it
  // keeps and removes, so the planner's own retries of one edit count once.
  const destKey = `${dest.lat.toFixed(3)},${dest.lng.toFixed(3)}`;
  const edit = mustInclude.length > 0 || exclude.size > 0;
  const quotaKey = edit ? `${destKey}|${[...mustInclude].sort((a, b) => a - b).join(".")}|${[...exclude].sort((a, b) => a - b).join(".")}` : destKey;
  // (an "edit" of a destination not planned today counts as a new detour; the database decides)
  // guests get a taste (1 destination and 3 changes a day), then "sign in to plan more" (403, sign_in_required / sign_in_edits)
  // prices v6: Plus (Trip Pass, yearly, Lifetime) replaces the membership, so it plans without daily limits too
  const { data: allowed, error: qErr } = await db.rpc("plan_allowed", { p_user: user.id, p_edit: edit, p_key: quotaKey, p_dest: destKey, p_member: unlimited,
    p_guest: !!user.is_anonymous });
  if (qErr) throw qErr;
  if (allowed === "sign_in_required" || allowed === "sign_in_edits") throw new HttpError(403, allowed);   // edits: its 3 changes
  if (allowed !== "ok") throw new HttpError(429, allowed);
  // exclusive places are gone; the candidate queries still take a level and every place is level 0
  const { data: level, error: lErr } = await db.rpc("unlock_level", { p_user: user.id });
  if (lErr) throw lErr;

  const warnings: string[] = [];   // for every time option
  const directM = haversineM(origin, dest);
  const shortTrip = directM <= 10000;
  const localWalkingFallback = allowsEstimateFallback(mode, directM);
  // routing calls this request makes (the provider's own count): returned as routing_calls and logged
  const calls = { route: 0, matrix: 0 };
  // milliseconds from the request's start when each phase ended (logged, and returned with routing_calls)
  const t0 = Date.now(), ms: Record<string, number> = {};
  const mark = (phase: string) => { ms[phase] = Date.now() - t0; };
  const routeRoad = createRouter(Deno.env.get("VALHALLA_URL") ?? "https://valhalla1.openstreetmap.de",
    (input, init) => { calls.route++; return fetch(input, init); });
  const fetchPairs: typeof pairsMinutes = (sources, targets, m) => { calls.matrix++; return pairsMinutes(sources, targets, m); };
  // the same trip in the last 30 minutes: its direct route and road times are reused
  const cacheKey = tripKey(mode, origin, dest);
  const trip = await loadTrip(db, cacheKey);
  let knownPairs = trip.pairs.size;   // compared at the end: the row is rewritten only when something new was routed
  let baseline: RoadRoute | null = trip.baseline;
  if (!baseline) {
    try { baseline = await routeRoad([origin, dest], mode); }
    catch (error) {
      console.error("baseline routing failed", error);
      // the routing server's own limit (walking 100 km, cycling 150 km): say so instead of "couldn't route"
      if (error instanceof RoutingError && error.message.includes("max distance")) throw new HttpError(400, "too_far_for_mode");
      // routing down: plan on straight-line estimates, flagged, instead of failing
      warnings.push(localWalkingFallback ? "estimated_local_walk" : "routing_estimated");
    }
  }

  // places the user picked: the same for every time option. A pick far off the route stays out of the matrix (a far point
  // can break the routing call); the planner then reports it in unfit_required. The reach is the longest option's.
  const picked: Candidate[] = [];
  if (mustInclude.length) {
    const { data, error: pErr } = await db.rpc("places_by_ids", { p_ids: mustInclude, p_level: level });
    if (pErr) throw pErr;
    const reach = MAX_BUDGET * METERS_PER_MIN[mode];
    for (const p of (data ?? []) as Candidate[]) if (haversineM(origin, p) + haversineM(p, dest) - directM <= reach) picked.push(p);
  }

  // each time option's shortlist (database work only; no routing calls)
  const prepare = async (spec: number | "auto") => {
    const notes: string[] = [];
    const autoBudget = spec === "auto";
    let budgetMin = autoBudget ? 0 : spec;
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
    const narrowed = interests.length > 0 || noChains;   // the filters below drop places: fetch more first
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
        p_no_chains: noChains,
      })
      : await db.rpc("detour_candidates", {
        o_lat: origin.lat, o_lng: origin.lng, d_lat: dest.lat, d_lng: dest.lng,
        extra_m: budgetMin * 80, max_n: 16 + exclude.size, p_level: level, p_per_group: 4 + Math.min(exclude.size, 3), ...filters, p_meal_slots: meals.length ? 4 : 0,
      });
    if (error) { console.error("candidate lookup failed", error); notes.push("places_unavailable"); }
    // "only these kinds" (a meal asked for still allows restaurants), no chains;
    // places the user named as must-visit always stay in
    const keep = (c: Candidate) => mustInclude.includes(c.id) || (
      (fitsInterests(interests, c.category, c.tier) || (meals.length > 0 && c.category === "food"))
      && (!noChains || independent(c)));
    const candidates = ((cands ?? []) as Candidate[]).filter((c) => !exclude.has(c.id) && keep(c) && haversineM(c, origin) > END_CLEARANCE_M && haversineM(c, dest) > END_CLEARANCE_M)
      .slice(0, maxCandidates);   // over-fetched for the filters: the road-time matrix stays its usual size
    for (const p of picked) if (!candidates.some((c) => c.id === p.id)) candidates.push(p);
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
    return { budgetMin, autoBudget, quickStops, dwellOf, segments, candidates, pitIds, notes };
  };
  mark("baseline");
  const preps = await Promise.all(budgets.map(prepare));
  mark("shortlist");

  // every option's places in one list: one road-time matrix serves them all (a stop's index is its place in this list + 2)
  const union: Candidate[] = [];
  const idxOf = new Map<number, number>();
  for (const p of preps) for (const c of p.candidates) if (!idxOf.has(c.id)) { idxOf.set(c.id, union.length + 2); union.push(c); }
  const unionIds = union.map((c) => c.id);

  // paid tiers: Partner and Giggles Choice. Members' plans put them first; the Partner picks plan uses Choice stops only.
  const tierOf = new Map<number, "partner" | "choice">();
  const pretend = new Set<number>();   // tiers from demo_partners: real places that haven't signed up, labelled as examples
  if (union.length) {
    const { data: tiers, error: tErr } = await db.rpc("places_tiers", { p_ids: unionIds });
    if (tErr) console.error("partner tiers failed", tErr);
    for (const t of (tiers ?? []) as { id: number; tier: "partner" | "choice" }[]) tierOf.set(t.id, t.tier);
    // demo mode only: the pretend partners (demo_partners) count too, so the demo shows badges and the Partner picks plan
    if (body.demo === true) {
      const { data: demo, error: dErr } = await db.from("demo_partners").select("place_id, tier").in("place_id", unionIds);
      if (dErr) console.error("demo partners failed", dErr);
      for (const d of (demo ?? []) as { place_id: number; tier: "partner" | "choice" }[]) if (!tierOf.has(d.place_id)) { tierOf.set(d.place_id, d.tier); pretend.add(d.place_id); }
    }
  }
  const boost = unlimited ? (id: number) => tierOf.get(id) === "choice" ? 2 : tierOf.get(id) === "partner" ? 1.5 : 1 : undefined;
  // precomputed road minutes between nearby places (place_links, built from our own routing server): pairs known there
  // aren't fetched again (they're counted as already known, so they don't rewrite the trip cache either)
  if (baseline && union.length > 1) {
    const { data: links, error: plErr } = await db.from("place_links").select("a, b, minutes").eq("mode", mode).in("a", unionIds).in("b", unionIds);
    if (plErr) console.error("place links failed", plErr);
    const place = new Map(union.map((c) => [c.id, c]));
    for (const l of (links ?? []) as { a: number; b: number; minutes: number }[]) {
      const a = place.get(l.a), b = place.get(l.b);
      if (a && b && !trip.pairs.has(pairKey(a, b))) { trip.pairs.set(pairKey(a, b), l.minutes); knownPairs++; }
    }
  }
  const points: LatLng[] = [origin, dest, ...union.map((c) => ({ lat: c.lat, lng: c.lng }))];
  let matrix = estimateMinutes(points, mode);
  if (baseline && shortTrip) {
    try {
      const roadMatrix = await matrixMinutes(points, mode, fetchPairs, trip.pairs);
      if (!Number.isFinite(roadMatrix[0]?.[1])) throw new Error("unreachable_baseline");
      matrix = roadMatrix;
    } catch (error) { console.error("local matrix failed", error); warnings.push("matrix_unavailable"); }
  }
  // Long trips: off the route + along it + back on, with real road times for stops near each other (corridor.ts).
  // Still only proposals: the plan on screen is road-checked below.
  // more time options share more places: a little more room for matrix calls (6 for one option, up to 12)
  if (baseline && !shortTrip) matrix = (await corridorMatrix(points, baseline, mode, fetchPairs, trip.pairs, Math.min(12, 4 + 2 * budgets.length))).matrix;
  // a short trip whose road matrix failed: straight lines scaled to the known direct road time
  if (baseline && shortTrip && warnings.includes("matrix_unavailable")) {
    const scale = matrix[0][1] > 0 ? baseline.travelMin / matrix[0][1] : 1;
    matrix = matrix.map((row) => row.map((minutes) => minutes * scale));
  }
  mark("matrix");
  const routing = baseline ? "valhalla" : "estimate";
  const travelMin = (a: number, b: number) => matrix[a][b];

  // one photo per place for the cards (Wikimedia, the owner's or a traveller's; never a hidden one), first one wins
  const photoOf = new Map<number, string>();
  if (union.length) {
    const { data: photos, error: phErr } = await db.from("place_photos").select("place_id, url").in("place_id", unionIds)
      .eq("hidden", false).order("id");
    if (phErr) console.error("photos failed", phErr);
    // Wikimedia ones are full URLs; owner and traveller photos are "<bucket>/<path>" in the public shop-photos and
    // place-photos buckets (a traveller's path used to go out as-is: a broken image on the stop card)
    const storage = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/`;
    for (const ph of (photos ?? []) as { place_id: number; url: string }[]) {
      if (!photoOf.has(ph.place_id)) photoOf.set(ph.place_id, /^https?:\/\//.test(ph.url) ? ph.url : storage + ph.url);
    }
  }

  const byId = new Map(union.map((c) => [c.id, c]));
  const at = (s: Stop) => union[s.idx - 2];
  // up to 3 road checks per time option (the plan on screen, a refill, a retry), shared, so options that land on the same
  // stops route them once
  const verification = boundedRouter(routeRoad, 3 * budgets.length + 2);
  // only the plan on screen is road-checked: the asked-for theme, else the first plan (Your mix, else Top picks). The other
  // themes go out on estimated times with verified: false; the app asks for one (theme) when it's opened.
  const shownOf = (themes: { id: string }[]) => themes.some((t) => t.id === requestedTheme) ? requestedTheme : themes[0]?.id;
  const nearCache = new Map<number, NearPlace[]>();

  const planBudget = async (prep: Awaited<ReturnType<typeof prepare>>) => {
    const { budgetMin, quickStops, segments, pitIds } = prep;
    const notes = [...prep.notes];
    const allStops: Stop[] = prep.candidates.map((c) => ({
      idx: idxOf.get(c.id)!, id: c.id, category: c.category, rating: c.rating == null ? null : Number(c.rating), tier: c.tier ?? 2,
      dwellMin: prep.dwellOf(c.dwell_min), frac: c.frac, local: c.local, otop: c.otop, community: c.community, visitors: c.visitors,
    }));
    const stops = allStops.filter((st) => !pitIds.has(st.id)), pitStops = allStops.filter((st) => pitIds.has(st.id));

    // one plan per theme from the same shortlist + matrix; drop themed plans identical to an earlier one
    const seen = new Set<string>();
    let themed: { id: string; name: string; plan: Plan; geometry?: [number, number][]; etaMin?: number[]; travelMin?: number;
      verified?: boolean; refill?: (keep: number[], drop: Set<number>) => Plan }[] = [];
    // "Your mix" (the user's interest chips) leads; the themed plans follow as alternatives
    const choiceStops = stops.filter((st) => tierOf.get(st.id) === "choice" || mustInclude.includes(st.id));
    const variants = [
      ...(interests.length ? [{ id: "mix", name: "Your mix", weight: mixWeight(interests) }] : []),
      ...THEMES.map((t) => ({ id: t.id, name: t.name, theme: t.id })),
      // Partner picks: only places we hand-picked (Giggles Choice), for everyone, when any are along the way
      ...(choiceStops.some((st) => tierOf.get(st.id) === "choice") ? [{ id: "giggles", name: "Partner picks", only: choiceStops }] : []),
    ];
    const prefs = { minRating, allowUnrated: includeUnrated, maxStops: plannedStops(maxStops, unlimited), requiredIds: mustInclude };
    for (const t of variants) {
      const pool = ("only" in t && t.only) || stops;
      const sightsWithin = (budget: number, keep?: number[], drop?: Set<number>) => planDetour({ originIdx: 0, destIdx: 1, startMin, budgetMin: budget,
        stops: drop ? pool.filter((st) => !drop.has(st.id)) : pool,
        // a refill keeps the road-checked stops (their meals already placed) and fills around them
        travelMin, meals: keep ? [] : meals, ...prefs, requiredIds: keep ?? mustInclude, fixedIds: fixedOrder && (keep ?? fixedOrder), boost,
        segments, theme: "theme" in t ? t.theme : undefined, weight: "weight" in t ? t.weight : undefined });
      // Quick: plan the sight leaving room for a pit stop, then add the cheapest store that fits; no store fits, the sight gets it all
      const sights = pitStops.length ? sightsWithin(budgetMin - PIT_RESERVE_MIN) : null;
      // a free plan already at its 3 stops gets no pit stop on top
      const plan = (sights && sights.order.length < stopCap && pitStops.map((pit) => insertBest(sights, pit, travelMin, budgetMin)).filter((x): x is Plan => !!x)
        .sort((a, b) => a.extraMin - b.extraMin)[0]) || sightsWithin(budgetMin);
      const stopsKey = plan.order.map((s) => s.id).join(",");
      if (t.id === "giggles" && !plan.order.some((st) => tierOf.get(st.id) === "choice")) continue;   // no Choice place fits the time
      if (dropsIfDuplicate(t.id) && seen.has(stopsKey)) continue;
      seen.add(stopsKey);
      // Quick plans have no refill: their pit stop isn't in the sight pool, and little time is left to fill
      themed.push({ id: t.id, name: t.name, plan, refill: quickStops ? undefined : (keep, drop) => sightsWithin(budgetMin, keep, drop) });
    }
    const shown = shownOf(themed);
    const verifiedKeys = new Set<string>();
    const verifiedPlans: typeof themed = [];
    for (const t of themed) {
      if (baseline && t.id === shown) {
        const check = (plan: Plan) => verifyRoadPlan({ plan, origin, dest, candidates: union, mode, baseline: baseline!, startMin, budgetMin, route: verification.route });
        // real road minutes replace the estimates for these legs, for the refill and the other plans
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
              missedMeals: verified.plan.missedMeals, requiredIds: verified.plan.requiredIds }).catch((e) => { console.error("refill check failed", e); return null; });
            if (again && !again.failed) learn(again);
            if (again && !again.failed && again.plan.order.length > kept.length && kept.every((s) => again.plan.order.some((o) => o.id === s.id))) verified = again;
          }
        }
        t.plan = verified.plan; t.geometry = verified.geometry; t.etaMin = verified.etaMin; t.travelMin = verified.travelMin; t.verified = true;
        if (verified.failed) notes.push("some_detours_unavailable");
        // an alternative plan the routing server couldn't check at all isn't worth a tab; Top picks always stays
        if (verified.failed && t.id !== "top_picks") continue;
        if (verified.adjusted) notes.push("detours_adjusted");
      } else {
        // estimated: from the matrix (real road times where fetched or learned), drawn stop to stop until it's opened
        const legs = []; let from = 0;
        for (const s of t.plan.order) { legs.push(matrix[from][s.idx]); from = s.idx; }
        legs.push(matrix[from][1]);
        t.etaMin = scheduleStops(t.plan.order, legs, startMin, t.plan.mealOf).etaMin;
        t.travelMin = legs.reduce((a, b) => a + b, 0);
        t.geometry = [origin, ...t.plan.order.map(at), dest].map((p) => [p.lng, p.lat]);
        t.verified = false;   // routing down (routing: "estimate"): the app shows "times are estimates" and doesn't ask again
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
    const cardsFor = async (plan: Plan) => {
      const inRoute = new Set(plan.order.map((s) => s.id));
      const cards = new Map<number, NearPlace>();
      for (const s of plan.order) {
        if (cards.size >= MAX_CARDS) break;
        const c = byId.get(s.id)!;
        if (!CARD_CATEGORIES.has(c.category)) continue;
        if (!nearCache.has(c.id)) {
          const { data, error: nErr } = await db.rpc("places_near", { p_lat: c.lat, p_lng: c.lng, p_radius_m: 400, p_level: level });
          if (nErr) { console.error("nearby places failed", nErr); notes.push("places_unavailable"); }
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
      let t = startMin, from = 0;
      const ordered = plan.order.map((s, index) => {
        const leg = matrix[from][s.idx];   // road minutes from the previous stop (real ones once the plan is road-checked)
        t += leg;
        const late = plan.lateMeals.get(s.id) ?? null;   // a restaurant for this meal, outside its usual hours
        const meal: Meal | null = plan.mealOf.get(s.id) ?? late;
        if (meal && !late) t = Math.max(t, MEAL_WINDOWS[meal][0]);
        const c = byId.get(s.id)!;
        const eta = etaMin![index];
        t += s.dwellMin;
        from = s.idx;
        const card = cards.get(s.id);
        return {
          id: c.id, name: c.name, name_th: c.name_th, category: c.category, lat: c.lat, lng: c.lng,
          // the seeded example partners are partners in demo mode only; in a real plan they're ordinary places
          is_partner: c.is_partner && (!c.is_demo || body.demo === true), is_demo: c.is_demo && body.demo === true,
          rating: c.rating == null ? null : Number(c.rating), price_level: c.price_level, tier: c.tier ?? 2,
          dwell_min: s.dwellMin, eta_min: eta, travel_min: Math.round(leg), pit_stop: pitIds.has(c.id), meal, meal_late: !!late, picked: mustInclude.includes(c.id),
          // about how many minutes this stop adds (road detour + time there): what removing it would save
          extra_min: ((x) => Number.isFinite(x) ? Math.round(x) : null)(insertionCost(plan.order.map((o) => o.idx), s.idx, travelMin, s.dwellMin)),
          photo: photoOf.get(c.id) ?? null,
          local: !!c.local, otop: !!c.otop, community: !!c.community,
          partner_tier: tierOf.get(c.id) ?? null, partner_demo: pretend.has(c.id),
          // field name kept for existing clients; the card is any nearby place, picked by quality
          nearby_partner: card
            ? { id: card.id, name: card.name, category: card.category, lat: card.lat, lng: card.lng,
                distance_m: Math.round(card.dist_m), is_partner: card.is_partner && (!card.is_demo || body.demo === true), is_demo: card.is_demo && body.demo === true }
            : null,
        };
      });

      // "add along your route": the shortlist places this plan left out, cheapest first
      const inPlan = new Set(plan.order.map((x) => x.id));
      const along = stops.filter((st) => !inPlan.has(st.id)).map((st) => {
        const c = byId.get(st.id)!;
        return { id: c.id, name: c.name, name_th: c.name_th, category: c.category, lat: c.lat, lng: c.lng, tier: c.tier ?? 2,
          rating: c.rating == null ? null : Number(c.rating), local: !!c.local, otop: !!c.otop, community: !!c.community,
          photo: photoOf.get(c.id) ?? null, partner_tier: tierOf.get(c.id) ?? null, partner_demo: pretend.has(c.id),
          extra_min: Math.round(insertionCost(plan.order.map((x) => x.idx), st.idx, travelMin, st.dwellMin)) };
      }).filter((a) => Number.isFinite(a.extra_min)).sort((a, b) => a.extra_min - b.extra_min).slice(0, 30);

      return { ordered, cards, geometry, along };
    };

    const built = await Promise.all(themed.map(build));
    // the length of a [lng, lat] line in km: the extra distance is the plan's road line minus the direct one
    const lineKm = (g: [number, number][]) => g.slice(1).reduce((a, p, i) => a + haversineM({ lat: g[i][1], lng: g[i][0] }, { lat: p[1], lng: p[0] }), 0) / 1000;
    const baseKm = lineKm(baseline?.geometry ?? [[origin.lng, origin.lat], [dest.lng, dest.lat]]);
    // where the extra time goes: more time on the road, time at the stops, and waiting for a meal window to open
    const split = (t: typeof themed[number]) => {
      const travel = t.travelMin ?? t.plan.totalMin, stopMin = t.plan.order.reduce((a, s) => a + s.dwellMin, 0);
      return { road_extra_min: Math.max(0, Math.round(travel - t.plan.baseMin)), stop_min: stopMin,
               wait_min: Math.max(0, Math.round(t.plan.totalMin - travel - stopMin)),
               extra_km: Math.max(0, Math.round((lineKm(t.geometry ?? []) - baseKm) * 10) / 10) };
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
    const impressions = [...shownMap].map(([place_id, v]) => ({ route_id: route.id, user_id: user.id, place_id, ...v }));
    if (impressions.length) {
      const { error: sErr } = await db.from("route_stops").insert(impressions);
      if (sErr) throw sErr;
    }

    return {
      route_id: route.id, routing, mode, plus, member, level,
      base_min: Math.round(plan.baseMin), total_min: Math.round(plan.totalMin),
      extra_min: Math.round(plan.extraMin), budget_min: budgetMin, budget_auto: prep.autoBudget, quick_stops: quickStops, ...split(themed[topIdx]),
      verified: themed[topIdx].verified !== false,   // the top-level fields (Top picks) were road-checked
      max_budget_min: MAX_BUDGET, max_stops: stopCap, free_cap: !unlimited, start_min: startMin,
      candidates_considered: prep.candidates.length,
      stops: ordered, geometry, base_geometry: baseline?.geometry ?? [],
      warnings: [...new Set([...warnings, ...notes])],
      meals, missed_meals: plan.missedMeals, unfit_required: plan.unfitRequired,
      plans: themed.map((t, i) => ({
        id: t.id, name: t.name, stops: built[i].ordered, geometry: built[i].geometry, along: built[i].along, verified: t.verified !== false,
        extra_min: Math.round(t.plan.extraMin), total_min: Math.round(t.plan.totalMin), ...split(t),
        meals, missed_meals: t.plan.missedMeals, unfit_required: t.plan.unfitRequired,
      })),
    };
  };

  // one option failing (a database write, say) doesn't take the others down: it answers { error } in its place
  const settled = await Promise.allSettled(preps.map(planBudget));
  for (const s of settled) if (s.status === "rejected") console.error("time option failed", s.reason);
  if (!multi && settled[0].status === "rejected") throw settled[0].reason;
  const results = settled.map((s) => s.status === "fulfilled" ? s.value : { error: "plan_failed" });
  mark("plans");
  // the cache row is rewritten only when this request routed something new
  if (baseline && (!trip.baseline || trip.pairs.size > knownPairs)) await saveTrip(db, cacheKey, baseline, trip.pairs);
  mark("saved");
  const routingCalls = { ...calls, cached_baseline: !!trip.baseline, ms };
  console.log(JSON.stringify({ event: "plan_route", budgets: budgets.length, edit, theme: requestedTheme, places: union.length, routing_calls: routingCalls }));
  return json(multi ? { results, routing_calls: routingCalls } : { ...results[0], routing_calls: routingCalls });
});
