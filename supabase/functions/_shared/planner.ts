// Giggles Maps detour planner. The route is never for sale: stops are chosen on quality
// (rating x variety x trip theme) per added minute. The planner doesn't know which places pay.
// Constraints: total extra time <= budget, every stop open on arrival, rating >= floor (unrated only if allowed),
// meal stops arrive inside their meal window, and at most maxStops stops.
// Phase 0 places the stops the user picked (must_include), then meal stops; phase 1 fills the rest;
// greedy insertion + 2-opt, fine for ~25 candidates.

import { inMealWindow, type Meal, MEAL_CATEGORIES, MEAL_WINDOWS } from "./meals.ts";
import { type Theme, themeWeight } from "./themes.ts";

export interface Stop {
  idx: number;          // row/column in the travel matrix
  id: number;
  category: string;
  rating: number | null;   // null = unrated
  dwellMin: number;
  openMin?: number | null;   // minutes after midnight
  closeMin?: number | null;
}

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
  weight?: (category: string) => number;   // overrides theme, e.g. the user's own mix of interests
  requiredIds?: number[];   // places the user picked; go in first, skip the rating floor, count toward maxStops
  meals?: Meal[];       // meals the trip should cover, from mealsInTrip()
}

export interface Plan {
  order: Stop[];        // chosen stops in visiting order
  baseMin: number;      // origin -> destination with no stops
  totalMin: number;
  extraMin: number;
  mealOf: Map<number, Meal>;   // stop id -> meal it covers
  missedMeals: Meal[];
  requiredIds: number[];
  unfitRequired: number[];     // picked places that don't fit the budget, hours or stop cap
}

const UNRATED = 3.5;   // unrated places score like a middling rating, below the 4.0 default floor
const quality = (s: Stop) => (s.rating ?? UNRATED) / 5;

export function planDetour(input: PlanInput): Plan {
  const { originIdx, destIdx, startMin, budgetMin, travelMin, minRating = 4.0, allowUnrated = false,
          maxStops = Infinity, theme = "top_picks", meals = [] } = input;
  const weight = input.weight ?? ((category: string) => themeWeight(theme, category));
  const eligible = input.stops.filter((s) => s.rating == null ? allowUnrated : s.rating >= minRating);
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

  const score = (s: Stop, order: Stop[], added: number) => {
    const variety = order.some((o) => o.category === s.category) ? 0.5 : 1;
    return (quality(s) * weight(s.category) * variety) / Math.max(added, 1);
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

  // phase 0b: one food stop per meal asked for, in time order
  const missedMeals: Meal[] = [];
  for (const meal of [...meals].sort((a, b) => MEAL_WINDOWS[a][0] - MEAL_WINDOWS[b][0])) {
    if (order.length >= maxStops) { missedMeals.push(meal); continue; }
    let pick: { order: Stop[]; ratio: number; s: Stop } | null = null;
    for (const s of eligible) {
      if (!MEAL_CATEGORIES.has(s.category) || order.includes(s)) continue;
      const trial = new Map(mealOf).set(s.id, meal);
      const ins = bestInsert(order, s, trial);
      if (!ins) continue;
      const ratio = score(s, order, ins.added);
      if (!pick || ratio > pick.ratio) pick = { order: ins.order, ratio, s };
    }
    if (!pick) { missedMeals.push(meal); continue; }
    mealOf.set(pick.s.id, meal);
    order = pick.order;
  }

  // phase 1: fill the remaining budget by quality x theme x variety per added minute
  while (order.length < maxStops) {
    let pick: { order: Stop[]; ratio: number } | null = null;
    for (const s of eligible) {
      if (order.includes(s)) continue;
      const ins = bestInsert(order, s);
      if (!ins) continue;
      const ratio = score(s, order, ins.added);
      if (!pick || ratio > pick.ratio) pick = { order: ins.order, ratio };
    }
    if (!pick) break;
    order = twoOpt(pick.order);
  }

  const totalMin = duration(order);
  return { order, baseMin, totalMin, extraMin: totalMin - baseMin, mealOf, missedMeals, requiredIds, unfitRequired };
}
