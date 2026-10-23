import { useEffect, useRef, useState } from "react";
import { Coffee, Landmark, type LucideIcon, ShoppingBag, Sparkles, Trees, UtensilsCrossed, X } from "lucide-react";
import type { Interest, LatLng } from "../lib/api";
import ExplorePlaces from "./ExplorePlaces";
import { DEFAULT_PREFS, filterSummary, INTERESTS, MEALS, type Prefs } from "./prefs";

export const KIND_ICON: Record<Interest, LucideIcon> = {
  culture: Landmark, nature: Trees, food: UtensilsCrossed, cafes: Coffee, shopping: ShoppingBag, landmarks: Sparkles,
};

/** How many filters are on (shown on the More button). */
export function filterCount(p: Prefs): number {
  return [p.interests.length > 0, p.maxStops != null, p.picks.length > 0, p.meals.length > 0, p.openOnly, p.noChains].filter(Boolean).length;
}

/** All the ways to shape your stops, each a plain question. Edits a draft; "Show plans" applies it
 *  (each change re-plans every time option, so not on every tap). */
export default function Filters({ prefs: start, apply, near, onClose }: { prefs: Prefs; apply: (p: Prefs) => void; near: LatLng | null; onClose: () => void }) {
  const [prefs, setDraft] = useState(start);
  const set = (patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) =>
    setDraft((p) => ({ ...p, ...(typeof patch === "function" ? patch(p) : patch) }));
  const box = useRef<HTMLDivElement>(null);
  // focus moves in on open, Escape closes, focus returns to the button that opened it
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("h2")?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("keydown", esc); back?.focus(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: Interest) =>
    set((p) => ({ interests: p.interests.includes(id) ? p.interests.filter((i) => i !== id) : [...p.interests, id] }));

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="filters-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal filters" ref={box}>
        <header className="modal-head"><h2 id="filters-title" tabIndex={-1}>Your stops</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close without changes"><X size={20} /></button></header>

        <section className="filter-q" aria-labelledby="q-kinds">
          <h3 id="q-kinds">What kind of stops?</h3>
          <p className="fine">Pick some and every plan uses only those. Pick none for a mix of everything.</p>
          <div className="kind-tiles">
            {INTERESTS.map((i) => {
              const Icon = KIND_ICON[i.id], on = prefs.interests.includes(i.id);
              return <button key={i.id} type="button" className={`kind-tile${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(i.id)}>
                <Icon size={22} aria-hidden /><span>{i.label}</span></button>;
            })}
          </div>
        </section>

        <section className="filter-q" aria-labelledby="q-meal">
          <h3 id="q-meal">Stop to eat?</h3>
          <p className="fine">We add a restaurant you reach inside the meal time.</p>
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
          <h3 id="q-picks">Anywhere you must visit?</h3>
          <p className="fine">These go into every plan when there's time.</p>
          <ExplorePlaces near={near} picks={prefs.picks} setPicks={(picks) => set({ picks })} />
        </section>

        <section className="filter-q" aria-labelledby="q-stops">
          <h3 id="q-stops">How many stops? <b className="num stops-now">{prefs.maxStops ? `Up to ${prefs.maxStops}` : "As many as fit"}</b></h3>
          <input type="range" min={0} max={6} step={1} value={prefs.maxStops ?? 0} aria-labelledby="q-stops"
            aria-valuetext={prefs.maxStops ? `Up to ${prefs.maxStops} stops` : "As many as fit"}
            onChange={(e) => set({ maxStops: Number(e.target.value) || null })} />
          <div className="range-ticks fine" aria-hidden><span>Any</span>{[1, 2, 3, 4, 5, 6].map((n) => <span key={n}>{n}</span>)}</div>
        </section>

        <section className="filter-q" aria-labelledby="q-more">
          <h3 id="q-more">Stricter</h3>
          <label className="pref-row">
            <span><b>Avoid chains</b><span className="fine">Only independent shops, cafés and restaurants. Temples and parks aren't affected.</span></span>
            <input type="checkbox" role="switch" className="switch" checked={prefs.noChains} onChange={(e) => set({ noChains: e.target.checked })} />
          </label>
          <label className="pref-row">
            <span><b>Only places with known opening hours</b><span className="fine">So you never arrive at a closed door. Few small-town places list hours, so you'll get fewer stops.</span></span>
            <input type="checkbox" role="switch" className="switch" checked={prefs.openOnly} onChange={(e) => set({ openOnly: e.target.checked })} />
          </label>
        </section>

        <div className="filters-foot">
          <p className="fine summary-line">{filterSummary(prefs)}</p>
          <div className="row between">
            <button type="button" className="link" onClick={() => set({ interests: DEFAULT_PREFS.interests, meals: [], picks: [], maxStops: null, openOnly: false, noChains: false })}>Clear all</button>
            <button type="button" className="btn" onClick={() => { apply(prefs); onClose(); }}>Show plans</button>
          </div>
        </div>
      </div>
    </div>
  );
}
