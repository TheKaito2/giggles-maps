import { expect, test } from "bun:test";
import { openNow } from "./hours";

const at = (day: number, h: number, m = 0) => new Date(2026, 9, 19 + day, h, m);   // 19 Oct 2026 is a Monday

test("reads the common OSM opening_hours forms", () => {
  expect(openNow("24/7", at(6, 3))).toBe(true);
  expect(openNow("Mo-Fr 08:00-17:00", at(0, 9))).toBe(true);
  expect(openNow("Mo-Fr 08:00-17:00", at(0, 17))).toBe(false);
  expect(openNow("Mo-Fr 08:00-17:00", at(5, 10))).toBe(false);          // Saturday
  expect(openNow("Mo-Fr 08:00-17:00; Sa 09:00-12:00", at(5, 10))).toBe(true);
  expect(openNow("08:00-20:00", at(6, 19, 30))).toBe(true);
  expect(openNow("Mo-Su 10:00-14:00,16:00-20:00", at(2, 15))).toBe(false);
  expect(openNow("Mo-Su 18:00-02:00", at(3, 1))).toBe(true);           // past midnight
  expect(openNow("Mo-Sa 09:00-18:00; Su off", at(6, 12))).toBe(false);
  expect(openNow("Fr-Mo 10:00-12:00", at(6, 11))).toBe(true);          // wraps the week
});

test("unknown or odd hours are unknown, never closed", () => {
  expect(openNow(null)).toBeNull();
  expect(openNow("sunrise-sunset")).toBeNull();
  expect(openNow("Mo-Fr 08:00-17:00 \"call first\"")).toBeNull();
});
