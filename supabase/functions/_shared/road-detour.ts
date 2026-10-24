import type { Plan, Stop } from "./planner.ts";
import { inMealWindow, type Meal, MEAL_WINDOWS } from "./meals.ts";
import type { LatLng, Mode, RoadRoute } from "./valhalla.ts";

export const allowsEstimateFallback = (mode: Mode, distanceM: number) => mode === "pedestrian" && distanceM <= 10000;

export function visitIsOpen(arrival: number, dwell: number, open: number | null | undefined, close: number | null | undefined) {
  if (open == null || close == null || open === close) return true;
  const day = Math.floor(arrival / 1440);
  return [day - 1, day].some((d) => {
    const from = d * 1440 + open, to = d * 1440 + close + (close < open ? 1440 : 0);
    return arrival >= from && arrival + dwell <= to;
  });
}

export function scheduleStops(order: Stop[], legs: number[], startMin: number, mealOf: Map<number, Meal>) {
  let time = startMin;
  const etaMin: number[] = [];
  let failed = -1;
  if (legs.length !== order.length + 1 || legs.some((t) => !Number.isFinite(t) || t < 0)) {
    return { totalMin: Infinity, etaMin, failed: 0 };
  }
  order.forEach((s, i) => {
    time += legs[i];
    const meal = mealOf.get(s.id);
    if (meal) {
      time = Math.max(time, MEAL_WINDOWS[meal][0]);
      if (!inMealWindow(meal, time)) failed = i;
    }
    if (!visitIsOpen(time, s.dwellMin, s.openMin, s.closeMin)) failed = i;
    etaMin.push(Math.round(time)); time += s.dwellMin;
  });
  return { totalMin: time + legs[order.length] - startMin, etaMin, failed };
}

// Per-request cache/limit shared across all the plans (one per theme, plus mix/Giggle's), never a budget per plan.
export function boundedRouter(route: (points: LatLng[], mode: Mode) => Promise<RoadRoute>, limit = 7, durationMs = 24000) {
  const cache = new Map<string, Promise<RoadRoute>>();
  const deadline = Date.now() + durationMs;
  let calls = 0;
  const limited = (points: LatLng[], mode: Mode) => {
    const key = JSON.stringify([mode, points]);
    if (cache.has(key)) return cache.get(key)!;
    if (calls >= limit || Date.now() >= deadline) return Promise.reject(new Error("routing_work_limit"));
    calls++;
    const result = route(points, mode);
    cache.set(key, result);
    return result;
  };
  return { route: limited, calls: () => calls };
}

// The theme/meal planner (planner.ts) proposes an order. Only complete road-verified orders are returned.
export async function verifyRoadPlan(input: {
  plan: Plan; origin: LatLng; dest: LatLng; candidates: LatLng[]; mode: Mode;
  baseline: RoadRoute; startMin: number; budgetMin: number;
  route: (points: LatLng[], mode: Mode) => Promise<RoadRoute>;
}) {
  let order = [...input.plan.order], adjusted = false, routeErrors = 0;
  // the stop to give up first: the last one that isn't a meal or a place the user picked
  const dropIndex = () => {
    const discretionary = order.map((s, i) => !input.plan.mealOf.has(s.id) && !input.plan.lateMeals.has(s.id)
      && !input.plan.requiredIds.includes(s.id) ? i : -1)
      .filter((i) => i >= 0);
    return discretionary.at(-1) ?? order.length - 1;
  };
  for (;;) {
    let road = input.baseline;
    if (order.length) {
      try { road = await input.route([input.origin, ...order.map((s) => input.candidates[s.idx - 2]), input.dest], input.mode); }
      // a long many-stop route can time out on the routing server: drop one stop and try again,
      // rather than throwing the whole plan away (that left long trips with no stops at all)
      catch { routeErrors++; adjusted = true; order.splice(dropIndex(), 1); continue; }
    }
    const clock = scheduleStops(order, road.legMin, input.startMin, input.plan.mealOf);
    if (clock.failed < 0 && clock.totalMin - input.baseline.travelMin <= input.budgetMin + 1e-7) {
      const mealOf = new Map([...input.plan.mealOf].filter(([id]) => order.some((s) => s.id === id)));
      const lostMeals = [...input.plan.mealOf, ...input.plan.lateMeals].filter(([id]) => !order.some((s) => s.id === id)).map(([, meal]) => meal);
      const lateMeals = new Map([...input.plan.lateMeals].filter(([id]) => order.some((s) => s.id === id)));
      return { plan: { ...input.plan, order, mealOf, lateMeals,
        baseMin: input.baseline.travelMin, totalMin: clock.totalMin,
        extraMin: Math.max(0, clock.totalMin - input.baseline.travelMin),
        missedMeals: [...new Set([...input.plan.missedMeals, ...lostMeals])],
        unfitRequired: input.plan.requiredIds.filter((id) => !order.some((s) => s.id === id)) },
        geometry: road.geometry, etaMin: clock.etaMin, travelMin: road.legMin.reduce((a, b) => a + b, 0), adjusted,
        failed: routeErrors > 0 && !order.length && input.plan.order.length > 0 };
    }
    if (!order.length) throw new Error("invalid_baseline_route");
    // Preserve meals and picked places while trimming stops to fit the actual road duration.
    order.splice(clock.failed >= 0 ? clock.failed : dropIndex(), 1);
    adjusted = true;
  }
}
