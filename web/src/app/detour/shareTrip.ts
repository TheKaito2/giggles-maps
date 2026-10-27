import type { RoutePlan, TravelMode, TripSnapshot } from "../../lib/api";
import { metres } from "../nav/progress";
import type { Place } from "../prefs";

const MAX_POINTS = 600;   // = the shared_trips geometry limit
const MIN_GAP_M = 25;     // points closer than this to the last one kept add nothing at the zoom a trip page opens at

const pt = ([lng, lat]: [number, number]) => ({ lat, lng });

/** The route line made small: 5 decimals (about 1 m), points under 25 m apart dropped, then thinned evenly to 600. */
export function simplify(line: [number, number][]): [number, number][] {
  const round = ([lng, lat]: [number, number]): [number, number] => [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
  const kept: [number, number][] = [];
  for (const p of line) if (!kept.length || metres(pt(kept.at(-1)!), pt(p)) >= MIN_GAP_M) kept.push(round(p));
  const end = line.length > 1 ? round(line.at(-1)!) : null;   // always end on the destination
  if (end && kept.at(-1)!.join() !== end.join()) kept.push(end);
  if (kept.length <= MAX_POINTS) return kept;
  const step = (kept.length - 1) / (MAX_POINTS - 1);
  return Array.from({ length: MAX_POINTS }, (_, i) => kept[Math.round(i * step)]);
}

/** The trip as a public page holds it. A trip from "Your location" keeps no start point, and its line starts at the first
 *  stop, so the page never shows where the sharer was (their home, often). */
export function snapshot(plan: RoutePlan, origin: Place, dest: Place, mode: TravelMode, start: number, demo: boolean): TripSnapshot {
  const here = origin.name === "Your location";
  let line = plan.geometry;
  if (here && plan.stops.length) {
    const first = plan.stops[0];
    let best = 0;
    line.forEach((p, i) => { if (metres(pt(p), first) < metres(pt(line[best]), first)) best = i; });
    line = line.slice(best);
  }
  const geometry = simplify(line);   // no road line (or only the bit after the sharer's start): straight from stop to stop
  return {
    mode, origin_name: here ? "Start" : origin.name, origin_lat: here ? null : origin.point.lat, origin_lng: here ? null : origin.point.lng,
    dest_name: dest.name, dest_lat: dest.point.lat, dest_lng: dest.point.lng,
    stops: plan.stops.map((s) => ({ id: s.id, arrive_min: Math.max(0, Math.round(s.eta_min - start)), dwell_min: s.dwell_min })),
    extra_min: Math.max(0, Math.round(plan.extra_min)), total_min: Math.max(0, Math.round(plan.total_min)),
    geometry: geometry.length >= 2 ? geometry : [...plan.stops.map((s): [number, number] => [s.lng, s.lat]), [dest.point.lng, dest.point.lat]],
    note: null, demo,
  };
}
