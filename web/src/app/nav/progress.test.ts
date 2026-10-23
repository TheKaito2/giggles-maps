import { expect, test } from "bun:test";
import { cumulative, progress, dueCall } from "./progress";
import { say } from "./thai";

// 2 km due east along 17°N, then 1 km north; a turn at the corner
const route = {
  shape: [[104, 17], [104.01, 17], [104.0188, 17], [104.0188, 17.009]] as [number, number][],
  maneuvers: [
    { type: 1, instruction: "Drive east.", verbal: null, street: null, lengthM: 1880, timeS: 120, begin: 0, leg: 0 },
    { type: 15, instruction: "Turn left onto ถนนสกล.", verbal: null, street: "ถนนสกล", lengthM: 1000, timeS: 60, begin: 2, leg: 0 },
    { type: 4, instruction: "You have arrived.", verbal: null, street: null, lengthM: 0, timeS: 0, begin: 3, leg: 0 },
  ],
  distanceM: 2880, timeS: 180, legEnds: [3],
};
const cum = cumulative(route.shape);

test("snaps you to the route and finds the next turn", () => {
  const p = progress(route, cum, { lat: 17.0003, lng: 104.005 });   // ~33 m north of the road, 530 m in
  expect(p.offM).toBeGreaterThan(25); expect(p.offM).toBeLessThan(40);
  expect(p.next).toBe(1);
  expect(Math.round(p.toNextM / 10)).toBe(Math.round((cum[2] - p.alongM) / 10));
  expect(p.remainingM).toBeGreaterThan(2200);
});

test("past the corner, the next maneuver is the arrival; far away counts as off route", () => {
  const p = progress(route, cum, { lat: 17.004, lng: 104.0188 });
  expect(p.next).toBe(2);
  expect(progress(route, cum, { lat: 17.05, lng: 104.0 }).offM).toBeGreaterThan(1000);
});

test("voice in Thai and English", () => {
  expect(say(route.maneuvers[1], 200, "th")).toBe("อีก 200 เมตร เลี้ยวซ้าย เข้าสู่ ถนนสกล");
  expect(say(route.maneuvers[1], 10, "th")).toBe("เลี้ยวซ้าย เข้าสู่ ถนนสกล");
  expect(say(route.maneuvers[1], 800, "en")).toBe("In 800 metres, turn left onto ถนนสกล");
});

test("dueCall: far, near and now bands, with a gap between far and near", () => {
  const auto = [800, 200, 0];
  expect(dueCall(auto, 900)).toBeNull();
  expect(dueCall(auto, 820)).toBe(800);
  expect(dueCall(auto, 331)).toBe(800);
  expect(dueCall(auto, 280)).toBeNull();
  expect(dueCall(auto, 210)).toBe(200);
  expect(dueCall(auto, 26)).toBe(200);
  expect(dueCall(auto, 20)).toBe(0);
  expect(dueCall(auto, 0)).toBe(0);
  expect(dueCall([150, 40, 0], 60)).toBe(40);
});
