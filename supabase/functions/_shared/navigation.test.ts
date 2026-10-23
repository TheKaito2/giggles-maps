import { expect, test } from "bun:test";
import { toNavRoute } from "./navigation.ts";

// polyline6 for [[104.0,17.0],[104.001,17.0],[104.002,17.0]] and [[104.002,17.0],[104.003,17.0]]
const enc = (pts: [number, number][]) => {
  let out = "", plat = 0, plng = 0;
  const put = (v: number) => { let n = v < 0 ? ~(v << 1) : v << 1; while (n >= 0x20) { out += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; } out += String.fromCharCode(n + 63); };
  for (const [lng, lat] of pts) { const a = Math.round(lat * 1e6), b = Math.round(lng * 1e6); put(a - plat); put(b - plng); plat = a; plng = b; }
  return out;
};

test("joins legs: one shape, maneuvers re-indexed, stopover arrive/depart pairs collapsed", () => {
  const r = toNavRoute({ summary: { length: 0.32, time: 60 }, legs: [
    { shape: enc([[104, 17], [104.001, 17], [104.002, 17]]), maneuvers: [
      { type: 1, instruction: "Drive east.", begin_shape_index: 0, length: 0.2, time: 30 },
      { type: 4, instruction: "You have arrived.", begin_shape_index: 2, length: 0, time: 0 }] },
    { shape: enc([[104.002, 17], [104.003, 17]]), maneuvers: [
      { type: 1, instruction: "Drive east.", begin_shape_index: 0, length: 0.1, time: 20 },
      { type: 15, instruction: "Turn left onto ถนน.", street_names: ["ถนน"], begin_shape_index: 0, length: 0.1, time: 10 },
      { type: 4, instruction: "You have arrived.", begin_shape_index: 1, length: 0, time: 0 }] },
  ] });
  expect(r.shape.length).toBe(4);
  expect(r.maneuvers.map((m) => m.type)).toEqual([1, 15, 4]);
  expect(r.maneuvers[1]).toMatchObject({ begin: 2, street: "ถนน", lengthM: 100, leg: 1 });
  expect(r.maneuvers[2].begin).toBe(3);
  expect(r.legEnds).toEqual([2, 3]);
});
