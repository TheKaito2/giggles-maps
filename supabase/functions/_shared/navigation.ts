import { decodePolyline6 } from "./valhalla.ts";

export interface Maneuver {
  type: number;          // Valhalla maneuver type (turn left = 15, right = 10, destination = 4 ...); the app builds Thai text from it
  instruction: string;   // English, from Valhalla
  verbal: string | null; // what to say ahead of the turn
  street: string | null;
  lengthM: number;       // metres until the next maneuver
  timeS: number;
  begin: number;         // index into the whole route's shape
  leg: number;           // which leg (0 = to the first stop)
}
export interface NavRoute { shape: [number, number][]; maneuvers: Maneuver[]; distanceM: number; timeS: number; legEnds: number[] }

/** Joins Valhalla's legs into one shape and one maneuver list, with every maneuver pointing into the joined shape. */
export function toNavRoute(trip: { legs: { shape: string; maneuvers: Record<string, unknown>[] }[]; summary: { length: number; time: number } }): NavRoute {
  const shape: [number, number][] = [], maneuvers: Maneuver[] = [], legEnds: number[] = [];
  trip.legs.forEach((leg, li) => {
    const line = decodePolyline6(leg.shape);
    const offset = shape.length ? shape.length - 1 : 0;   // legs share their joining point
    shape.push(...(shape.length ? line.slice(1) : line));
    for (const m of leg.maneuvers) {
      // between legs Valhalla repeats "arrive" (type 4/5/6) then "depart" (1/2/3); keep only the last arrival
      if (li < trip.legs.length - 1 && [4, 5, 6].includes(m.type as number)) continue;
      if (li > 0 && [1, 2, 3].includes(m.type as number)) continue;
      maneuvers.push({
        type: m.type as number, instruction: String(m.instruction ?? ""),
        verbal: (m.verbal_pre_transition_instruction as string) ?? null,
        street: Array.isArray(m.street_names) && m.street_names.length ? String(m.street_names[0]) : null,
        lengthM: Math.round(Number(m.length ?? 0) * 1000), timeS: Math.round(Number(m.time ?? 0)),
        begin: offset + Number(m.begin_shape_index ?? 0), leg: li,
      });
    }
    legEnds.push(shape.length - 1);
  });
  return { shape, maneuvers, distanceM: Math.round(trip.summary.length * 1000), timeS: Math.round(trip.summary.time), legEnds };
}
