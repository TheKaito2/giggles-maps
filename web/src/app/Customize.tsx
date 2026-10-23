import { ChevronDown, SlidersHorizontal, Star } from "lucide-react";
import type { Interest, LatLng } from "../lib/api";
import ExplorePlaces from "./ExplorePlaces";
import { INTERESTS, type Prefs, PRICES, RATINGS, ratingLabel } from "./prefs";

type Set = (patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) => void;

/** One line saying what's customised, so the folded section still shows its state. */
export function customSummary(p: Prefs): string {
  const parts = [
    p.interests.length ? INTERESTS.filter((i) => p.interests.includes(i.id)).map((i) => i.label).join(", ") : "Surprise me",
    p.minRating ? `★${ratingLabel(p.minRating)}` : "any rating",
    PRICES.find((x) => x.id === p.maxPrice)!.name.toLowerCase(),
  ];
  if (p.maxStops) parts.push(`≤${p.maxStops} stops`);
  if (p.picks.length) parts.push(`${p.picks.length} picked`);
  if (p.ratedOnly) parts.push("rated only");
  return parts.join(" · ");
}

/** Everything optional: interests, places to visit, filters. Folded by default. */
export default function Customize({ prefs, set, near }: { prefs: Prefs; set: Set; near: LatLng | null }) {
  const toggle = (id: Interest) =>
    set((p) => ({ interests: p.interests.includes(id) ? p.interests.filter((i) => i !== id) : [...p.interests, id] }));
  return (
    <details className="customize">
      <summary>
        <SlidersHorizontal size={16} aria-hidden />
        <span className="customize-title">Customize<span className="fine">{customSummary(prefs)}</span></span>
        <ChevronDown size={16} aria-hidden className="chev" />
      </summary>
      <div className="customize-body">
        <div className="field">
          <span id="interests-label">What draws you in?</span>
          <div className="row tight" role="group" aria-labelledby="interests-label">
            <button type="button" className={`pill ${prefs.interests.length === 0 ? "on" : ""}`} aria-pressed={prefs.interests.length === 0}
              onClick={() => set({ interests: [] })}>Surprise me</button>
            {INTERESTS.map((i) => (
              <button key={i.id} type="button" className={`pill ${prefs.interests.includes(i.id) ? "on" : ""}`}
                aria-pressed={prefs.interests.includes(i.id)} onClick={() => toggle(i.id)}>{i.label}</button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Places you want to visit</span>
          <ExplorePlaces near={near} picks={prefs.picks} setPicks={(picks) => set({ picks })} />
        </div>

        <div className="field">
          <span id="rating-label">Minimum rating</span>
          <div className="row tight" role="radiogroup" aria-labelledby="rating-label">
            {RATINGS.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={prefs.minRating === r} className={`pill ${prefs.minRating === r ? "on" : ""}`}
                onClick={() => set({ minRating: r })}>{r > 0 && <Star size={12} aria-hidden className="star" />}{ratingLabel(r)}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <span id="price-label">Spending per stop</span>
          <div className="row tight" role="radiogroup" aria-labelledby="price-label">
            {PRICES.map((p) => (
              <button key={String(p.id)} type="button" role="radio" aria-checked={prefs.maxPrice === p.id} aria-label={p.name}
                className={`pill ${prefs.maxPrice === p.id ? "on" : ""}`} onClick={() => set({ maxPrice: p.id })}>{p.label}</button>
            ))}
          </div>
        </div>
        <div className="pref-rows">
          <label className="pref-row">
            <span>Number of stops</span>
            <select value={prefs.maxStops ?? ""} onChange={(e) => set({ maxStops: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Auto · best fit</option>
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>Up to {n}</option>)}
            </select>
          </label>
          <label className="pref-row">
            <span>Rated places only</span>
            <input type="checkbox" role="switch" className="switch" checked={prefs.ratedOnly} onChange={(e) => set({ ratedOnly: e.target.checked })} />
          </label>
        </div>
        <p className="fine">Most places have no ratings yet; they're included but ranked below rated ones.</p>
      </div>
    </details>
  );
}
