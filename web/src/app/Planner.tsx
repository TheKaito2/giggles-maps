import type { ReactNode } from "react";
import { ArrowLeftRight, Bike, Car, Castle, Clock, Coffee, Footprints, Landmark, Leaf, LocateFixed, MapPin,
  ShoppingBag, SlidersHorizontal, Sparkles, Star, UtensilsCrossed } from "lucide-react";
import type { Interest, TravelMode } from "../lib/api";
import PlaceSearch from "./PlaceSearch";
import { DEPARTS, INTERESTS, MAX_BUDGET, MODES, type Place, type Prefs, PRICES, RATINGS, ratingLabel } from "./prefs";

const MODE_ICON: Record<TravelMode, ReactNode> = {
  pedestrian: <Footprints size={16} aria-hidden />, auto: <Car size={16} aria-hidden />, bicycle: <Bike size={16} aria-hidden />,
};
const INTEREST_ICON: Record<Interest, ReactNode> = {
  food: <UtensilsCrossed size={22} aria-hidden />, culture: <Landmark size={22} aria-hidden />, nature: <Leaf size={22} aria-hidden />,
  cafes: <Coffee size={22} aria-hidden />, shopping: <ShoppingBag size={22} aria-hidden />, landmarks: <Castle size={22} aria-hidden />,
};
const QUICK_TIMES = [15, 30, 45, 60];
const SCALE = [15, 60, 120, 180, 240];

function Section({ icon, title, aside, children }: { icon: ReactNode; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="form-section">
      <div className="section-head">
        <span className="section-icon">{icon}</span>
        <h2>{title}</h2>
        {aside && <span className="fine section-aside">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

interface Props {
  prefs: Prefs;
  set: (patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) => void;
  origin: Place | null;
  dest: Place | null;
  setOrigin: (p: Place) => void;
  setDest: (p: Place) => void;
  swap: () => void;
  pickOnMap: (which: "origin" | "dest") => void;
  useMyLocation: () => void;
}

export default function Planner({ prefs, set, origin, dest, setOrigin, setDest, swap, pickOnMap, useMyLocation }: Props) {
  const toggleInterest = (id: Interest) =>
    set((p) => ({ interests: p.interests.includes(id) ? p.interests.filter((i) => i !== id) : [...p.interests, id] }));
  const budget = Math.min(prefs.budget, MAX_BUDGET);
  const pct = ((budget - 15) / (MAX_BUDGET - 15)) * 100;

  return (
    <div className="glass planner">
      <Section icon={<MapPin size={18} aria-hidden />} title="Your journey">
        <div className="journey">
          <div className="journey-point">
            {/* key: remount with the new name after a swap or a map pick */}
            <PlaceSearch key={`o-${origin?.name}`} label="Starting point" initial={origin?.name} onPick={(point, name) => setOrigin({ point, name })} />
            <div className="row tight">
              <button type="button" className="link" onClick={useMyLocation}><LocateFixed size={14} aria-hidden /> Use my location</button>
              <button type="button" className="link" onClick={() => pickOnMap("origin")}>Set on map</button>
            </div>
          </div>
          <button type="button" className="swap" onClick={swap} aria-label="Swap start and destination"><ArrowLeftRight size={16} aria-hidden /></button>
          <div className="journey-point">
            <PlaceSearch key={`d-${dest?.name}`} label="Destination" tone="end" initial={dest?.name} onPick={(point, name) => setDest({ point, name })} />
            <div className="row tight">
              <button type="button" className="link" onClick={() => pickOnMap("dest")}>Set on map</button>
            </div>
          </div>
        </div>

        <div className="row between travel">
          <div className="field">
            <span id="travel-label">Travel by</span>
            <div className="seg" role="radiogroup" aria-labelledby="travel-label">
              {MODES.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={prefs.mode === m.id} className={prefs.mode === m.id ? "on" : ""}
                  onClick={() => set({ mode: m.id })}>{MODE_ICON[m.id]} {m.label}</button>
              ))}
            </div>
          </div>
          <label className="field depart">
            <span>Depart</span>
            <select value={prefs.depart} onChange={(e) => set({ depart: e.target.value as Prefs["depart"] })}>
              {DEPARTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            {prefs.depart === "custom" && (
              <input type="time" aria-label="Departure time" value={prefs.time} onChange={(e) => set({ time: e.target.value })} />
            )}
          </label>
        </div>
      </Section>

      <Section icon={<Clock size={18} aria-hidden />} title="Time for discovery">
        <div className="row between baseline">
          <label htmlFor="budget" className="muted">How much extra time do you have?</label>
          <span className="budget-value"><b className="num">{budget}</b> minutes</span>
        </div>
        <input id="budget" className="range" type="range" min={15} max={MAX_BUDGET} step={5} value={budget}
          style={{ ["--pct" as string]: `${pct}%` }} onChange={(e) => set({ budget: Number(e.target.value) })} />
        <div className="scale fine num" aria-hidden>{SCALE.map((m) => <span key={m}>{m} min</span>)}</div>
        <div className="row tight">
          {QUICK_TIMES.map((m) => (
            <button key={m} type="button" className={`pill ${budget === m ? "on" : ""}`} aria-pressed={budget === m} onClick={() => set({ budget: m })}>
              {m === 60 ? "1 hour" : `${m} min`}
            </button>
          ))}
        </div>
        <p className="fine note"><Clock size={13} aria-hidden /> Includes extra travel and time spent at your stops.</p>
      </Section>

      <Section icon={<Sparkles size={18} aria-hidden />} title="What draws you in?" aside="Choose more than one">
        <div className="interests">
          {INTERESTS.map((i) => {
            const on = prefs.interests.includes(i.id);
            return (
              <button key={i.id} type="button" className={`interest ${on ? "on" : ""}`} aria-pressed={on} onClick={() => toggleInterest(i.id)}>
                {INTEREST_ICON[i.id]}<span>{i.label}</span>
              </button>
            );
          })}
          <button type="button" className={`interest surprise ${prefs.interests.length === 0 ? "on" : ""}`}
            aria-pressed={prefs.interests.length === 0} onClick={() => set({ interests: [] })}>
            <Sparkles size={22} aria-hidden /><span>Surprise me</span>
          </button>
        </div>
      </Section>

      <Section icon={<SlidersHorizontal size={18} aria-hidden />} title="Make it your kind of detour">
        <div className="prefs-grid">
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
            <span>Include places without ratings</span>
            <input type="checkbox" role="switch" className="switch" checked={prefs.includeUnrated}
              onChange={(e) => set({ includeUnrated: e.target.checked })} />
          </label>
        </div>
        <p className="fine">Higher rating filters may leave out newer local discoveries. Places with no listed price stay in, marked "price not listed".</p>
      </Section>
    </div>
  );
}

