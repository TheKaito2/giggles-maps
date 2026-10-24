import { expect, test } from "bun:test";
import { insertBest, planDetour, type Stop, insertionCost } from "./planner.ts";
import { fitsInterests, independent, mixWeight } from "./themes.ts";

// grid world: travel minutes = manhattan distance between points
const pts = [
  { x: 0, y: 0 },  // 0 origin
  { x: 10, y: 0 }, // 1 destination
  { x: 5, y: 2 },  // 2 temple (great)
  { x: 5, y: 1 },  // 3 park
  { x: 3, y: 1 },  // 4 café on the route
  { x: 9, y: 9 },  // 5 café far off the route
  { x: 6, y: 0 },  // 6 low-rated stop
  { x: 7, y: 0 },  // 7 closed stop
];
const travelMin = (a: number, b: number) => Math.abs(pts[a].x - pts[b].x) + Math.abs(pts[a].y - pts[b].y);
const stops: Stop[] = [
  { idx: 2, id: 2, category: "temple", rating: 4.8, dwellMin: 15 },
  { idx: 3, id: 3, category: "park", rating: 4.4, dwellMin: 10 },
  { idx: 4, id: 4, category: "cafe", rating: 4.3, dwellMin: 10 },
  { idx: 5, id: 5, category: "cafe", rating: 4.5, dwellMin: 10 },
  { idx: 6, id: 6, category: "food", rating: 3.2, dwellMin: 5 },
  { idx: 7, id: 7, category: "art", rating: 4.9, dwellMin: 5, openMin: 900, closeMin: 1000 },
];
const plan = (budgetMin: number) =>
  planDetour({ originIdx: 0, destIdx: 1, startMin: 540, budgetMin, stops, travelMin });
const ids = (p: ReturnType<typeof plan>) => p.order.map((s) => s.id);

test("never exceeds the user's extra-time budget", () => {
  for (const b of [0, 5, 12, 20, 35, 60, 120]) expect(plan(b).extraMin).toBeLessThanOrEqual(b);
});

test("quality per added minute: the on-route café beats the far one", () => {
  const p = ids(plan(35));
  expect(p).toContain(4);
  expect(p).not.toContain(5);
});

test("low-rated and closed stops are skipped; tiny budget adds nothing", () => {
  expect(ids(plan(120))).not.toContain(6);
  expect(ids(plan(120))).not.toContain(7);
  expect(plan(3).order).toHaveLength(0);
});

// ---- themes and meals ----
import { mealsInTrip } from "./meals.ts";

// a café and a park, each the same small detour off a 10-minute line, nothing else to pick from
const pts2 = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: 2 }, { x: 6, y: 2 }];
const travel2 = (a: number, b: number) => Math.abs(pts2[a].x - pts2[b].x) + Math.abs(pts2[a].y - pts2[b].y);
const two: Stop[] = [
  { idx: 2, id: 20, category: "food", rating: 4.2, dwellMin: 20 },
  { idx: 3, id: 30, category: "park", rating: 4.2, dwellMin: 20 },
];
const firstPick = (theme: "food" | "nature", budgetMin = 25) =>
  planDetour({ originIdx: 0, destIdx: 1, startMin: 600, budgetMin, stops: two, travelMin: travel2, theme }).order[0]?.id;

test("a theme boosts its kind of stop when only one fits", () => {
  expect(firstPick("food")).toBe(20);
  expect(firstPick("nature")).toBe(30);
});

test("top_picks matches the plain planner", () => {
  const plain = planDetour({ originIdx: 0, destIdx: 1, startMin: 540, budgetMin: 60, stops, travelMin });
  const top = planDetour({ originIdx: 0, destIdx: 1, startMin: 540, budgetMin: 60, stops, travelMin, theme: "top_picks" });
  expect(top.order.map((s) => s.id)).toEqual(plain.order.map((s) => s.id));
});

test("meals: only meals the trip actually overlaps", () => {
  expect(mealsInTrip(11 * 60, 13 * 60)).toEqual(["lunch"]);
  expect(mealsInTrip(6 * 60, 7 * 60 + 20)).toEqual([]);              // 20 min of breakfast: too little
  expect(mealsInTrip(8 * 60, 18 * 60)).toEqual(["breakfast", "lunch", "dinner"]);
});

test("a lunch stop arrives inside the lunch window, even on a nature plan", () => {
  const p = planDetour({ originIdx: 0, destIdx: 1, startMin: 11 * 60 + 20, budgetMin: 60, stops: two,
                         travelMin: travel2, theme: "nature", meals: ["lunch"] });
  const lunch = p.order.find((s) => p.mealOf.get(s.id) === "lunch");
  expect(lunch?.id).toBe(20);
  let t = 11 * 60 + 20, at = 0;
  for (const s of p.order) { t += travel2(at, s.idx); if (s.id === 20) break; t += s.dwellMin; at = s.idx; }
  t = Math.max(t, 11 * 60 + 30);   // early arrivals wait for lunch
  expect(t).toBeGreaterThanOrEqual(11 * 60 + 30);
  expect(t).toBeLessThanOrEqual(13 * 60 + 30);
  expect(p.extraMin).toBeLessThanOrEqual(60);
});

test("a meal the route can't reach in its window still gets a restaurant, at the best time", () => {
  const p = planDetour({ originIdx: 0, destIdx: 1, startMin: 9 * 60, budgetMin: 60, stops: two,
                         travelMin: travel2, meals: ["dinner"] });
  expect([...p.mealOf.values()]).not.toContain("dinner");      // not in the dinner window...
  expect([...p.lateMeals.values()]).toEqual(["dinner"]);       // ...but a restaurant is still on the route
  expect(p.missedMeals).toEqual([]);
  expect(p.extraMin).toBeLessThanOrEqual(60);
});

test("a meal stop is a restaurant, not a cafe; reported only when no restaurant fits the budget", () => {
  const withCafe: Stop[] = [...two, { idx: 3, id: 31, category: "cafe", rating: 5, dwellMin: 10 }];
  const p = planDetour({ originIdx: 0, destIdx: 1, startMin: 11 * 60 + 25, budgetMin: 60, stops: withCafe,
                         travelMin: travel2, meals: ["lunch"] });
  expect(p.order.find((s) => p.mealOf.get(s.id) === "lunch")?.category).toBe("food");
  const none = planDetour({ originIdx: 0, destIdx: 1, startMin: 11 * 60 + 25, budgetMin: 10, stops: withCafe,
                            travelMin: travel2, meals: ["lunch"] });
  expect(none.missedMeals).toEqual(["lunch"]);
});

test("your mix boosts the kinds your interests cover, like a theme does", () => {
  const p = planDetour({ originIdx: 0, destIdx: 1, startMin: 540, budgetMin: 25, stops: two, travelMin: travel2,
                         weight: mixWeight(["nature"]) });
  expect(p.order[0]?.category).toBe("park");
  expect(mixWeight(["cafes", "shopping"])("market")).toBe(2);
  expect(mixWeight([])("cafe")).toBe(1);
});

test("max stops caps every plan; meals count toward the cap", () => {
  const capped = planDetour({ originIdx: 0, destIdx: 1, startMin: 540, budgetMin: 120, stops, travelMin, maxStops: 1 });
  expect(capped.order.length).toBe(1);
  const meal = planDetour({ originIdx: 0, destIdx: 1, startMin: 11 * 60 + 25, budgetMin: 120, stops, travelMin,
                           maxStops: 1, meals: ["lunch"] });
  expect(meal.order.length).toBe(1);
  expect(meal.mealOf.size + meal.missedMeals.length).toBe(1);
});

test("unrated places only join when allowed, and the rating floor is the user's", () => {
  const withUnrated: Stop[] = [...stops, { idx: 6, id: 60, category: "viewpoint", rating: null, dwellMin: 5 }];
  const off = planDetour({ originIdx: 0, destIdx: 1, startMin: 540, budgetMin: 120, stops: withUnrated, travelMin });
  expect(off.order.map((s) => s.id)).not.toContain(60);
  const on = planDetour({ originIdx: 0, destIdx: 1, startMin: 540, budgetMin: 120, stops: withUnrated, travelMin, allowUnrated: true });
  expect(on.order.map((s) => s.id)).toContain(60);
  const strict = planDetour({ originIdx: 0, destIdx: 1, startMin: 540, budgetMin: 120, stops, travelMin, minRating: 4.5 });
  expect(strict.order.every((s) => (s.rating ?? 0) >= 4.5)).toBe(true);
});

test("a picked place goes in even below the rating floor, inside the budget", () => {
  // stop 6 is rated 3.2: the planner would never choose it, but the user picked it
  const p = planDetour({ originIdx: 0, destIdx: 1, startMin: 540, budgetMin: 30, stops, travelMin, requiredIds: [6] });
  expect(p.order.map((s) => s.id)).toContain(6);
  expect(p.unfitRequired).toEqual([]);
  expect(p.extraMin).toBeLessThanOrEqual(30);
});

test("a picked place goes in past the budget and the stop cap; only a closed one is reported", () => {
  const far = planDetour({ originIdx: 0, destIdx: 1, startMin: 540, budgetMin: 10, stops, travelMin, requiredIds: [5] });
  expect(far.order.map((s) => s.id)).toContain(5);
  expect(far.unfitRequired).toEqual([]);
  expect(far.extraMin).toBeGreaterThan(10);
  const capped = planDetour({ originIdx: 0, destIdx: 1, startMin: 540, budgetMin: 120, stops, travelMin, requiredIds: [2, 3], maxStops: 1 });
  expect(capped.order.map((s) => s.id).sort()).toEqual([2, 3]);
  const closed = planDetour({ originIdx: 0, destIdx: 1, startMin: 540, budgetMin: 120, travelMin, requiredIds: [5],
    stops: stops.map((s) => s.id === 5 ? { ...s, openMin: 0, closeMin: 60 } : s) });
  expect(closed.order.map((s) => s.id)).not.toContain(5);
  expect(closed.unfitRequired).toEqual([5]);
});

// landmark world: a cafe right on the route vs a landmark temple well off it
const ptsL = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 10 }];
const travelL = (a: number, b: number) => Math.abs(ptsL[a].x - ptsL[b].x) + Math.abs(ptsL[a].y - ptsL[b].y);
const lmStops: Stop[] = [
  { idx: 2, id: 200, category: "cafe", rating: null, dwellMin: 25, tier: 1, local: true },
  { idx: 3, id: 300, category: "temple", rating: null, dwellMin: 20, tier: 3 },   // adds 20 travel + 20 visit
];

test("a landmark well off the route beats the cafe on it, inside the budget", () => {
  const p = planDetour({ originIdx: 0, destIdx: 1, startMin: 600, budgetMin: 45, stops: lmStops, travelMin: travelL, maxStops: 1, allowUnrated: true });
  expect(p.order.map((s) => s.id)).toEqual([300]);
  expect(p.extraMin).toBeLessThanOrEqual(45);
});

test("Local gems never picks a landmark; a tight budget never goes over", () => {
  const p = planDetour({ originIdx: 0, destIdx: 1, startMin: 600, budgetMin: 120, stops: lmStops, travelMin: travelL, theme: "local", allowUnrated: true });
  expect(p.order.map((s) => s.id)).toEqual([200]);
  const tight = planDetour({ originIdx: 0, destIdx: 1, startMin: 600, budgetMin: 15, stops: lmStops, travelMin: travelL, allowUnrated: true });
  expect(tight.order).toEqual([]);
});

// a 100-minute drive along x; 10 strong places bunched at the start, one decent place in each later stretch
const line = (x: number) => ({ x, y: 1 });
const along = [{ x: 0, y: 0 }, { x: 100, y: 0 },
  ...[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5].map(line), ...[30, 50, 70, 90].map(line)];
const alongMin = (a: number, b: number) => Math.abs(along[a].x - along[b].x) + Math.abs(along[a].y - along[b].y);
const KINDS = ["temple", "museum", "park", "cafe", "viewpoint", "art", "market", "craft", "food", "temple", "temple", "park", "museum", "viewpoint"];
const alongStops: Stop[] = along.slice(2).map((p, i) => ({
  idx: i + 2, id: i + 2, category: KINDS[i], rating: i < 10 ? 4.8 : 4.4, dwellMin: 8, frac: p.x / 100,
}));
const spreadPlan = (segments?: number) => planDetour({ originIdx: 0, destIdx: 1, startMin: 540, budgetMin: 50,
  stops: alongStops, travelMin: alongMin, segments });
const stretches = (order: Stop[]) => new Set(order.map((s) => Math.min(4, Math.floor((s.frac ?? 0) * 5)))).size;

test("without spreading, stops bunch at the start (the bug)", () => {
  expect(stretches(spreadPlan().order)).toBe(1);
});

test("stops spread out along the route instead of bunching at one end", () => {
  const p = spreadPlan(5);
  expect(stretches(p.order)).toBeGreaterThanOrEqual(3);
  expect(p.extraMin).toBeLessThanOrEqual(50);
});

// local first: OTOP / community / independent places, free and published boost (never paid)
const lpts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 1 }, { x: 5, y: -1 }, { x: 3, y: 1 }, { x: 7, y: -1 }];
const lMin = (a: number, b: number) => Math.abs(lpts[a].x - lpts[b].x) + Math.abs(lpts[a].y - lpts[b].y);
const lStops: Stop[] = [
  { idx: 2, id: 2, category: "cafe", rating: 4.5, dwellMin: 15 },
  { idx: 3, id: 3, category: "craft", rating: 4.5, dwellMin: 15, otop: true },
  { idx: 4, id: 4, category: "temple", rating: 4.8, dwellMin: 15 },
  { idx: 5, id: 5, category: "temple", rating: 4.9, dwellMin: 15, tier: 3 },
];
const lPlan = (budgetMin: number, maxStops?: number, stops = lStops) =>
  planDetour({ originIdx: 0, destIdx: 1, startMin: 540, budgetMin, stops, travelMin: lMin, maxStops });

test("an OTOP shop beats an equally good, equally close café", () => {
  expect(lPlan(19, 1, lStops.slice(0, 2)).order.map((s) => s.id)).toEqual([3]);
});

test("a plan makes room for one local stop when it fits, and never breaks the budget for it", () => {
  const roomy = lPlan(60);
  expect(roomy.order.some((s) => s.otop || s.community || s.local)).toBe(true);
  expect(roomy.extraMin).toBeLessThanOrEqual(60);
  const tight = lPlan(18, 1);   // only one stop fits: the landmark may win, and that's fine
  expect(tight.extraMin).toBeLessThanOrEqual(18);
});

test("insertionCost: cheapest slot plus dwell, and the saving for a stop already in the route", () => {
  // points on a line: 0 origin at km 0, 1 dest at km 10, 2 at km 5 on the way, 3 at km 5 but 2 km off the road
  const pos: Record<number, [number, number]> = { 0: [0, 0], 1: [10, 0], 2: [5, 0], 3: [5, 2] };
  const tm = (a: number, b: number) => Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]);
  expect(insertionCost([], 2, tm, 10)).toBeCloseTo(10);          // on the way: no extra road
  expect(insertionCost([2], 3, tm, 0)).toBeCloseTo(2 + Math.hypot(5, 2) - 5);   // next to stop 2, either side
  expect(insertionCost([2, 3], 3, tm, 15)).toBeCloseTo(Math.hypot(0, 2) + Math.hypot(5, 2) - 5 + 15);
});

test("fitsInterests: only the picked kinds, landmarks by tier; independent: chains out, sights in", () => {
  expect(fitsInterests([], "temple")).toBe(true);
  expect(fitsInterests(["cafes"], "cafe")).toBe(true);
  expect(fitsInterests(["cafes"], "temple")).toBe(false);
  expect(fitsInterests(["landmarks"], "park", 3)).toBe(true);
  expect(fitsInterests(["landmarks"], "park", 2)).toBe(false);
  expect(independent({ category: "cafe", local: false })).toBe(false);
  expect(independent({ category: "cafe", local: true })).toBe(true);
  expect(independent({ category: "temple" })).toBe(true);
});

test("insertBest adds a pit stop at its cheapest place, only when the budget still has room", () => {
  const base = planDetour({ originIdx: 0, destIdx: 1, startMin: 540, budgetMin: 20, stops: [stops[2]], travelMin });   // café on the route
  const pit: Stop = { idx: 6, id: 99, category: "shop", rating: null, dwellMin: 5 };   // point 6 sits on the straight road
  const withPit = insertBest(base, pit, travelMin, 20)!;
  expect(withPit.order.map((s) => s.id)).toEqual([4, 99]);   // after the café, before the destination
  expect(withPit.extraMin).toBe(base.extraMin + 5);           // no extra driving, 5 minutes there
  expect(insertBest(base, pit, travelMin, base.extraMin + 4)).toBeNull();   // 4 spare minutes: doesn't fit
});

test("a boost puts a place ahead of an equally good one (members' partners first)", () => {
  // the park (3) and the café on the route (4) both fit a 12-minute budget, but not together; without a boost the park wins
  const base = planDetour({ originIdx: 0, destIdx: 1, startMin: 540, budgetMin: 12, stops: stops.filter((s) => s.id === 3 || s.id === 4), travelMin });
  const boosted = planDetour({ originIdx: 0, destIdx: 1, startMin: 540, budgetMin: 12, stops: stops.filter((s) => s.id === 3 || s.id === 4), travelMin,
    boost: (id) => id === 4 ? 2 : 1 });
  expect(base.order.map((s) => s.id)).not.toEqual(boosted.order.map((s) => s.id));
  expect(boosted.order.map((s) => s.id)).toContain(4);
});
