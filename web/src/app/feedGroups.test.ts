import { expect, test } from "bun:test";
import type { FeedItem } from "../lib/api";
import { groupFeed } from "./feedGroups";

const item = (id: number, who: string, at: string, kind: FeedItem["kind"] = "stamp") =>
  ({ id, kind, at, who: { id: who }, mine: false, data: {}, reactions: {} }) as unknown as FeedItem;

test("a person's stamps on one Bangkok day merge into one card", () => {
  const g = groupFeed([item(5, "a", "2026-10-24T10:00:00Z"), item(4, "a", "2026-10-24T03:00:00Z"), item(3, "a", "2026-10-23T18:00:00Z")]);
  expect(g.map((x) => x.items.map((i) => i.id))).toEqual([[5, 4, 3]]);   // 18:00 UTC on the 23rd is 01:00 on the 24th in Bangkok
});

test("other people's and other days' stamps get their own cards; badges in between stay single", () => {
  const g = groupFeed([item(6, "a", "2026-10-24T10:00:00Z"), item(5, "b", "2026-10-24T09:00:00Z"), item(4, "b", "2026-10-24T08:00:00Z", "badge"),
    item(3, "b", "2026-10-24T07:00:00Z"), item(2, "b", "2026-10-23T10:00:00Z")]);
  expect(g.map((x) => x.items.map((i) => i.id))).toEqual([[6], [5, 3], [4], [2]]);
});
