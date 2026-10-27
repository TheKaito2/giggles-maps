// Detour styles: the engine plans one route per style and the user picks one.
// A style boosts its kinds of stop (x2) in the planner's score; other kinds can still appear.
// Landmarks (tier 3: Wikipedia/Wikidata-linked places, national parks, heritage, waterfalls; tier 4 "Icon": the country's
// major ones, e.g. Wat Arun, Khao Yai) are what a detour is for;
// "Local gems" deliberately skips them so it feels different. Pure module, shared by every planner.

export type Theme = "top_picks" | "nature" | "culture" | "local" | "food" | "shopping";
export type Tier = 1 | 2 | 3 | 4;   // 4 = icon (major landmark), 3 = landmark, 2 = worth a visit, 1 = everyday

export const THEMES: { id: Theme; name: string; boost: string[]; landmarks?: "boost" | "skip" }[] = [
  { id: "top_picks", name: "Landmarks", boost: [], landmarks: "boost" },
  { id: "nature", name: "Scenic", boost: ["park", "viewpoint"] },
  { id: "culture", name: "Culture & heritage", boost: ["temple", "museum", "art"] },
  { id: "local", name: "Local gems", boost: [], landmarks: "skip" },
  { id: "food", name: "Food lover", boost: ["cafe", "food", "market"] },
  { id: "shopping", name: "Shopping & crafts", boost: ["craft", "market"] },
];

const THEME_BOOST = 2;

const ALIASES: Record<string, Theme> = { scenic: "nature" };
/** The theme id a request names (accepts "scenic" for the Scenic style), or null. */
export const toTheme = (v: unknown): Theme | null =>
  typeof v !== "string" ? null : Object.hasOwn(ALIASES, v) ? ALIASES[v] : THEMES.some((t) => t.id === v) ? v as Theme : null;

// "What draws you in?": the kinds of stop each interest chip means. "landmarks" means tier 3+ of any kind.
export const INTERESTS: Record<string, string[]> = {
  food: ["food", "market"],
  cafes: ["cafe"],
  culture: ["temple", "museum", "art"],
  nature: ["park", "viewpoint"],
  shopping: ["craft", "market"],
  landmarks: [],
};

export const isInterest = (v: unknown): v is string => typeof v === "string" && Object.hasOwn(INTERESTS, v);

/** "Only these kinds": does a place fit any picked interest? ("landmarks" = tier 3+ of any kind). Empty = everything. */
export function fitsInterests(interests: string[], category: string, tier?: Tier): boolean {
  if (!interests.length) return true;
  return interests.some((i) => (INTERESTS[i] ?? []).includes(category)) || (interests.includes("landmarks") && (tier ?? 0) >= 3);
}

/** "Avoid chains": shops, cafés and restaurants must be independent (local, OTOP or community); sights always pass. */
const COMMERCIAL = new Set(["food", "cafe", "market", "craft"]);
export const independent = (p: { category: string; local?: boolean; otop?: boolean; community?: boolean }) =>
  !COMMERCIAL.has(p.category) || !!(p.local || p.otop || p.community);

/** The user's own mix: x2 for any kind one of their picked interests covers (and for landmarks if picked). */
export function mixWeight(interests: string[]): (category: string, tier?: Tier) => number {
  const boosted = new Set(interests.flatMap((i) => INTERESTS[i] ?? []));
  const landmarks = interests.includes("landmarks");
  return (category, tier) => boosted.has(category) || (landmarks && (tier ?? 0) >= 3) ? THEME_BOOST : 1;
}

/** 0 means the style leaves this stop out (Local gems never picks a landmark). */
export function themeWeight(theme: Theme, category: string, tier?: Tier): number {
  const t = THEMES.find((x) => x.id === theme)!;
  if ((tier ?? 0) >= 3 && t.landmarks === "skip") return 0;
  return t.boost.includes(category) || ((tier ?? 0) >= 3 && t.landmarks === "boost") ? THEME_BOOST : 1;
}
