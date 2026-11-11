import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The web app's PRICES and stripe-checkout's amounts must agree (prices v6), or the app shows one price and charges another.
const root = join(import.meta.dir, "../../..");
const web = readFileSync(join(root, "web/src/lib/api.ts"), "utf8");
const checkout = readFileSync(join(root, "supabase/functions/stripe-checkout/index.ts"), "utf8");
const num = (src: string, re: RegExp) => Number(src.match(re)?.[1]);

test("web PRICES match stripe-checkout", () => {
  const prices = web.match(/export const PRICES = \{([^}]*)\}/)?.[1] ?? "";
  const p = (k: string) => num(prices, new RegExp(`${k}: (\\d+)`));
  expect(p("tripPass")).toBe(num(checkout, /trip_pass: (\d+)/));
  expect(p("plusYear")).toBe(num(checkout, /plus_year: (\d+)/));
  expect(p("lifetime")).toBe(num(checkout, /LIFETIME_THB = (\d+)/));
  expect(p("partner")).toBe(num(checkout, /partner: (\d+)/));
  expect(p("choice")).toBe(num(checkout, /choice: (\d+)/));
  expect([p("tripPass"), p("plusYear"), p("lifetime"), p("partner"), p("choice")]).toEqual([79, 890, 2990, 990, 2490]);
});
