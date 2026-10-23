// Giggles Maps detour planner. The route is never for sale: stops are chosen on quality
// (rating x variety x trip theme) per added minute. The planner doesn't know which places pay.
// Constraints: total extra time <= budget, every stop open on arrival, rating >= floor (unrated only if allowed),
// meal stops arrive inside their meal window, and at most maxStops stops.
// Phase 0 places the stops the user picked (must_include), then meal stops; phase 1 fills the rest;
// greedy insertion + 2-opt, fine for ~25 candidates.

import { inMealWindow, type Meal, MEAL_PLACES, MEAL_WINDOWS } from "./meals.ts";
import { type Theme, type Tier, themeWeight } from "./themes.ts";

export interface Stop {
  idx: number;          // row/column in the travel matrix
  id: number;
  category: string;
  rating: number | null;   // null = unrated
  tier?: Tier;             // 3 landmark, 2 worth a visit, 1 everyday (default 2)
  dwellMin: number;
  openMin?: number | null;   // minutes after midnight
  closeMin?: number | null;
  frac?: number;            // where along the direct route it sits: 0 start, 1 destination
  local?: boolean;          // independent food/café/craft/market place (not a chain)
  otop?: boolean;           // OTOP shop (One Tambon One Product)
  community?: boolean;      // community enterprise
}

// Local first (docs/LOCAL-FIRST.md): a free, published boost for independent and community businesses. Paying
// partners never change ranking; this does, for everyone equally.
const localBoost = (s: Stop) => s.otop || s.community ? 1.6 : s.local ? 1.3 : 1;
const isLocal = (s: Stop) => !!(s.otop || s.community || s.local);

export interface PlanInput {
  originIdx: number;
  destIdx: number;
  startMin: number;
  budgetMin: number;
  stops: Stop[];
  travelMin: (from: number, to: number) => number;
  minRating?: number;
  allowUnrated?: boolean;
  maxStops?: number;    // default no cap; meal stops count
  theme?: Theme;        // default top_picks (no boost)
  weight?: (category: string, tier?: Tier) => number;   // overrides theme, e.g. the user's own mix of interests
  requiredIds?: number[];   // places the user picked; go in first, skip the rating floor, count toward maxStops
  meals?: Meal[];       // meals the trip should cover, from mealsInTrip()
  segments?: number;    // spread stops over this many stretches of the route (0/undefined = off, e.g. city trips)
}

export interface Plan {
  order: Stop[];        // chosen stops in visiting order
  baseMin: number;      // origin -> destination with no stops
  totalMin: number;
  extraMin: number;
  mealOf: Map<number, Meal>;   // stop id -> meal it covers, arriving inside the meal window
  lateMeals: Map<number, Meal>;  // meal stops the route can't reach in the window: the best time the route allows
  missedMeals: Meal[];
  requiredIds: number[];
  unfitRequired: number[];     // picked places that don't fit the budget, hours or stop cap
}

const UNRATED = 3.5;   // unrated places score like a middling rating, below the 4.0 default floor
const quality = (s: Stop) => (s.rating ?? UNRATED) / 5;
// Landmarks are what a detour is for: they outweigh a nearby cafe even when they add more minutes.
const TIER_VALUE: Record<Tier, number> = { 3: 3, 2: 1.2, 1: 0.5 };

export function planDetour(input: PlanInput): Plan {
  const { originIdx, destIdx, startMin, budgetMin, travelMin, minRating = 4.0, allowUnrated = false,
          maxStops = Infinity, theme = "top_picks", meals = [] } = input;
  const weight = input.weight ?? ((category: string, tier?: Tier) => themeWeight(theme, category, tier));
  // Local gems: independent and community places only
  const eligible = input.stops.filter((s) => (s.rating == null ? allowUnrated : s.rating >= minRating) && (theme !== "local" || isLocal(s)));
  const mealOf = new Map<number, Meal>();

  // Walk the order on the clock. Arriving early for a meal means waiting until the window opens
  // (the wait counts against the budget); arriving late for a meal, or outside opening hours, fails.
  const walk = (order: Stop[], meals = mealOf): { minutes: number; ok: boolean } => {
    let t = startMin, at = originIdx, ok = true;
    for (const s of order) {
      t += travelMin(at, s.idx);
      const meal = meals.get(s.id);
      if (meal) {
        const [from, to] = MEAL_WINDOWS[meal];
        if (t < from) t = from;
        if (!inMealWindow(meal, t) || t > to) ok = false;
      }
      if (s.openMin != null && s.closeMin != null && (t < s.openMin || t + s.dwellMin > s.closeMin)) ok = false;
      t += s.dwellMin;
      at = s.idx;
    }
    return { minutes: t + travelMin(at, destIdx) - startMin, ok };
  };
  const duration = (order: Stop[], meals = mealOf) => walk(order, meals).minutes;

  const baseMin = duration([]);
  const feasible = (order: Stop[], meals = mealOf) => {
    const w = walk(order, meals);
    return w.ok && w.minutes - baseMin <= budgetMin + 1e-9;
  };

  // reverse any segment that shortens the trip while staying feasible
  const twoOpt = (o: Stop[]): Stop[] => {
    let best = o, improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < best.length - 1; i++) {
        for (let k = i + 1; k < best.length; k++) {
          const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
          if (duration(cand) < duration(best) - 1e-9 && feasible(cand)) { best = cand; improved = true; }
        }
      }
    }
    return best;
  };

  // cheapest feasible way to add s to the current order
  const bestInsert = (order: Stop[], s: Stop, meals = mealOf) => {
    let best: { order: Stop[]; added: number } | null = null;
    const current = duration(order);
    for (let i = 0; i <= order.length; i++) {
      const next = [...order.slice(0, i), s, ...order.slice(i)];
      if (!feasible(next, meals)) continue;
      const added = duration(next, meals) - current;
      if (!best || added < best.added) best = { order: next, added };
    }
    return best;
  };

  // Spread stops along the way: without this, once one stop sits near an end its neighbours are the cheapest
  // additions and the whole budget piles up at the start or the destination city.
  const segments = input.segments ?? 0;
  const stretch = (f: number) => Math.min(segments - 1, Math.floor(f * segments));
  const spread = (s: Stop, order: Stop[]) => {
    if (!segments || s.frac == null) return 1;
    if (order.some((o) => o.frac != null && stretch(o.frac) === stretch(s.frac!))) return 0.55;
    const fr = [0, ...order.map((o) => o.frac ?? 0), 1].sort((a, b) => a - b);
    let lo = 0, hi = 1, gap = -1;
    for (let i = 1; i < fr.length; i++) if (fr[i] - fr[i - 1] > gap) { gap = fr[i] - fr[i - 1]; lo = fr[i - 1]; hi = fr[i]; }
    return s.frac > lo && s.frac < hi ? 1.15 : 1;   // a small nudge toward the longest empty stretch
  };

  const score = (s: Stop, order: Stop[], added: number) => {
    const variety = order.some((o) => o.category === s.category) ? 0.5 : 1;
    // value per minute, but sqrt(minutes): a landmark 40 min away should beat a cafe 5 min away
    return (TIER_VALUE[s.tier ?? 2] * quality(s) * weight(s.category, s.tier) * variety * spread(s, order) * localBoost(s))
      / Math.sqrt(Math.max(added, 1));
  };

  // phase 0a: the places the user picked, each at its cheapest feasible position
  let order: Stop[] = [];
  const requiredIds = input.requiredIds ?? [];
  const unfitRequired: number[] = [];
  for (const id of requiredIds) {
    const s = input.stops.find((x) => x.id === id);
    const ins = s && order.length < maxStops ? bestInsert(order, s) : null;
    if (ins) order = ins.order; else unfitRequired.push(id);
  }

  // phase 0b: one restaurant per meal asked for, in time order. Inside the meal window if the route can reach it;
  // otherwise (window already passed, or the wait wouldn't fit) still a restaurant, at the best time the route allows
  const missedMeals: Meal[] = [];
  const lateMeals = new Map<number, Meal>();
  for (const meal of [...meals].sort((a, b) => MEAL_WINDOWS[a][0] - MEAL_WINDOWS[b][0])) {
    if (order.length >= maxStops) { missedMeals.push(meal); continue; }
    const pickMeal = (inWindow: boolean) => {
      let pick: { order: Stop[]; ratio: number; s: Stop } | null = null;
      for (const s of input.stops) {   // restaurants skip the rating floor: unrated is normal for them
        if (!MEAL_PLACES[meal].has(s.category) || order.includes(s) || weight(s.category, s.tier) === 0) continue;
        const ins = bestInsert(order, s, inWindow ? new Map(mealOf).set(s.id, meal) : mealOf);
        if (!ins) continue;
        const ratio = score(s, order, ins.added);
        if (!pick || ratio > pick.ratio) pick = { order: ins.order, ratio, s };
      }
      return pick;
    };
    const onTime = pickMeal(true);
    const pick = onTime ?? pickMeal(false);
    if (!pick) { missedMeals.push(meal); continue; }
    if (onTime) mealOf.set(pick.s.id, meal); else lateMeals.set(pick.s.id, meal);
    order = pick.order;
  }

  // phase 1: fill the remaining budget by quality x theme x variety per added minute
  while (order.length < maxStops) {
    let pick: { order: Stop[]; ratio: number } | null = null;
    for (const s of eligible) {
      if (order.includes(s) || weight(s.category, s.tier) === 0) continue;
      const ins = bestInsert(order, s);
      if (!ins) continue;
      const ratio = score(s, order, ins.added);
      if (!pick || ratio > pick.ratio) pick = { order: ins.order, ratio };
    }
    if (!pick) break;
    order = twoOpt(pick.order);
  }

  // every plan offers at least one local stop when one still fits the time and the stop cap
  if (!order.some(isLocal) && order.length < maxStops) {
    let pick: { order: Stop[]; ratio: number } | null = null;
    for (const s of eligible) {
      if (!isLocal(s) || order.includes(s) || weight(s.category, s.tier) === 0) continue;
      const ins = bestInsert(order, s);
      if (!ins) continue;
      const ratio = score(s, order, ins.added);
      if (!pick || ratio > pick.ratio) pick = { order: ins.order, ratio };
    }
    if (pick) order = twoOpt(pick.order);
  }

  const totalMin = duration(order);
  return { order, baseMin, totalMin, extraMin: totalMin - baseMin, mealOf, lateMeals, missedMeals, requiredIds, unfitRequired };
}

/**
 * Minutes a stop adds to a route: the cheapest place to slot point `idx` into `order` (matrix indexes, origin and
 * destination excluded), plus time spent there. With idx already in `order`, what removing it would save.
 */
export function insertionCost(order: number[], idx: number, travelMin: (a: number, b: number) => number,
  dwellMin: number, originIdx = 0, destIdx = 1): number {
  const at = order.indexOf(idx);
  if (at >= 0) {
    const prev = at === 0 ? originIdx : order[at - 1], next = at === order.length - 1 ? destIdx : order[at + 1];
    return travelMin(prev, idx) + travelMin(idx, next) - travelMin(prev, next) + dwellMin;
  }
  const path = [originIdx, ...order, destIdx];
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) best = Math.min(best, travelMin(path[i], idx) + travelMin(idx, path[i + 1]) - travelMin(path[i], path[i + 1]));
  return best + dwellMin;
}
