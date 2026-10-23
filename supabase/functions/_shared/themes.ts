// Trip themes: the engine plans one route per theme and the user picks one.
// A theme boosts its kinds of stop (x2) in the planner's score; other kinds can still appear.
// Pure module, shared by planner.ts and any other planner (e.g. road-route planning).

export type Theme = "top_picks" | "nature" | "food" | "culture" | "shopping";

export const THEMES: { id: Theme; name: string; boost: string[] }[] = [
  { id: "top_picks", name: "Top picks", boost: [] },
  { id: "nature", name: "Nature lover", boost: ["park", "viewpoint"] },
  { id: "food", name: "Food lover", boost: ["cafe", "food", "market"] },
  { id: "culture", name: "Culture & temples", boost: ["temple", "museum", "art"] },
  { id: "shopping", name: "Shopping & crafts", boost: ["craft", "market"] },
];

export const THEME_BOOST = 2;

export const isTheme = (v: unknown): v is Theme => THEMES.some((t) => t.id === v);

// "What draws you in?": the kinds of stop each interest chip means. Landmarks are the sights a trip is built around.
export const INTERESTS: Record<string, string[]> = {
  food: ["food", "market"],
  cafes: ["cafe"],
  culture: ["temple", "museum", "art"],
  nature: ["park", "viewpoint"],
  shopping: ["craft", "market"],
  landmarks: ["viewpoint", "museum", "temple"],
};

export const isInterest = (v: unknown): v is string => typeof v === "string" && v in INTERESTS;

/** The user's own mix: x2 for any kind one of their picked interests covers. */
export function mixWeight(interests: string[]): (category: string) => number {
  const boosted = new Set(interests.flatMap((i) => INTERESTS[i] ?? []));
  return (category) => boosted.has(category) ? THEME_BOOST : 1;
}

export function themeWeight(theme: Theme, category: string): number {
  return THEMES.find((t) => t.id === theme)!.boost.includes(category) ? THEME_BOOST : 1;
}
