import { expect, test } from "bun:test";
import { bookingLinks } from "./affiliate";

test("booking links: provider search for the destination, with the affiliate ids", () => {
  const l = bookingLinks("Wat Phra That Choeng Chum", { agoda: "1234", klook: "99" })!;
  expect(l.hotels).toBe("https://www.agoda.com/search?cid=1234&textToSearch=Wat+Phra+That+Choeng+Chum");
  expect(l.activities).toBe("https://www.klook.com/search/result/?query=Wat+Phra+That+Choeng+Chum&aid=99");
});

test("booking links: hidden when an id or the name is missing", () => {
  expect(bookingLinks("Sakon Nakhon", { agoda: "1234" })).toBeNull();
  expect(bookingLinks("Sakon Nakhon", { klook: "99" })).toBeNull();
  expect(bookingLinks("Sakon Nakhon", { agoda: "", klook: "" })).toBeNull();
  expect(bookingLinks(" ", { agoda: "1", klook: "2" })).toBeNull();
});
