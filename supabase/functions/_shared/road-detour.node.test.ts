import { test } from "node:test";
import assert from "node:assert/strict";
import { planRoadDetour, visitIsOpen, type RoadStop } from "./road-detour.ts";
import { createRouter, decodePolyline6, type LatLng, type RoadRoute } from "./valhalla.ts";

const origin = { lat: 16.44, lng: 102.83 }, dest = { lat: 17.16, lng: 104.15 };
const baseline: RoadRoute = { geometry: [[102.83, 16.44], [103, 16.5], [104.15, 17.16]], legMin: [200], travelMin: 200 };
const stop = (id: number, partner = false): RoadStop & { is_partner: boolean; bid_thb: number } => ({
  id, lat: 16.5 + id / 100, lng: 103 + id / 100, rating: 4.5, category: `category-${id}`,
  dwell_min: 10, is_partner: partner, bid_thb: partner ? 12 : 0, progress: id / 10, open_min: null, close_min: null,
});
const mockRoute = async (points: LatLng[]): Promise<RoadRoute> => ({
  geometry: points.map((p) => [p.lng, p.lat]),
  travelMin: 200 + (points.length - 2) * 4,
  legMin: Array(points.length - 1).fill((200 + (points.length - 2) * 4) / (points.length - 1)),
});
const run = (candidates: RoadStop[], budgetMin = 45, route = mockRoute) =>
  planRoadDetour({ origin, dest, mode: "auto", startMin: 600, budgetMin, baseline, candidates, route });

test("zero budget and empty coverage preserve the real direct road route", async () => {
  for (const p of [await run([stop(1)], 0), await run([])]) {
    assert.deepEqual(p.road, baseline); assert.equal(p.extraMin, 0); assert.equal(p.calls, 0);
  }
});
test("keeps the actual destination and includes dwell in the hard budget", async () => {
  const p = await run([stop(1), stop(2), stop(3, true)], 30);
  assert.equal(p.order.length, 2); assert.ok(p.extraMin <= 30);
  assert.deepEqual(p.road.geometry.at(-1), [dest.lng, dest.lat]);
  assert.equal(p.totalMin, p.road.travelMin + 20);
});
test("partner status and fees never affect quality ranking", async () => {
  const candidates = [stop(1), stop(2), stop(3), stop(4)];
  const a = await run(candidates, 60);
  const b = await run(candidates.map((s) => ({ ...s, is_partner: true, bid_thb: 99999 })), 60);
  assert.deepEqual(a.order.map((s) => s.id), b.order.map((s) => s.id));
});
test("candidate provider outages preserve verified geometry, never a straight-line estimate", async () => {
  const p = await run([stop(1)], 45, async () => { throw Error("timeout"); });
  assert.equal(p.failures, 1); assert.deepEqual(p.road, baseline); assert.equal(p.order.length, 0);
});
test("over-budget candidates and closed visits are rejected", async () => {
  const closed = { ...stop(1), open_min: 60, close_min: 120 };
  assert.equal((await run([closed])).order.length, 0);
  assert.equal((await run([stop(1)], 13)).order.length, 0);
});
test("overnight visits and multi-day arrivals use local clock hours", () => {
  assert.equal(visitIsOpen(1500, 30, 1320, 120), true);
  assert.equal(visitIsOpen(1550, 30, 1320, 120), false);
  assert.equal(visitIsOpen(2040, 30, 540, 1080), true);
});
test("provider work and concurrency stay bounded with large candidate input", async () => {
  let active = 0, peak = 0;
  const p = await run(Array.from({ length: 1000 }, (_, i) => stop(i + 1, i > 499)), 120, async (points) => {
    active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 1)); active--;
    return mockRoute(points);
  });
  assert.ok(p.calls <= 13); assert.ok(peak <= 2); assert.ok(p.order.length <= 3);
});
test("routing outages reject instead of manufacturing geometry", async () => {
  const route = createRouter("https://example.invalid", async () => new Response("down", { status: 503 }));
  await assert.rejects(route([origin, dest], "auto"));
  assert.throws(() => decodePolyline6("_"));
});
test("valid provider legs yield road geometry and use route rather than matrix API", async () => {
  const route = createRouter("https://example.invalid/", async (url, options) => {
    assert.equal(url, "https://example.invalid/route");
    const body = JSON.parse(options!.body as string);
    assert.equal(body.locations.at(-1).lon, dest.lng); assert.equal(body.costing, "auto");
    return Response.json({ trip: { status: 0, legs: [{ summary: { time: 120 }, shape: "??_ibE_ibE" }] } });
  });
  const p = await route([origin, dest], "auto");
  assert.equal(p.travelMin, 2); assert.equal(p.geometry.length, 2);
});
