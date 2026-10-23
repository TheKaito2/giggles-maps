import type { ReactNode } from "react";
import { ArrowUpDown, Bike, Car, Footprints, LocateFixed, MapPinned } from "lucide-react";
import type { TravelMode } from "../lib/api";
import PlaceSearch from "./PlaceSearch";
import Customize from "./Customize";
import { BUDGETS, budgetLabel, DEPARTS, MEALS, MODES, type Place, type Prefs } from "./prefs";

const MODE_ICON: Record<TravelMode, ReactNode> = {
  pedestrian: <Footprints size={16} aria-hidden />, auto: <Car size={16} aria-hidden />, bicycle: <Bike size={16} aria-hidden />,
};

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

/** The plan form: From/To, how, extra time; everything else folds into Customize. */
export default function Planner({ prefs, set, origin, dest, setOrigin, setDest, swap, pickOnMap, useMyLocation }: Props) {
  const mapButton = (which: "origin" | "dest") => (
    <button type="button" className="icon-btn" onClick={() => pickOnMap(which)} aria-label={`Pick ${which === "origin" ? "start" : "destination"} on the map`} title="Pick on map">
      <MapPinned size={16} aria-hidden />
    </button>
  );
  return (
    <div className="planner">
      <div className="endpoints">
        <PlaceSearch label="Start" value={origin?.name ?? ""} near={dest?.point} pin={<span className="dot start" aria-hidden>A</span>}
          onPick={(point, name) => setOrigin({ point, name })}
          actions={<>
            <button type="button" className="icon-btn" onClick={useMyLocation} aria-label="Use my location" title="Use my location"><LocateFixed size={16} aria-hidden /></button>
            {mapButton("origin")}
          </>} />
        <PlaceSearch label="Destination" value={dest?.name ?? ""} near={origin?.point} pin={<span className="dot end" aria-hidden>B</span>}
          onPick={(point, name) => setDest({ point, name })} actions={mapButton("dest")} />
        <button type="button" className="swap" onClick={swap} aria-label="Swap start and destination" title="Swap"><ArrowUpDown size={15} aria-hidden /></button>
      </div>

      <div className="row how">
        <div className="seg" role="radiogroup" aria-label="Travel by">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={prefs.mode === m.id} className={prefs.mode === m.id ? "on" : ""}
              onClick={() => set({ mode: m.id })}>{MODE_ICON[m.id]} {m.label}</button>
          ))}
        </div>
        <select aria-label="Leaving" value={prefs.depart} onChange={(e) => set({ depart: e.target.value as Prefs["depart"] })}>
          {DEPARTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        {prefs.depart === "custom" && (
          <input type="time" aria-label="Departure time" value={prefs.time} onChange={(e) => set({ time: e.target.value })} />
        )}
      </div>

      <div className="field">
        <span id="extra-label">Extra time <b className="budget-now">{prefs.budget === "auto" ? "Auto" : `+${budgetLabel(prefs.budget)}`}</b> <span className="fine">{prefs.budget === "auto" ? "about half your direct trip" : "road + time at stops"}</span></span>
        <div className="chips-scroll" role="radiogroup" aria-labelledby="extra-label">
          {BUDGETS.map((m) => (
            <button key={String(m)} type="button" role="radio" aria-checked={prefs.budget === m} className={`pill ${prefs.budget === m ? "on" : ""}`}
              onClick={() => set({ budget: m })}>{budgetLabel(m)}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <span id="meal-label">Stop for a meal?</span>
        <div className="chips-scroll" role="group" aria-labelledby="meal-label">
          <button type="button" className={`pill ${prefs.meals.length === 0 ? "on" : ""}`} aria-pressed={prefs.meals.length === 0}
            onClick={() => set({ meals: [] })}>No</button>
          {MEALS.map((m) => {
            const on = prefs.meals.includes(m.id);
            return (
              <button key={m.id} type="button" className={`pill ${on ? "on" : ""}`} aria-pressed={on} title={`Arrive at a food stop between ${m.window}`}
                onClick={() => set((p) => ({ meals: on ? p.meals.filter((x) => x !== m.id) : [...p.meals, m.id] }))}>{m.label}</button>
            );
          })}
        </div>
      </div>

      <Customize prefs={prefs} set={set} near={origin?.point ?? null} />
    </div>
  );
}
