import { myLocation } from "../../lib/demoGps";
import { type ReactNode, useState } from "react";
import { ArrowUpDown, Bike, Car, Footprints, LocateFixed, SlidersHorizontal, X } from "lucide-react";
import type { RoutePlan, TravelMode } from "../../lib/api";
import PlaceSearch from "../PlaceSearch";
import Filters, { filterCount, KIND_ICON } from "../Customize";
import { BUDGETS, budgetLabel, DEPARTS, filterSummary, hhmm, INTERESTS, MODES, type Prefs, startMin } from "../prefs";
import { type Detour, PRESETS, type PresetId } from "./useDetour";
import { Thumb } from "./Results";
import PlanProgress from "./PlanProgress";

const MODE_ICON: Record<TravelMode, ReactNode> = {
  pedestrian: <Footprints size={16} aria-hidden />, auto: <Car size={16} aria-hidden />, bicycle: <Bike size={16} aria-hidden />,
};
export const arrive = (prefs: Prefs, r: RoutePlan) => hhmm(startMin(prefs) + r.total_min);

/** Where you're going, from where, and how: shared by the choose and results steps. */
export function TripHead({ d, onBack, backLabel, onSearch }: { d: Detour; onBack: () => void; backLabel: string; onSearch: () => void }) {
  return (
    <div className="trip-head" onFocusCapture={(e) => { if ((e.target as HTMLElement).tagName === "INPUT") onSearch(); }}>
      <div className="trip-top">
        {/* addresses come as "Place, Province": the place leads, the rest is a hint */}
        <h2 className="trip-to" title={d.dest?.name}><span className="fine">To</span> {d.dest?.name.split(", ")[0]}</h2>
        <button type="button" className="icon-btn" onClick={onBack} aria-label={backLabel}><X size={20} /></button>
      </div>
      <div className="from-row">
        <PlaceSearch label="From" value={d.locating ? "Finding your location…" : d.origin?.name ?? ""} near={d.dest?.point}
          pin={<span className="dot start" aria-hidden>A</span>} onPick={(point, name) => d.setOrigin({ point, name })}
          actions={<button type="button" className="icon-btn" aria-label="Start from my location"
            onClick={() => myLocation(
              (p) => d.setOrigin({ point: { lat: p.coords.latitude, lng: p.coords.longitude }, name: "Your location" }),
              () => d.notify("Location is blocked. Type where you're starting from instead."), { enableHighAccuracy: true, timeout: 10000 })}>
            <LocateFixed size={16} aria-hidden /></button>} />
        <button type="button" className="icon-btn" onClick={d.swap} aria-label="Swap start and destination" disabled={!d.origin}><ArrowUpDown size={16} aria-hidden /></button>
      </div>
    </div>
  );
}

/** Step 2: how you travel, when, and how much extra time (3 presets, each already planned). */
export default function Choose({ d, onPicked }: { d: Detour; onPicked: () => void }) {
  const [filters, setFilters] = useState(false);
  const n = filterCount(d.prefs);
  // all three are planned as soon as you pick where to; none is highlighted until you tap one
  const card = (id: PresetId, label: string, min: number | "auto", blurb: string) => {
    const r = d.results[id];
    const ready = r && typeof r === "object" && "route_id" in r ? r : null;
    const stops = ready ? (ready.plans?.[0]?.stops ?? ready.stops) : null;
    return (
      <button key={id} type="button" className={`preset${d.preset === id ? " on" : ""}`} aria-pressed={d.preset === id}
        onClick={() => { d.setPreset(id); onPicked(); }}>
        <span className="preset-top"><b>{label}</b><span className="num">{min === "auto" ? "Auto" : `+${budgetLabel(min)}`}</span></span>
        {r === "loading" ? <span className="preset-wait" role="status" aria-label="Planning"><i /><i /><i /></span>
          : r && !ready ? <span className="fine">{(r as { error: string }).error} <b className="retry">Tap to retry</b></span>
          : stops && <>
              <span className="thumbs" aria-hidden>{stops.slice(0, 3).map((s) => <Thumb key={s.id} s={s} size={28} />)}</span>
              <span className="fine">{stops.length ? `${stops.length} stop${stops.length === 1 ? "" : "s"} · arrive ${arrive(d.prefs, ready!)}` : "No stops fit"}</span>
            </>}
        <span className="fine blurb">{blurb}</span>
      </button>
    );
  };
  return (
    <div className="stack choose">
      <div className="seg" role="radiogroup" aria-label="Travel by">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={d.prefs.mode === m.id} className={d.prefs.mode === m.id ? "on" : ""}
            onClick={() => d.set({ mode: m.id })}>{MODE_ICON[m.id]} {m.label}</button>
        ))}
      </div>

      <div className="row between how">
        <span className="eyebrow">Extra time for stops</span>
        <span className="row tight">
          <select aria-label="Leaving" value={d.prefs.depart} onChange={(e) => d.set({ depart: e.target.value as Prefs["depart"] })}>
            {DEPARTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
          {d.prefs.depart === "custom" && <input type="time" aria-label="Departure time" value={d.prefs.time} onChange={(e) => d.set({ time: e.target.value })} />}
        </span>
      </div>
      {Object.values(d.results).some((r) => r === "loading") && <PlanProgress />}
      <div className="presets">
        {PRESETS.map((p) => card(p.id, p.label, p.min, p.blurb))}
      </div>
      {/* one tap narrows every plan to these kinds; More has meals, must-visits, stop count and stricter options */}
      <div className="filter-bar">
        <div className="chips-scroll" role="group" aria-label="Only these kinds of stops">
          {INTERESTS.map((i) => {
            const Icon = KIND_ICON[i.id], on = d.prefs.interests.includes(i.id);
            return <button key={i.id} type="button" className={`pill${on ? " on" : ""}`} aria-pressed={on}
              onClick={() => d.set((p) => ({ interests: on ? p.interests.filter((x) => x !== i.id) : [...p.interests, i.id] }))}>
              <Icon size={14} aria-hidden /> {i.label}</button>;
          })}
        </div>
        <p className="fine summary-line" aria-live="polite">{filterSummary(d.prefs)}</p>
      </div>
      <div className="row between">
        <label className="custom-time fine">Other time
          <select aria-label="Other amount of extra time" value="" onChange={(e) => { if (e.target.value) { d.pickCustom(e.target.value === "auto" ? "auto" : Number(e.target.value)); onPicked(); } }}>
            <option value="">Choose…</option>
            {BUDGETS.map((b) => <option key={String(b)} value={String(b)}>{b === "auto" ? "Auto (half the trip)" : `+${budgetLabel(b)}`}</option>)}
          </select>
        </label>
        <button type="button" className="btn soft small" onClick={() => setFilters(true)}>
          <SlidersHorizontal size={15} aria-hidden /> More filters{n ? ` · ${n}` : ""}</button>
      </div>
      {filters && <Filters prefs={d.prefs} apply={(p) => d.set(p)} near={d.origin?.point ?? null} onClose={() => setFilters(false)} />}
    </div>
  );
}
