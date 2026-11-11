import { expect, test } from "bun:test";
import { corridorMatrix } from "./corridor.ts";
import { type LatLng, matrixMinutes, type RoadRoute } from "./valhalla.ts";

// a fake matrix provider that counts its calls and pairs; minutes = 1 + source index * 10 + target index (by position)
function provider(points: LatLng[]) {
  const id = (p: LatLng) => points.findIndex((q) => q.lat === p.lat && q.lng === p.lng);
  const stats = { calls: 0, pairs: 0 };
  const fetchPairs = async (s: LatLng[], t: LatLng[]) => {
    stats.calls++; stats.pairs += s.length * t.length;
    return s.map((a) => t.map((b) => 1 + id(a) * 10 + id(b)));
  };
  return { stats, fetchPairs };
}
const pts = (n: number) => Array.from({ length: n }, (_, k) => ({ lat: 17 + k * 0.001, lng: 104 + k * 0.001 }));

test("short-trip matrix: a second request with the same places makes no calls", async () => {
  const points = pts(8), { stats, fetchPairs } = provider(points), cache = new Map<string, number>();
  const first = await matrixMinutes(points, "auto", fetchPairs, cache);
  expect(first[2][5]).toBe(1 + 20 + 5);
  expect(first[3][3]).toBe(0);
  const calls = stats.calls;
  const again = await matrixMinutes(points, "auto", fetchPairs, cache);
  expect(stats.calls).toBe(calls);
  expect(again).toEqual(first);
});

test("short-trip matrix: one new place fetches only its row and column", async () => {
  const all = pts(9), { stats, fetchPairs } = provider(all), cache = new Map<string, number>();
  await matrixMinutes(all.slice(0, 8), "auto", fetchPairs, cache);
  stats.pairs = 0; stats.calls = 0;
  const m = await matrixMinutes(all, "auto", fetchPairs, cache);
  expect(stats.calls).toBe(2);           // the new row, then the old rows to the new place
  expect(stats.pairs).toBe(9 + 8);       // not 81
  expect(m[8][1]).toBe(1 + 80 + 1);
  expect(m[1][8]).toBe(1 + 10 + 8);
});

test("long-trip corridor matrix: road times already fetched aren't asked again", async () => {
  const route: RoadRoute = { geometry: Array.from({ length: 101 }, (_, k) => [100 + k * 0.009, 14] as [number, number]), legMin: [60], travelMin: 60 };
  const points = [{ lat: 14, lng: 100 }, { lat: 14, lng: 100.9 }, { lat: 14.09, lng: 100.45 }, { lat: 14, lng: 100.45 }, { lat: 14.02, lng: 100.6 }];
  let calls = 0;
  const fetchPairs = async (s: LatLng[], t: LatLng[]) => { calls++; return s.map(() => t.map(() => 7)); };
  const cache = new Map<string, number>();
  const first = await corridorMatrix(points, route, "auto", fetchPairs, cache);
  expect(calls).toBeGreaterThan(0);
  const before = calls;
  const again = await corridorMatrix(points, route, "auto", fetchPairs, cache);
  expect(calls).toBe(before);
  expect(again.matrix).toEqual(first.matrix);
});
