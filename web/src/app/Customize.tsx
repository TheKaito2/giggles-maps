import { useEffect, useRef, useState } from "react";
import { Star, X } from "lucide-react";
import type { Interest, LatLng } from "../lib/api";
import ExplorePlaces from "./ExplorePlaces";
import { DEFAULT_PREFS, INTERESTS, MEALS, type Prefs, PRICES, RATINGS, ratingLabel } from "./prefs";


/** How many filters differ from the defaults (shown on the Filters button). */
export function filterCount(p: Prefs): number {
  return [p.interests.length > 0, p.minRating !== DEFAULT_PREFS.minRating, p.maxPrice != null, p.maxStops != null,
    p.ratedOnly, p.picks.length > 0, p.meals.length > 0].filter(Boolean).length;
}

/** Everything optional about a detour, in one sheet: meals, interests, places to visit, rating, price, stops.
 *  Edits a draft; Done applies it (each change re-plans every preset, so not on every tap). */
export default function Filters({ prefs: start, apply, near, onClose }: { prefs: Prefs; apply: (p: Prefs) => void; near: LatLng | null; onClose: () => void }) {
  const [prefs, setDraft] = useState(start);
  const box = useRef<HTMLDivElement>(null);
  // focus moves in on open, Escape closes, focus returns to the Filters button
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("h2")?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("keydown", esc); back?.focus(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) =>
    setDraft((p) => ({ ...p, ...(typeof patch === "function" ? patch(p) : patch) }));
  const toggle = (id: Interest) =>
    set((p) => ({ interests: p.interests.includes(id) ? p.interests.filter((i) => i !== id) : [...p.interests, id] }));
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="filters-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal filters" ref={box}>
        <header className="modal-head"><h2 id="filters-title" tabIndex={-1}>Filters</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button></header>

        <div className="field">
          <span id="meal-label">Stop for a meal</span>
          <div className="row tight" role="group" aria-labelledby="meal-label">
            {MEALS.map((m) => {
              const on = prefs.meals.includes(m.id);
              return (
                <button key={m.id} type="button" className={`pill ${on ? "on" : ""}`} aria-pressed={on} title={`Arrive at a food stop between ${m.window}`}
                  onClick={() => set((p) => ({ meals: on ? p.meals.filter((x) => x !== m.id) : [...p.meals, m.id] }))}>{m.label}</button>
              );
            })}
          </div>
        </div>

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
        <div className="row between filters-foot">
          <button type="button" className="link" onClick={() => set({ ...DEFAULT_PREFS, mode: prefs.mode, depart: prefs.depart, time: prefs.time, budget: prefs.budget })}>Reset</button>
          <button type="button" className="btn" onClick={() => { apply(prefs); onClose(); }}>Done</button>
        </div>
      </div>
    </div>
  );
}
