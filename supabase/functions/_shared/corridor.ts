// Travel minutes between the stops of a long trip (over 10 km), where a full road matrix is too many routing calls.
// A long leg is modelled as: drive off the route to reach a stop, along the route, and back on, so a temple 15 km
// up a country road costs its real slow-road minutes instead of highway speed (the old scaled straight line, which
// planned stops the road check then had to drop). Pairs close together, and each stop's way back to the route, get
// real road times from a few matrix calls; the rest use the model.
import { haversineM, type LatLng, MAX_PAIRS, METERS_PER_MIN, type Mode, pairsMinutes, type RoadRoute } from "./valhalla.ts";

const NEAR_M = 40000;    // stops closer than this get real road times between them
const NEIGHBOURS = 4;    // ...at most this many per stop, nearest first
const MAX_CALLS = 6;     // matrix calls per request; pairs beyond them keep the model

export interface Spot { along: number; offM: number; anchor: LatLng }

/** Where each point meets the route: `along` = road minutes from the start to its nearest route vertex (the router's
 *  step times; else its distance share of the trip, which runs city stretches too fast), `offM` = how far off the
 *  route it sits. Points 0 and 1 are the origin and destination. */
export function onRoute(points: LatLng[], route: RoadRoute): Spot[] {
  const g = route.geometry.map(([lng, lat]) => ({ lat, lng }));
  let cum = [0];
  for (let i = 1; i < g.length; i++) cum.push(cum[i - 1] + haversineM(g[i - 1], g[i]));
  let total = cum.at(-1) || 1;
  if (route.vertexMin?.length === g.length) { cum = route.vertexMin; total = cum.at(-1) || 1; }
  return points.map((p, i) => {
    if (i < 2) return { along: i * route.travelMin, offM: 0, anchor: p };
    let best = Infinity, at = 0;
    for (let k = 0; k < g.length; k++) { const d = haversineM(p, g[k]); if (d < best) { best = d; at = k; } }
    return { along: (cum[at] / total) * route.travelMin, offM: best, anchor: g[at] };
  });
}

/** The matrix: a real road time where one was fetched (`real` keys "i,j", and "i,a" for point i to its route anchor),
 *  else off the route + along it + off again. Off-route minutes: the fetched one, else straight line x1.3 at town speed. */
export function corridorMinutes(spots: Spot[], mode: Mode, real: Map<string, number>): number[][] {
  const off = spots.map((s, i) => real.get(`${i},a`) ?? (s.offM * 1.3) / METERS_PER_MIN[mode]);
  return spots.map((a, i) => spots.map((b, j) =>
    i === j ? 0 : real.get(`${i},${j}`) ?? off[i] + Math.abs(a.along - b.along) + off[j]));
}

/** Which road times to fetch, packed into calls of at most MAX_PAIRS: each stop to its route anchor and to its nearest
 *  neighbours, sources taken in route order so neighbouring rows share targets. */
export function planCalls(points: LatLng[], spots: Spot[]) {
  type Target = { key: string; at: LatLng };
  const wants = points.map((p, i) => {
    const near = points.map((q, j) => ({ j, d: haversineM(p, q) })).filter(({ j, d }) => j !== i && d <= NEAR_M)
      .sort((a, b) => a.d - b.d).slice(0, NEIGHBOURS).map(({ j }) => ({ key: `${j}`, at: points[j] }));
    return [...(i < 2 ? [] : [{ key: "a", at: spots[i].anchor }]), ...near] as Target[];
  });
  const calls: { sources: number[]; targets: Map<string, LatLng> }[] = [];
  let cur = { sources: [] as number[], targets: new Map<string, LatLng>() };
  for (const i of points.map((_, i) => i).sort((a, b) => spots[a].along - spots[b].along)) {
    if (!wants[i].length) continue;
    // an anchor target is per source ("a7"); a point target is shared ("7")
    const mine = wants[i].map((t) => ({ key: t.key === "a" ? `a${i}` : t.key, at: t.at }));
    const merged = new Map(cur.targets);
    for (const t of mine) merged.set(t.key, t.at);
    if (cur.sources.length && (cur.sources.length + 1) * merged.size > MAX_PAIRS) {
      calls.push(cur);
      cur = { sources: [], targets: new Map() };
      for (const t of mine) cur.targets.set(t.key, t.at);
    } else cur.targets = merged;
    cur.sources.push(i);
  }
  if (cur.sources.length) calls.push(cur);
  return calls;
}

/** The long-trip matrix for [origin, dest, ...stops]. Fetch failures just leave the model in place. */
export async function corridorMatrix(points: LatLng[], baseline: RoadRoute, mode: Mode, fetchPairs = pairsMinutes) {
  const spots = onRoute(points, baseline);
  const real = new Map<string, number>();
  const calls = planCalls(points, spots).slice(0, MAX_CALLS);
  for (let c = 0; c < calls.length; c += 2) {   // two at a time: the public routing server is shared
    await Promise.all(calls.slice(c, c + 2).map(async ({ sources, targets }) => {
      const keys = [...targets.keys()];
      try {
        const rows = await fetchPairs(sources.map((i) => points[i]), [...targets.values()], mode);
        sources.forEach((i, r) => keys.forEach((k, t) => {
          const min = rows[r]?.[t];
          if (!Number.isFinite(min)) return;
          if (k === `a${i}`) real.set(`${i},a`, min);
          else if (!k.startsWith("a")) real.set(`${i},${k}`, min);
        }));
      } catch (error) { console.error("corridor matrix call failed", error); }
    }));
  }
  return { matrix: corridorMinutes(spots, mode, real), fetched: real.size };
}
