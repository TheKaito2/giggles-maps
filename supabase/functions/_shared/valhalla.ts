export type Mode = "pedestrian" | "auto";
export interface LatLng { lat: number; lng: number }
export interface RoadRoute { geometry: [number, number][]; legMin: number[]; travelMin: number }
export class RoutingError extends Error {}

// Route requests work for intercity trips even when the public matrix API rejects them.
export function createRouter(base: string, fetcher: typeof fetch = fetch) {
  return async (points: LatLng[], mode: Mode): Promise<RoadRoute> => {
    const response = await fetcher(`${base.replace(/\/$/, "")}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": "giggles-maps.pages.dev" },
      body: JSON.stringify({ locations: points.map((p) => ({ lat: p.lat, lon: p.lng, type: "break" })), costing: mode, units: "kilometers" }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new RoutingError(`route provider returned ${response.status}`);
    const data = await response.json();
    const legs = data.trip?.legs;
    if (data.trip?.status !== 0 || !Array.isArray(legs) || legs.length !== points.length - 1) throw new RoutingError("incomplete road route");
    const geometry: [number, number][] = [], legMin: number[] = [];
    for (const leg of legs) {
      if (!Number.isFinite(leg.summary?.time) || leg.summary.time < 0 || typeof leg.shape !== "string") throw new RoutingError("invalid road route");
      const line = decodePolyline6(leg.shape);
      if (line.length < 2) throw new RoutingError("missing road geometry");
      geometry.push(...(geometry.length ? line.slice(1) : line));
      legMin.push(leg.summary.time / 60);
    }
    return { geometry, legMin, travelMin: legMin.reduce((sum, n) => sum + n, 0) };
  };
}
export function decodePolyline6(str: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0, lat = 0, lng = 0;
  const next = () => {
    let result = 0, shift = 0, b: number;
    do {
      if (i >= str.length || shift > 30) throw new RoutingError("invalid encoded geometry");
      b = str.charCodeAt(i++) - 63;
      if (b < 0 || b > 63) throw new RoutingError("invalid encoded geometry");
      result |= (b & 0x1f) << shift; shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next(); lng += next();
    if (Math.abs(lat) > 90e6 || Math.abs(lng) > 180e6) throw new RoutingError("invalid coordinates");
    out.push([lng / 1e6, lat / 1e6]);
  }
  return out;
}
