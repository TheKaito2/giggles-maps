import { expect, test } from "bun:test";
import { planDetour, type Stop } from "./planner.ts";
import { mixWeight } from "./themes.ts";

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
  { idx: 2, id: 20, category: "cafe", rating: 4.2, dwellMin: 20 },
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

test("a meal that can't fit is reported, not forced", () => {
  const p = planDetour({ originIdx: 0, destIdx: 1, startMin: 9 * 60, budgetMin: 60, stops: two,
                         travelMin: travel2, meals: ["dinner"] });
  expect(p.missedMeals).toEqual(["dinner"]);
  expect([...p.mealOf.values()]).not.toContain("dinner");
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
