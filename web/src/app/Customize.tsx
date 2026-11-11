import { useState } from "react";
import { Coffee, Landmark, Lock, type LucideIcon, ShoppingBag, Sparkles, Trees, UtensilsCrossed, X } from "lucide-react";
import type { Interest, LatLng } from "../lib/api";
import ExplorePlaces from "./ExplorePlaces";
import { DEFAULT_PREFS, filterSummary, FREE_STOPS, INTERESTS, MEALS, type Prefs } from "./prefs";
import Info from "./Info";
import Modal from "./Modal";

export const KIND_ICON: Record<Interest, LucideIcon> = {
  culture: Landmark, nature: Trees, food: UtensilsCrossed, cafes: Coffee, shopping: ShoppingBag, landmarks: Sparkles,
};

/** How many filters are on (shown on the More button). */
export function filterCount(p: Prefs): number {
  return [p.interests.length > 0, p.maxStops != null, p.picks.length > 0, p.meals.length > 0, p.noChains].filter(Boolean).length;
}

/** All the ways to shape your stops, each a plain question. Edits a draft; "Show plans" applies it
 *  (each change re-plans every time option, so not on every tap). `onMore` set = a free plan (3 stops at most): the stop
 *  count goes to 3 and "More stops · Members" opens the membership sheet. */
export default function Filters({ prefs: start, apply, near, onClose, onMore }: { prefs: Prefs; apply: (p: Prefs) => void; near: LatLng | null;
  onClose: () => void; onMore?: () => void }) {
  const [prefs, setDraft] = useState(start);
  const most = onMore ? FREE_STOPS : 6;
  const set = (patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) =>
    setDraft((p) => ({ ...p, ...(typeof patch === "function" ? patch(p) : patch) }));
  const toggle = (id: Interest) =>
    set((p) => ({ interests: p.interests.includes(id) ? p.interests.filter((i) => i !== id) : [...p.interests, id] }));

  return (
    <Modal labelledBy="filters-title" className="filters" onClose={onClose}>
        <header className="modal-head"><h2 id="filters-title" tabIndex={-1}>Your stops</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close without changes"><X size={20} /></button></header>

        <section className="filter-q" aria-labelledby="q-kinds">
          <h3 id="q-kinds">What kind of stops? <Info label="About kinds of stops">Pick some and every plan uses only those. Pick none for a mix of
            everything.</Info></h3>
          <div className="kind-tiles">
            {INTERESTS.map((i) => {
              const Icon = KIND_ICON[i.id], on = prefs.interests.includes(i.id);
              return <button key={i.id} type="button" className={`kind-tile${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(i.id)}>
                <Icon size={22} aria-hidden /><span>{i.label}</span></button>;
            })}
          </div>
        </section>

        <section className="filter-q" aria-labelledby="q-meal">
          <h3 id="q-meal">Stop to eat? <Info label="About meal stops">We add a restaurant you reach inside the meal time.</Info></h3>
          <div className="row tight">
            {MEALS.map((m) => {
              const on = prefs.meals.includes(m.id);
              return <button key={m.id} type="button" className={`pill meal-pill ${on ? "on" : ""}`} aria-pressed={on}
                onClick={() => set((p) => ({ meals: on ? p.meals.filter((x) => x !== m.id) : [...p.meals, m.id] }))}>
                <b>{m.label}</b><span className="fine">{m.window}</span></button>;
            })}
          </div>
        </section>

        <section className="filter-q" aria-labelledby="q-picks">
          <h3 id="q-picks">Anywhere you must visit? <Info label="About must-visit places">These go into every plan when there's time.</Info></h3>
          <ExplorePlaces near={near} picks={prefs.picks} setPicks={(picks) => set({ picks })} />
        </section>

        <section className="filter-q" aria-labelledby="q-stops">
          <h3 id="q-stops">How many stops? <b className="num stops-now">{prefs.maxStops ? `Up to ${prefs.maxStops}` : "As many as fit"}</b></h3>
          <input type="range" min={0} max={most} step={1} value={Math.min(prefs.maxStops ?? 0, most)} aria-labelledby="q-stops"
            aria-valuetext={prefs.maxStops ? `Up to ${prefs.maxStops} stops` : "As many as fit"}
            onChange={(e) => set({ maxStops: Number(e.target.value) || null })} />
          <div className="range-ticks fine" aria-hidden><span>Any</span>{Array.from({ length: most }, (_, i) => <span key={i}>{i + 1}</span>)}</div>
          {onMore && <button type="button" className="pill locked-more" onClick={onMore}><Lock size={14} aria-hidden /> More stops · Members</button>}
        </section>

        <section className="filter-q" aria-labelledby="q-more">
          <h3 id="q-more">Stricter</h3>
          <label className="pref-row">
            <span><b>Avoid chains</b><span className="fine">Only independent shops, cafés and restaurants. Temples and parks aren't affected.</span></span>
            <input type="checkbox" role="switch" className="switch" checked={prefs.noChains} onChange={(e) => set({ noChains: e.target.checked })} />
          </label>
        </section>

        <div className="filters-foot">
          <p className="fine summary-line">{filterSummary(prefs)}</p>
          <div className="row between">
            <button type="button" className="link" onClick={() => set({ interests: DEFAULT_PREFS.interests, meals: [], picks: [], maxStops: null, noChains: false })}>Clear all</button>
            <button type="button" className="btn" onClick={() => { apply(prefs); onClose(); }}>Show plans</button>
          </div>
        </div>
    </Modal>
  );
}
