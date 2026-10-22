import { expect, test } from "bun:test";
import { planDetour, type Stop } from "./planner.ts";

// grid world: travel minutes = manhattan distance between points
const pts = [
  { x: 0, y: 0 },  // 0 origin
  { x: 10, y: 0 }, // 1 destination
  { x: 5, y: 2 },  // 2 paid cafe (+19 min with dwell)
  { x: 5, y: 1 },  // 3 free temple
  { x: 3, y: 1 },  // 4 paid kram shop
  { x: 5, y: 0 },  // 5 low-rated shop
  { x: 6, y: 0 },  // 6 closed shop
];
const travelMin = (a: number, b: number) => Math.abs(pts[a].x - pts[b].x) + Math.abs(pts[a].y - pts[b].y);
const stops: Stop[] = [
  { idx: 2, id: 2, value: 30, rating: 4.5, dwellMin: 15 },
  { idx: 3, id: 3, value: 0, rating: 4.8, dwellMin: 20 },
  { idx: 4, id: 4, value: 20, rating: 4.2, dwellMin: 10 },
  { idx: 5, id: 5, value: 99, rating: 3.1, dwellMin: 5 },
  { idx: 6, id: 6, value: 50, rating: 4.6, dwellMin: 5, openMin: 600, closeMin: 700 },
];
const plan = (budgetMin: number) =>
  planDetour({ originIdx: 0, destIdx: 1, startMin: 540, budgetMin, stops, travelMin });

test("never exceeds the user's extra-time budget", () => {
  for (const b of [0, 5, 12, 20, 35, 60, 120]) expect(plan(b).extraMin).toBeLessThanOrEqual(b);
});

test("money first: paid stops chosen, low-rated and closed skipped", () => {
  const ids = plan(35).order.map((s) => s.id);
  expect(ids).toContain(2);
  expect(ids).toContain(4);
  expect(ids).not.toContain(5);
  expect(ids).not.toContain(6);
  expect(plan(35).expectedThb).toBe(50);
});

test("free stops only fill leftover time", () => {
  expect(plan(35).order.map((s) => s.id)).not.toContain(3);
  expect(plan(120).order.map((s) => s.id)).toContain(3);
});

test("tiny budget adds nothing", () => {
  expect(plan(5).order).toHaveLength(0);
});

test("opening hours respected when the shop is open", () => {
  const open = planDetour({ originIdx: 0, destIdx: 1, startMin: 600, budgetMin: 10, stops, travelMin });
  expect(open.order.map((s) => s.id)).toContain(6);
});
