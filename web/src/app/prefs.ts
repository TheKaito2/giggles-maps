import type { Interest, LatLng, PlanRequest, TravelMode } from "../lib/api";

// Everything the planner form sets. The summary card reads the same object, so the two never disagree.
export interface Prefs {
  mode: TravelMode;
  depart: "now" | "30" | "60" | "custom";
  time: string;                  // HH:MM, used when depart = custom
  budget: number;                // extra minutes
  interests: Interest[];         // empty = Surprise me (Top picks leads)
  minRating: 0 | 3.5 | 4 | 4.5;
  maxPrice: 0 | 1 | 2 | 3 | null;
  maxStops: number | null;       // null = Auto
  includeUnrated: boolean;
}

export const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
export const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;

export const DEFAULT_PREFS: Prefs = {
  mode: "pedestrian", depart: "now", time: hhmm(Math.max(nowMin(), 9 * 60)), budget: 45,
  interests: [], minRating: 4, maxPrice: null, maxStops: null, includeUnrated: false,
};

export const MAX_BUDGET = 240;

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
export const departLabel = (p: Prefs) => p.depart === "custom" ? p.time : p.depart === "now" ? "Now" : DEPARTS.find((d) => d.id === p.depart)!.label;

/** The request body: defaults are left out so the server applies its own. */
export function toRequest(p: Prefs, origin: LatLng, dest: LatLng): PlanRequest {
  return {
    origin, dest, start_min: startMin(p), budget_min: Math.min(p.budget, MAX_BUDGET), mode: p.mode,
    ...(p.interests.length ? { interests: p.interests } : {}),
    ...(p.minRating !== 4 ? { min_rating: p.minRating } : {}),
    ...(p.includeUnrated ? { include_unrated: true } : {}),
    ...(p.maxStops != null ? { max_stops: p.maxStops } : {}),
    ...(p.maxPrice != null ? { max_price: p.maxPrice } : {}),
  };
}

export interface Place { point: LatLng; name: string }
