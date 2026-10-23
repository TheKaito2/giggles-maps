import type { Interest, LatLng, Meal, PlanRequest, TravelMode } from "../lib/api";

// Everything the planner form sets. The summary card reads the same object, so the two never disagree.
export interface Prefs {
  mode: TravelMode;
  depart: "now" | "30" | "60" | "custom";
  time: string;                  // HH:MM, used when depart = custom
  budget: number | "auto";       // extra minutes, or auto (server: half the direct trip, 45 min-3 h)
  interests: Interest[];         // empty = Surprise me (Top picks leads)
  minRating: 0 | 3.5 | 4 | 4.5;
  maxPrice: 0 | 1 | 2 | 3 | null;
  maxStops: number | null;       // null = Auto
  ratedOnly: boolean;             // false = unrated places join too (ranked below rated ones)
  picks: Pick[];                  // "Places you want to visit", sent as must_include
  meals: Meal[];                  // "Stop for a meal?": a food stop arriving inside each meal's window
}

export interface Pick { id: number; name: string }

export const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
export const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;

export const DEFAULT_PREFS: Prefs = {
  mode: "pedestrian", depart: "now", time: hhmm(Math.max(nowMin(), 9 * 60)), budget: "auto",
  interests: [], minRating: 4, maxPrice: null, maxStops: null, ratedOnly: false, picks: [], meals: [],
};

export const MAX_BUDGET = 240;
export const MEALS: { id: Meal; label: string; window: string }[] = [
  { id: "breakfast", label: "Breakfast", window: "07:00–09:30" },
  { id: "lunch", label: "Lunch", window: "11:30–13:30" },
  { id: "dinner", label: "Dinner", window: "17:30–20:00" },
];
export const BUDGETS: (number | "auto")[] = ["auto", 15, 30, 45, 60, 90, 120, 180, 240];
export const budgetLabel = (m: number | "auto") => m === "auto" ? "Auto" : m < 60 ? `${m} min` : `${m / 60} h`;

export const MODES: { id: TravelMode; label: string }[] = [
  { id: "pedestrian", label: "Walking" }, { id: "auto", label: "Driving" }, { id: "bicycle", label: "Cycling" },
];
export const INTERESTS: { id: Interest; label: string }[] = [
  { id: "food", label: "Local food" }, { id: "culture", label: "Culture" }, { id: "nature", label: "Nature" },
  { id: "cafes", label: "Cafés" }, { id: "shopping", label: "Shopping" }, { id: "landmarks", label: "Landmarks" },
];
export const RATINGS: Prefs["minRating"][] = [0, 3.5, 4, 4.5];
export const PRICES: { id: Prefs["maxPrice"]; label: string; name: string }[] = [
  { id: null, label: "Any", name: "Any budget" }, { id: 0, label: "Free", name: "Free only" },
  { id: 1, label: "฿", name: "Up to ฿" }, { id: 2, label: "฿฿", name: "Up to ฿฿" }, { id: 3, label: "฿฿฿", name: "Up to ฿฿฿" },
];
export const DEPARTS: { id: Prefs["depart"]; label: string }[] = [
  { id: "now", label: "Leave now" }, { id: "30", label: "In 30 min" }, { id: "60", label: "In 1 hour" }, { id: "custom", label: "Pick a time" },
];

export const startMin = (p: Prefs) =>
  p.depart === "custom" ? Number(p.time.slice(0, 2)) * 60 + Number(p.time.slice(3, 5))
    : (nowMin() + (p.depart === "now" ? 0 : Number(p.depart))) % 1440;

export const ratingLabel = (r: Prefs["minRating"]) => r === 0 ? "Any" : `${r.toFixed(1)}+`;
export const departLabel = (p: Prefs) => p.depart === "custom" ? `at ${p.time}` : p.depart === "now" ? "now" : DEPARTS.find((d) => d.id === p.depart)!.label.toLowerCase();

/** The request body: defaults are left out so the server applies its own. */
export function toRequest(p: Prefs, origin: LatLng, dest: LatLng): PlanRequest {
  return {
    origin, dest, start_min: startMin(p), budget_min: p.budget === "auto" ? "auto" : Math.min(p.budget, MAX_BUDGET), mode: p.mode,
    ...(p.interests.length ? { interests: p.interests } : {}),
    ...(p.minRating !== 4 ? { min_rating: p.minRating } : {}),
    ...(p.ratedOnly ? { include_unrated: false } : {}),
    ...(p.picks.length ? { must_include: p.picks.map((x) => x.id) } : {}),
    ...(p.meals.length ? { meals: p.meals } : {}),
    ...(p.maxStops != null ? { max_stops: p.maxStops } : {}),
    ...(p.maxPrice != null ? { max_price: p.maxPrice } : {}),
  };
}

export interface Place { point: LatLng; name: string }
