import { expect, test } from "bun:test";
import { plannedStops, stopCap, stopLimitCode } from "./tiers.ts";

test("free plans hold 3 stops; members, Plus and demo keep 15", () => {
  expect(stopCap(false)).toBe(3);
  expect(stopCap(true)).toBe(15);
  expect(plannedStops(undefined, false)).toBe(3);   // "as many as fit" fills up to 3
  expect(plannedStops(6, false)).toBe(3);           // a saved "up to 6" is trimmed
  expect(plannedStops(2, false)).toBe(2);
  expect(plannedStops(6, true)).toBe(6);
  expect(plannedStops(undefined, true)).toBe(15);
});

test("must-visit picks past the cap are refused with a gate code", () => {
  expect(stopLimitCode(3, false)).toBeNull();
  expect(stopLimitCode(4, false)).toBe("stop_limit_free");
  expect(stopLimitCode(15, true)).toBeNull();
  expect(stopLimitCode(16, true)).toBe("stop_limit");
});
