import type { LatLng } from "./api";

// Demo mode: the app's location is wherever you put it (directions' Demo button drives you to the next stop), so it can be
// shown anywhere. It stands in for navigator.geolocation itself, so everything that reads the location (stops near
// you, check-in, turn-by-turn) follows it without knowing. Check-ins made with it are marked demo on the server.
const ON = "gm-demo", AT = "gm-demo-at";
const SAKON: LatLng = { lat: 17.163, lng: 104.149 };
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not remembered */ } };

let on = read<boolean>(ON, false);
let at = read<LatLng>(AT, SAKON);
const watchers = new Map<number, PositionCallback>();
const listeners = new Set<() => void>();
let nextId = 1e6;   // clear of the real watch ids

const position = (): GeolocationPosition => ({
  coords: { latitude: at.lat, longitude: at.lng, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null,
    toJSON() { return this; } } as GeolocationCoordinates,
  timestamp: Date.now(), toJSON() { return this; },
} as GeolocationPosition);

export const demoOn = () => on;
export const demoAt = () => at;
export const onDemoChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const changed = () => listeners.forEach((f) => f());

export function setDemo(value: boolean) {
  on = value; write(ON, value);
  if (!value) try { localStorage.removeItem("gm-demo-bar-hidden"); } catch { /* nothing to show again */ }   // next time demo mode is on, its note shows again
  changed();
}
/** Move yourself there; everything watching the location gets a fix straight away. */
export function moveTo(p: LatLng) {
  at = p; write(AT, p);
  const pos = position();
  watchers.forEach((cb) => cb(pos));
  changed();
}

/** Swap navigator.geolocation for the demo location while demo mode is on (once, at start-up). */
export function installDemoGps() {
  const geo = navigator.geolocation;
  if (!geo) return;
  const real = { get: geo.getCurrentPosition.bind(geo), watch: geo.watchPosition.bind(geo), clear: geo.clearWatch.bind(geo) };
  geo.getCurrentPosition = (ok, fail, opts) => on ? void setTimeout(() => ok(position()), 150) : real.get(ok, fail, opts);
  geo.watchPosition = (ok, fail, opts) => {
    if (!on) return real.watch(ok, fail, opts);
    const id = nextId++;
    watchers.set(id, ok);
    setTimeout(() => watchers.has(id) && ok(position()), 150);
    return id;
  };
  geo.clearWatch = (id) => { if (watchers.delete(id)) return; real.clear(id); };
}
