// How many stops a plan holds, by plan tier (Roadtrippers-style: the limit power users pay to lift).
// Free (guests and signed-in non-members): 3. Members, Plus and demo mode: 15, the most a plan ever holds.
export const STOP_CAP = { free: 3, member: 15 } as const;

export const stopCap = (unlimited: boolean) => unlimited ? STOP_CAP.member : STOP_CAP.free;

/** Why a request's must-visit picks are refused, or null when they fit. stop_limit_free is a gate: membership lifts it. */
export const stopLimitCode = (picks: number, unlimited: boolean) =>
  picks <= stopCap(unlimited) ? null : unlimited ? "stop_limit" : "stop_limit_free";

/** The most stops the planner may fill: the user's own "up to N", never past the tier's cap. */
export const plannedStops = (asked: number | undefined, unlimited: boolean) => Math.min(asked ?? Infinity, stopCap(unlimited));
