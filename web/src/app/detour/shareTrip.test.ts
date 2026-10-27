import { expect, test } from "bun:test";
import type { RoutePlan } from "../../lib/api";
import { simplify, snapshot } from "./shareTrip";

const line = Array.from({ length: 2001 }, (_, i): [number, number] => [104.1 + i * 0.0005, 17.1]);   // ~53 m apart, 106 km

test("simplify: rounded, capped at 600 points, ends on the destination", () => {
  const s = simplify(line);
  expect(s.length).toBe(600);
  expect(s[0]).toEqual([104.1, 17.1]);
  expect(s.at(-1)).toEqual([105.1, 17.1]);
  expect(simplify([[104.1, 17.1], [104.10001, 17.1], [104.10002, 17.1]])).toEqual([[104.1, 17.1], [104.10002, 17.1]]);
});

test("snapshot from your location: no start point, line starts at the first stop", () => {
  const plan = { geometry: line, extra_min: 24.6, total_min: 80,
    stops: [{ id: 7, lat: 17.1, lng: 104.6, eta_min: 610, dwell_min: 20 }] } as unknown as RoutePlan;
  const s = snapshot(plan, { name: "Your location", point: { lat: 17.1, lng: 104.1 } }, { name: "B", point: { lat: 17.1, lng: 105.1 } }, "auto", 600, false);
  expect([s.origin_name, s.origin_lat, s.origin_lng]).toEqual(["Start", null, null]);
  expect(s.geometry[0][0]).toBeCloseTo(104.6, 3);
  expect(s.stops).toEqual([{ id: 7, arrive_min: 10, dwell_min: 20 }]);
  expect(s.extra_min).toBe(25);
  const named = snapshot(plan, { name: "Hotel", point: { lat: 17.1, lng: 104.1 } }, { name: "B", point: { lat: 17.1, lng: 105.1 } }, "auto", 600, true);
  expect([named.origin_name, named.origin_lat, named.geometry[0][0], named.demo]).toEqual(["Hotel", 17.1, 104.1, true]);
});
