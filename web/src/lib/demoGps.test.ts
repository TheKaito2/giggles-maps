import { expect, test } from "bun:test";

// a fake device: real GPS says Sakon city (or is blocked), storage is in memory
const SAKON = { lat: 17.16, lng: 104.15 }, CHOKCHAI = { lat: 14.62, lng: 101.53 };
let blocked = false;
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
  navigator: { geolocation: {
    getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback) => blocked
      ? fail({ code: 1, message: "denied" } as GeolocationPositionError)
      : ok({ coords: { latitude: SAKON.lat, longitude: SAKON.lng } } as GeolocationPosition),
    watchPosition: () => 1, clearWatch: () => undefined,
  } },
});
const demo = await import("./demoGps");
demo.installDemoGps();
const where = () => new Promise<{ lat: number; lng: number }>((ok, fail) =>
  demo.myLocation((p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), fail));

test("in demo mode, 'my location' brings the demo spot back to where you really are", async () => {
  demo.setDemo(true); demo.moveTo(CHOKCHAI);   // the last demo drive ended at Chokchai Farm
  expect(await where()).toEqual(SAKON);
  expect(demo.demoAt()).toEqual(SAKON);       // and the demo carries on from there
});

test("with real GPS blocked, the demo spot stays", async () => {
  blocked = true; demo.moveTo(CHOKCHAI);
  expect(await where()).toEqual(CHOKCHAI);
  blocked = false; demo.setDemo(false);
});

test("demoing Bangkok from far away: 'my location' is the demo's city, not 500 km off", async () => {
  demo.startDemo(); demo.moveTo(CHOKCHAI);    // real GPS says Sakon Nakhon
  expect(await where()).toEqual(demo.BANGKOK);
  demo.setDemo(false);
});
