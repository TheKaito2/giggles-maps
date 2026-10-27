import { expect, test } from "bun:test";
import { fuelLine } from "./prefs";

test("fuel cost: driving only, rounded to ฿5, hidden under 1 km", () => {
  expect(fuelLine("auto", 12)).toBe("+12 km · ≈ ฿30 fuel");   // 12 / 14 x 35 = 30
  expect(fuelLine("auto", 18.4)).toBe("+18 km · ≈ ฿45 fuel");   // 46 -> 45
  expect(fuelLine("auto", 0.9)).toBeNull();
  expect(fuelLine("auto", undefined)).toBeNull();
  expect(fuelLine("pedestrian", 12)).toBeNull();
});
