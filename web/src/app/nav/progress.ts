import type { NavRoute } from "../../lib/api";

export interface Progress {
  index: number;        // route segment you're on (shape index of its start)
  alongM: number;       // metres travelled along the route
  offM: number;         // metres between you and the route
  remainingM: number;
  next: number | null;  // index into route.maneuvers of the next one ahead
  toNextM: number;      // metres to it
  point: [number, number];   // you, snapped onto the route [lng, lat]
}

const M_PER_DEG = 111_320;

/** Metres between two points (equirectangular: fine at city distances). */
export const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot((b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180), b.lat - a.lat) * M_PER_DEG;
/** Cumulative metres along the shape (equirectangular: fine for routes in one country). */
export function cumulative(shape: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < shape.length; i++) {
    const [x1, y1] = shape[i - 1], [x2, y2] = shape[i];
    const k = Math.cos(((y1 + y2) / 2) * Math.PI / 180);
    out.push(out[i - 1] + Math.hypot((x2 - x1) * k, y2 - y1) * M_PER_DEG);
  }
  return out;
}

/** Where you are on the route. Searches from `from` onwards first (you rarely go backwards), then the whole route. */
export function progress(route: NavRoute, cum: number[], pos: { lat: number; lng: number }, from = 0): Progress {
  const k = Math.cos(pos.lat * Math.PI / 180);
  const best = { i: 0, t: 0, d: Infinity };
  const scan = (a: number, b: number) => {
    for (let i = a; i < b; i++) {
      const [x1, y1] = route.shape[i], [x2, y2] = route.shape[i + 1];
      const dx = (x2 - x1) * k, dy = y2 - y1, px = (pos.lng - x1) * k, py = pos.lat - y1;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const d = Math.hypot(px - t * dx, py - t * dy) * M_PER_DEG;
      if (d < best.d) Object.assign(best, { i, t, d });
    }
  };
  scan(Math.max(0, from - 2), Math.min(route.shape.length - 1, from + 300));
  if (best.d > 80) scan(0, route.shape.length - 1);
  const along = cum[best.i] + (cum[best.i + 1] - cum[best.i]) * best.t;
  const next = route.maneuvers.findIndex((m) => cum[m.begin] > along + 3);
  const [x1, y1] = route.shape[best.i], [x2, y2] = route.shape[Math.min(best.i + 1, route.shape.length - 1)];
  return {
    index: best.i, alongM: along, offM: best.d, remainingM: Math.max(0, cum[cum.length - 1] - along),
    next: next < 0 ? null : next, toNextM: next < 0 ? 0 : cum[route.maneuvers[next].begin] - along,
    point: [x1 + (x2 - x1) * best.t, y1 + (y2 - y1) * best.t],
  };
}

/**
 * Which announcement is due `toNextM` metres before a turn, given thresholds like [800, 200, 0] (far, near, now).
 * Each call has its own band; a far call needs room before the near band (×1.5) so they don't come back to back.
 */
export function dueCall(calls: number[], toNextM: number): number | null {
  const top = (d: number) => d + (d === 0 ? 25 : 30);
  for (let i = 0; i < calls.length; i++) {
    const lower = i === calls.length - 1 ? -Infinity : i === calls.length - 2 ? top(calls[i + 1]) : calls[i + 1] * 1.5 + 30;
    if (toNextM <= top(calls[i]) && toNextM > lower) return calls[i];
  }
  return null;
}
