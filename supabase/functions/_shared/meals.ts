// Meal-aware planning: when a trip runs through a meal time, a plan includes a food stop then.
// Times are local minutes after midnight (Thailand).

export type Meal = "breakfast" | "lunch" | "dinner";

export const MEAL_WINDOWS: Record<Meal, [number, number]> = {
  breakfast: [7 * 60, 9 * 60 + 30],
  lunch: [11 * 60 + 30, 13 * 60 + 30],
  dinner: [17 * 60 + 30, 20 * 60],
};

export const MEAL_CATEGORIES = new Set(["cafe", "food", "market"]);
/** Where a meal stop can be: a restaurant (OSM restaurants and food courts are "food"); breakfast may also be a cafe. */
export const MEAL_PLACES: Record<Meal, Set<string>> = {
  breakfast: new Set(["food", "cafe"]), lunch: new Set(["food"]), dinner: new Set(["food"]),
};

// A meal applies when the trip window overlaps it by at least `minOverlap` minutes.
// ponytail: trips crossing midnight are rare for detours; only the start day is considered.
export function mealsInTrip(startMin: number, endMin: number, minOverlap = 30): Meal[] {
  return (Object.keys(MEAL_WINDOWS) as Meal[]).filter((m) => {
    const [from, to] = MEAL_WINDOWS[m];
    return Math.min(endMin, to) - Math.max(startMin, from) >= minOverlap;
  });
}

export const inMealWindow = (meal: Meal, arrivalMin: number) =>
  arrivalMin >= MEAL_WINDOWS[meal][0] && arrivalMin <= MEAL_WINDOWS[meal][1];
