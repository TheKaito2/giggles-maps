import { expect, test } from "bun:test";
import { corridorMatrix, corridorMinutes, onRoute, planCalls } from "./corridor.ts";
import { haversineM, MAX_PAIRS, type RoadRoute } from "./valhalla.ts";

// a 100 km straight road east along the equator-ish, 60 minutes end to end
const route: RoadRoute = { geometry: Array.from({ length: 101 }, (_, k) => [100 + k * 0.009, 14] as [number, number]), legMin: [60], travelMin: 60 };
const origin = { lat: 14, lng: 100 }, dest = { lat: 14, lng: 100.9 };
const offRoad = { lat: 14.09, lng: 100.45 };   // ~10 km north of the road's midpoint
const onRoad = { lat: 14, lng: 100.45 };

test("origin to destination is the direct road time; a stop off the road pays its way off and back", () => {
  const spots = onRoute([origin, dest, offRoad, onRoad], route);
  const m = corridorMinutes(spots, "auto", new Map());
  expect(m[0][1]).toBeCloseTo(60, 5);
  expect(spots[2].along).toBeCloseTo(30, 0);
  // the road stop adds ~nothing, the one 10 km away adds ~2 x 10 km x1.3 at 30 km/h = ~52 min
  expect(m[0][3] + m[3][1] - m[0][1]).toBeLessThan(1);
  expect(m[0][2] + m[2][1] - m[0][1]).toBeCloseTo((2 * spots[2].offM * 1.3) / 500, 3);
});

test("fetched road times replace the model", () => {
  const spots = onRoute([origin, dest, offRoad, onRoad], route);
  const m = corridorMinutes(spots, "auto", new Map([["2,a", 12], ["2,3", 9]]));
  expect(m[2][3]).toBe(9);
  expect(m[2][1]).toBeCloseTo(12 + 30, 0);
});

test("calls stay within the pair limit and ask each stop's way back to the road", () => {
  const points = [origin, dest, ...Array.from({ length: 22 }, (_, k) => ({ lat: 14 + (k % 3) * 0.05, lng: 100.04 + k * 0.038 }))];
  const calls = planCalls(points, onRoute(points, route));
  for (const c of calls) expect(c.sources.length * c.targets.size).toBeLessThanOrEqual(MAX_PAIRS);
  for (let i = 2; i < points.length; i++) expect(calls.some((c) => c.sources.includes(i) && c.targets.has(`a${i}`))).toBe(true);
  // neighbours asked for are near
  for (const c of calls) for (const [k, at] of c.targets) if (!k.startsWith("a")) expect(c.sources.some((i) => haversineM(points[i], at) <= 40000)).toBe(true);
});

test("a failed matrix call leaves the model; a good one is used", async () => {
  const points = [origin, dest, offRoad, onRoad];
  const failed = await corridorMatrix(points, route, "auto", async () => { throw new Error("down"); });
  expect(failed.fetched).toBe(0);
  const ok = await corridorMatrix(points, route, "auto", async (s, t) => s.map(() => t.map(() => 7)));
  expect(ok.fetched).toBeGreaterThan(0);
  expect(ok.matrix[2][3]).toBe(7);
});

test("step times put a slow city start where it belongs along the route", () => {
  // first half of the road takes 45 of the 60 minutes (a city), the second half 15 (highway)
  const vertexMin = route.geometry.map((_, k) => (k <= 50 ? (k / 50) * 45 : 45 + ((k - 50) / 50) * 15));
  const spots = onRoute([origin, dest, onRoad], { ...route, vertexMin });
  expect(spots[2].along).toBeCloseTo(45, 0);
});

test("no call pairs points further apart than the routing server allows", () => {
  // stops strung along 1,500 km: rows taken in route order must not mix far ends in one call
  const long: RoadRoute = { geometry: Array.from({ length: 301 }, (_, k) => [100, 6 + k * 0.045] as [number, number]), legMin: [1200], travelMin: 1200 };
  const points = [{ lat: 6, lng: 100 }, { lat: 19.5, lng: 100 }, ...Array.from({ length: 22 }, (_, k) => ({ lat: 6.2 + k * 0.6, lng: 100.05 }))];
  for (const [mode, limit] of [["auto", 142000], ["bicycle", 57000], ["pedestrian", 28000]] as const) {
    for (const c of planCalls(points, onRoute(points, long), mode)) for (const s of c.sources) for (const t of c.targets.values()) expect(haversineM(points[s], t)).toBeLessThanOrEqual(limit);
  }
});
