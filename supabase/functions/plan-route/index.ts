import { admin, HttpError, json, num, requireUser, serve } from "../_shared/http.ts";
import { type Meal, MEAL_WINDOWS, mealsInTrip } from "../_shared/meals.ts";
import { type Plan, planDetour, type Stop } from "../_shared/planner.ts";
import { isTheme, THEMES } from "../_shared/themes.ts";
import { estimateMinutes, type LatLng, matrixMinutes, type Mode, routeLine } from "../_shared/valhalla.ts";

interface Candidate {
  id: number; name: string; name_th: string | null; category: string; lat: number; lng: number;
  open_min: number | null; close_min: number | null; dwell_min: number; rating: number;
  is_partner: boolean; is_demo: boolean; min_level: number; exclusive_kind: string | null; perk_text: string | null;
}
interface NearPlace {
  id: number; name: string; category: string; lat: number; lng: number; rating: number;
  is_partner: boolean; dist_m: number; is_demo: boolean; min_level: number; exclusive_kind: string | null;
}

const MAX_BUDGET = 240; // v4: 4-hour detours for everyone (Plus is cosmetic only)
const CARD_CATEGORIES = new Set(["park", "viewpoint", "temple"]); // "Near this spot" cards sit under these
const MAX_CARDS = 2;
const MAX_CANDIDATES = 22; // up to 5 per theme group, so every themed plan has its kind of stop to pick

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
  if (body.theme != null && !isTheme(body.theme)) throw new HttpError(400, "bad_theme");

  const db = admin();
  const { data: profile } = await db.from("profiles").select("plus_until, member_since").eq("id", user.id).maybeSingle();
  const plus = !!profile?.plus_until && new Date(profile.plus_until) > new Date();
  const member = !!profile?.member_since;
  // members unlock exclusive places up to their level; everyone else sees level 0 (no exclusives)
  const { data: level, error: lErr } = await db.rpc("unlock_level", { p_user: user.id });
  if (lErr) throw lErr;
  const budgetMin = num(body.budget_min, 0, MAX_BUDGET, "bad_budget_min");

  const metersPerMin = mode === "pedestrian" ? 80 : 500;
  const { data: cands, error } = await db.rpc("detour_candidates", {
    o_lat: origin.lat, o_lng: origin.lng, d_lat: dest.lat, d_lng: dest.lng,
    extra_m: budgetMin * metersPerMin, max_n: MAX_CANDIDATES, p_level: level, p_per_group: 5,
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
  const travelMin = (a: number, b: number) => matrix[a][b];
  // meals the whole trip window (direct time + extra budget) runs through get a food stop
  const meals = mealsInTrip(startMin, startMin + matrix[0][1] + budgetMin);

  // one plan per theme from the same shortlist + matrix; drop themed plans identical to an earlier one
  const seen = new Set<string>();
  const themed: { id: string; name: string; plan: Plan }[] = [];
  for (const t of THEMES) {
    const plan = planDetour({ originIdx: 0, destIdx: 1, startMin, budgetMin, stops, travelMin, theme: t.id, meals });
    const key = plan.order.map((s) => s.id).join(",");
    if (t.id !== "top_picks" && seen.has(key)) continue;
    seen.add(key);
    themed.push({ id: t.id, name: t.name, plan });
  }
  // the asked-for theme goes first in plans[]; top-level fields stay Top picks for existing clients
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
        if (nErr) throw nErr;
        nearCache.set(c.id, (data ?? []) as NearPlace[]);
      }
      const best = nearCache.get(c.id)!.find((p) =>
        !CARD_CATEGORIES.has(p.category) && !inRoute.has(p.id) && ![...cards.values()].some((x) => x.id === p.id));
      if (best) cards.set(s.id, best);
    }
    return cards;
  };

  const build = async (plan: Plan) => {
    const cards = await cardsFor(plan);
    // ETA per stop for the UI; early arrivals at a meal stop wait for the window, as the planner does
    let t = startMin, at = 0;
    const ordered = plan.order.map((s) => {
      t += matrix[at][s.idx];
      const meal: Meal | null = plan.mealOf.get(s.id) ?? null;
      if (meal) t = Math.max(t, MEAL_WINDOWS[meal][0]);
      const c = byId.get(s.id)!;
      const eta = Math.round(t);
      t += s.dwellMin;
      at = s.idx;
      const card = cards.get(s.id);
      return {
        id: c.id, name: c.name, name_th: c.name_th, category: c.category, lat: c.lat, lng: c.lng,
        is_partner: c.is_partner, is_demo: c.is_demo,
        rating: Number(c.rating), dwell_min: c.dwell_min, eta_min: eta, meal,
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

    const linePts = [origin, ...ordered.map((s) => ({ lat: s.lat, lng: s.lng })), dest];
    let geometry: [number, number][];
    try {
      geometry = routing === "valhalla" ? await routeLine(linePts, mode) : linePts.map((p) => [p.lng, p.lat]);
    } catch {
      geometry = linePts.map((p) => [p.lng, p.lat]);
    }
    return { ordered, cards, geometry };
  };

  const built = await Promise.all(themed.map((t) => build(t.plan)));
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
    stops: ordered, geometry,
    meals, missed_meals: plan.missedMeals,
    plans: themed.map((t, i) => ({
      id: t.id, name: t.name, stops: built[i].ordered, geometry: built[i].geometry,
      extra_min: Math.round(t.plan.extraMin), total_min: Math.round(t.plan.totalMin),
      meals, missed_meals: t.plan.missedMeals,
    })),
  });
});
