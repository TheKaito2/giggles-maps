import { expect, test } from "bun:test";
import { planDetour, type Stop } from "./planner.ts";

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
