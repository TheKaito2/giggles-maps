import { expect, test } from "bun:test";

// Off the phone every wrapper must keep the old web behaviour.
const calls: unknown[] = [];
(globalThis as { navigator?: unknown }).navigator = { vibrate: (p: unknown) => calls.push(p) };
const native = await import("./native");

test("not native in a browser or test runner", () => expect(native.isNative).toBe(false));
test("buzz falls back to navigator.vibrate patterns", () => {
  native.buzz("shake"); native.buzz("done");
  expect(calls).toEqual([[40, 60, 40, 60, 40], 120]);
});
test("sharing reports false where the browser can't share, so callers copy or download", async () => {
  expect(await native.shareLink("t", "https://x")).toBe(false);
  expect(await native.shareFiles([new File(["x"], "a.png")])).toBe(false);
});
test("trip helpers do nothing on the web", () => {
  expect(() => { native.liveTrip.start([], "x"); native.liveTrip.checkedIn(1); native.liveTrip.end(); }).not.toThrow();
});
