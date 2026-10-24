import { expect, test } from "bun:test";
import { usualHours } from "./usual-hours.ts";

test("known hours win; unknown ones fall back to the usual hours for the kind", () => {
  expect(usualHours("temple", "Wat Phra That Choeng Chum", 480, 1020)).toEqual([480, 1020]);
  expect(usualHours("temple", "Wat Phra That Choeng Chum", null, null)).toEqual([360, 1080]);
  expect(usualHours("market", "Sakon Nakhon Walking Street, Saturday & Sunday Nights", null, null)).toEqual([1020, 1380]);
  expect(usualHours("market", "ถนนคนเดินสกลนคร", null, null)).toEqual([1020, 1380]);
  expect(usualHours("stay", "Hotel", null, null)).toEqual([null, null]);
});
