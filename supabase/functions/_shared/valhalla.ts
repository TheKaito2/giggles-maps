// Routing via Valhalla. MVP uses the public FOSSGIS server (fair use, no key);
// production sets VALHALLA_URL to our own instance built from the Thailand OSM extract.
const BASE = Deno.env.get("VALHALLA_URL") ?? "https://valhalla1.openstreetmap.de";

export type Mode = "pedestrian" | "auto";
export interface LatLng { lat: number; lng: number }

const post = async (path: string, body: unknown) => {
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "GigglesMaps/0.1" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`valhalla ${path} ${res.status}`);
  return res.json();
};

// minutes between every pair of points. The public server caps a request at 100 location pairs,
// so send source rows in chunks that stay under it (own server: raise MATRIX_MAX_PAIRS).
const MAX_PAIRS = Number(Deno.env.get("MATRIX_MAX_PAIRS") ?? 100);

export async function matrixMinutes(points: LatLng[], mode: Mode): Promise<number[][]> {
  const locs = points.map((p) => ({ lat: p.lat, lon: p.lng }));
  const rowsPerCall = Math.max(1, Math.floor(MAX_PAIRS / locs.length) - 1);
  const chunks: { lat: number; lon: number }[][] = [];
  for (let i = 0; i < locs.length; i += rowsPerCall) chunks.push(locs.slice(i, i + rowsPerCall));
  const parts = await Promise.all(chunks.map((sources) =>
    post("sources_to_targets", { sources, targets: locs, costing: mode })));
  return parts.flatMap((d) => d.sources_to_targets.map((row: { time: number | null }[]) =>
    row.map((c) => (c.time == null ? Infinity : c.time / 60))));
}

// road geometry for the final stop order as [lng, lat] pairs
export async function routeLine(points: LatLng[], mode: Mode): Promise<[number, number][]> {
  const data = await post("route", { locations: points.map((p) => ({ lat: p.lat, lon: p.lng })), costing: mode });
  return data.trip.legs.flatMap((leg: { shape: string }) => decodePolyline6(leg.shape));
}

// straight-line fallback when routing is down: haversine * 1.3 detour factor
export function estimateMinutes(points: LatLng[], mode: Mode): number[][] {
  const metersPerMin = mode === "pedestrian" ? 80 : 500;
  return points.map((a) => points.map((b) => (haversineM(a, b) * 1.3) / metersPerMin));
}

export function haversineM(a: LatLng, b: LatLng): number {
  const r = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function decodePolyline6(str: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0, lat = 0, lng = 0;
  const next = () => {
    let result = 0, shift = 0, b: number;
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) { lat += next(); lng += next(); out.push([lng / 1e6, lat / 1e6]); }
  return out;
}
