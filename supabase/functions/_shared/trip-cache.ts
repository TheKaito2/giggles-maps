// A trip's routing work kept for 30 minutes (table routing_cache, service role only): the direct route and every road
// time fetched between two points. Edits, theme taps and reopening the same trip reuse them instead of routing again.
import type { LatLng, Mode, RoadRoute } from "./valhalla.ts";

const KEEP_MS = 30 * 60_000;
// deno-lint-ignore no-explicit-any
type Db = any;

/** Origin and destination to ~10 m, and the travel mode. */
export const tripKey = (mode: Mode, origin: LatLng, dest: LatLng) =>
  `${mode}|${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}|${dest.lat.toFixed(4)},${dest.lng.toFixed(4)}`;

export async function loadTrip(db: Db, key: string): Promise<{ baseline: RoadRoute | null; pairs: Map<string, number> }> {
  const { data, error } = await db.from("routing_cache").select("baseline, pairs").eq("key", key)
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) console.error("trip cache read failed", error);
  const pairs = new Map<string, number>(Object.entries((data?.pairs ?? {}) as Record<string, number>)
    .filter(([, v]) => Number.isFinite(v)));
  return { baseline: (data?.baseline as RoadRoute | null) ?? null, pairs };
}

/** Saves the direct route and the road times (only real ones: unreachable pairs are asked again next time). */
export async function saveTrip(db: Db, key: string, baseline: RoadRoute, pairs: Map<string, number>) {
  const finite = Object.fromEntries([...pairs].filter(([, v]) => Number.isFinite(v)));
  const { error } = await db.from("routing_cache").upsert({ key, baseline, pairs: finite,
    expires_at: new Date(Date.now() + KEEP_MS).toISOString() });
  if (error) console.error("trip cache write failed", error);
}
