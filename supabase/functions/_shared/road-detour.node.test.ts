import { test } from "node:test";
import assert from "node:assert/strict";
import { allowsEstimateFallback, boundedRouter, scheduleStops, verifyRoadPlan, visitIsOpen } from "./road-detour.ts";
import { planDetour, type Plan, type Stop } from "./planner.ts";
import { createRouter, decodePolyline6, type RoadRoute } from "./valhalla.ts";

const origin = { lat: 16.44, lng: 102.83 }, dest = { lat: 17.16, lng: 104.15 };
const baseline: RoadRoute = { geometry: [[102.83, 16.44], [103, 16.5], [104.15, 17.16]], legMin: [20], travelMin: 20 };
const stop = (id: number, category = "park"): Stop => ({ idx: id + 1, id, category, rating: 4.5, dwellMin: 10 });
const proposal = (order: Stop[]): Plan => ({ order, baseMin: 20, totalMin: 20, extraMin: 0, mealOf: new Map(), lateMeals: new Map(), missedMeals: [], requiredIds: [], unfitRequired: [], closedPicks: [] });
const candidates = [{ lat: 16.5, lng: 103 }, { lat: 16.6, lng: 103.2 }];
const run = (plan: Plan, route: (points: typeof origin[]) => Promise<RoadRoute>, budgetMin = 45) =>
  verifyRoadPlan({ plan, route, origin, dest, candidates, mode: "auto", baseline, startMin: 700, budgetMin });

test("direct trips preserve verified geometry without another provider call", async () => {
  const p = await run(proposal([]), async () => { throw Error("must not call"); });
  assert.deepEqual(p.geometry, baseline.geometry); assert.equal(p.plan.extraMin, 0);
});
test("road travel plus dwell, not proposal estimates, enforce the hard budget", async () => {
  const p = await run(proposal([stop(1)]), async (points) => {
    assert.deepEqual(points.at(-1), dest);
    return { geometry: points.map((p) => [p.lng, p.lat]), legMin: [30, 30], travelMin: 60 };
  }, 30);
  assert.equal(p.plan.order.length, 0); assert.ok(p.plan.extraMin <= 30); assert.equal(p.adjusted, true);
});
test("meal waits count in duration and ETA", () => {
  const p = scheduleStops([stop(1, "food")], [10, 20], 660, new Map([[1, "lunch"]]));
  assert.deepEqual(p.etaMin, [690]); assert.equal(p.totalMin, 60); assert.equal(p.failed, -1);
});
test("trimming preserves meal stops where they fit and keeps destination", async () => {
  const food = { ...stop(2, "food"), dwellMin: 15 };
  const plan = { ...proposal([stop(1), food]), mealOf: new Map([[2, "lunch"]] as const) };
  const p = await run(plan, async (points) => ({ geometry: points.map((p) => [p.lng, p.lat]),
    legMin: points.length === 4 ? [10, 10, 20] : [10, 20], travelMin: points.length === 4 ? 40 : 30 }), 40);
  assert.deepEqual(p.plan.order.map((s) => s.id), [2]); assert.equal(p.plan.mealOf.get(2), "lunch");
  assert.deepEqual(p.geometry.at(-1), [dest.lng, dest.lat]); assert.equal(p.plan.extraMin, 25);
});
test("failed candidate routing retains real baseline and reports lost meals", async () => {
  const plan = { ...proposal([stop(1, "food")]), mealOf: new Map([[1, "lunch"]] as const) };
  const p = await run(plan, async () => { throw Error("timeout"); });
  assert.equal(p.failed, true); assert.deepEqual(p.geometry, baseline.geometry);
  assert.deepEqual(p.plan.missedMeals, ["lunch"]);
});
test("only short pedestrian trips permit an explicitly approximate fallback", () => {
  assert.equal(allowsEstimateFallback("pedestrian", 9999), true);
  assert.equal(allowsEstimateFallback("pedestrian", 10001), false);
  assert.equal(allowsEstimateFallback("auto", 100), false);
});
test("shared provider cache and cap apply across all themes", async () => {
  let calls = 0;
  const cache = boundedRouter(async () => { calls++; return baseline; }, 2);
  await Promise.all([cache.route([origin, dest], "auto"), cache.route([origin, dest], "auto")]);
  assert.equal(calls, 1);
  await cache.route([origin, ...candidates, dest], "auto");
  await assert.rejects(cache.route([dest, origin], "auto"));
  assert.equal(calls, 2); assert.equal(cache.calls(), 2);
});
test("shared theme scoring produces food/nature alternatives without paid placement", () => {
  const args = { originIdx: 0, destIdx: 1, startMin: 600, budgetMin: 15,
    stops: [stop(1, "park"), stop(2, "food")], travelMin: (a: number, b: number) => a === b ? 0 : 5 };
  assert.equal(planDetour({ ...args, theme: "nature" }).order[0].id, 1);
  assert.equal(planDetour({ ...args, theme: "food" }).order[0].id, 2);
});
test("closed visits and malformed leg durations fail verification", () => {
  assert.equal(scheduleStops([{ ...stop(1), openMin: 100, closeMin: 200 }], [10, 20], 600, new Map()).failed, 0);
  assert.equal(scheduleStops([stop(1)], [Infinity, 20], 600, new Map()).failed, 0);
  assert.equal(visitIsOpen(1500, 30, 1320, 120), true);
});
test("routing outages reject without manufacturing a road line", async () => {
  const route = createRouter("https://example.invalid", async () => new Response("down", { status: 503 }));
  await assert.rejects(route([origin, dest], "auto")); assert.throws(() => decodePolyline6("_"));
});
test("valid road provider response preserves leg times and encoded geometry", async () => {
  const route = createRouter("https://example.invalid/", async (url, options) => {
    assert.equal(url, "https://example.invalid/route");
    assert.equal(JSON.parse(options!.body as string).locations.at(-1).lon, dest.lng);
    return Response.json({ trip: { status: 0, legs: [{ summary: { time: 120 }, shape: "??_ibE_ibE" }] } });
  });
  const p = await route([origin, dest], "auto"); assert.equal(p.travelMin, 2); assert.equal(p.geometry.length, 2);
});
test("a routing failure on a long route drops one stop and retries instead of emptying the plan", async () => {
  const p = await run(proposal([stop(1), stop(2)]), async (points) => {
    if (points.length > 3) throw Error("timeout");   // origin + 2 stops + dest fails, 1 stop works
    return { geometry: points.map((x) => [x.lng, x.lat]), legMin: [12, 12], travelMin: 24 };
  });
  assert.equal(p.plan.order.length, 1); assert.equal(p.failed, false); assert.equal(p.adjusted, true);
});

test("the user's picks stay even when the real road takes the trip past the budget", async () => {
  const picks = { ...proposal([stop(1), stop(2)]), requiredIds: [1] };
  // 30 min each way: way over a 45-minute budget with both stops
  const p = await run(picks, async (points) => ({ geometry: baseline.geometry, legMin: points.slice(1).map(() => 30), travelMin: 30 * (points.length - 1) }));
  assert.deepEqual(p.plan.order.map((s) => s.id), [1]);   // the planner's own stop goes, the pick stays
  assert.ok(p.plan.extraMin > 45);
  assert.deepEqual(p.plan.unfitRequired, []);
});

test("a pick the user added although it's closed then stays in on the real road", async () => {
  const shut = { ...stop(1), openMin: 0, closeMin: 60 };
  const p = await run({ ...proposal([shut]), requiredIds: [1], closedPicks: [1] },
    async (points) => ({ geometry: baseline.geometry, legMin: points.slice(1).map(() => 10), travelMin: 10 * (points.length - 1) }));
  assert.deepEqual(p.plan.order.map((s) => s.id), [1]);
});
