import type { Interest, LatLng, Meal, PlanRequest, TravelMode } from "../lib/api";

// Everything the planner form sets. The summary card reads the same object, so the two never disagree.
export interface Prefs {
  mode: TravelMode;
  depart: "now" | "30" | "60" | "custom";
  time: string;                  // HH:MM, used when depart = custom
  budget: number | "auto";       // extra minutes, or auto (server: half the direct trip, 45 min-3 h)
  interests: Interest[];         // only these kinds of stop; empty = any kind
  maxStops: number | null;       // null = Auto
  picks: Pick[];                  // must-visit places, sent as must_include
  meals: Meal[];                  // a food stop arriving inside each meal's window
  noChains: boolean;              // independent shops, cafés and restaurants only
}
// ponytail: rating and price filters are gone until real data exists (OpenStreetMap has neither; 0 reviews so far)

export interface Pick { id: number; name: string }

const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
// rounded first, so 10:59.6 reads 11:00, not 10:00
export const hhmm = (m: number) => { const r = Math.round(m); return `${String(Math.floor(r / 60) % 24).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}`; };

export const DEFAULT_PREFS: Prefs = {
  mode: "auto", depart: "now", time: hhmm(Math.max(nowMin(), 9 * 60)), budget: "auto",
  interests: [], maxStops: null, picks: [], meals: [], noChains: false,
};

export const MAX_BUDGET = 240;
export const MEALS: { id: Meal; label: string; window: string }[] = [
  { id: "breakfast", label: "Breakfast", window: "07:00–09:30" },
  { id: "lunch", label: "Lunch", window: "11:30–13:30" },
  { id: "dinner", label: "Dinner", window: "17:30–20:00" },
];
export const BUDGETS: (number | "auto")[] = ["auto", 15, 30, 45, 60, 90, 120, 180, 240];
export const budgetLabel = (m: number | "auto") => m === "auto" ? "Auto" : m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;

export const MODES: { id: TravelMode; label: string }[] = [
  { id: "pedestrian", label: "Walking" }, { id: "auto", label: "Driving" }, { id: "bicycle", label: "Cycling" },
];
export const INTERESTS: { id: Interest; label: string; short: string }[] = [
  { id: "culture", label: "Temples & culture", short: "temples" }, { id: "nature", label: "Nature & views", short: "nature" },
  { id: "food", label: "Local food", short: "local food" }, { id: "cafes", label: "Cafés & desserts", short: "cafés" },
  { id: "shopping", label: "Shops & OTOP", short: "shops" }, { id: "landmarks", label: "Landmarks", short: "landmarks" },
];
export const DEPARTS: { id: Prefs["depart"]; label: string }[] = [
  { id: "now", label: "Leave now" }, { id: "30", label: "In 30 min" }, { id: "60", label: "In 1 hour" }, { id: "custom", label: "Pick a time" },
];

export const startMin = (p: Prefs) =>
  p.depart === "custom" ? Number(p.time.slice(0, 2)) * 60 + Number(p.time.slice(3, 5))
    : (nowMin() + (p.depart === "now" ? 0 : Number(p.depart))) % 1440;


/** The request body: defaults are left out so the server applies its own. */
export function toRequest(p: Prefs, origin: LatLng, dest: LatLng): PlanRequest {
  return {
    origin, dest, start_min: startMin(p), budget_min: p.budget === "auto" ? "auto" : Math.min(p.budget, MAX_BUDGET), mode: p.mode,
    ...(p.interests.length ? { interests: p.interests } : {}),
    ...(p.noChains ? { no_chains: true } : {}),
    ...(p.picks.length ? { must_include: p.picks.map((x) => x.id) } : {}),
    ...(p.meals.length ? { meals: p.meals } : {}),
    ...(p.maxStops != null ? { max_stops: p.maxStops } : {}),
  };
}

export interface Place { point: LatLng; name: string }

/** The filters in one plain sentence, e.g. "Only temples and cafés · lunch stop · up to 3 stops · no chains". */
export function filterSummary(p: Prefs): string {
  const kinds = INTERESTS.filter((i) => p.interests.includes(i.id)).map((i) => i.short);
  const parts = [kinds.length ? `Only ${kinds.length > 1 ? `${kinds.slice(0, -1).join(", ")} and ${kinds[kinds.length - 1]}` : kinds[0]}` : "Any kind of stop"];
  if (p.meals.length) parts.push(`${p.meals.join(" and ")} stop`);
  if (p.picks.length) parts.push(`${p.picks.length} must-visit`);
  if (p.maxStops) parts.push(`up to ${p.maxStops} stop${p.maxStops === 1 ? "" : "s"}`);
  if (p.noChains) parts.push("no chains");
  return parts.join(" · ");
}
