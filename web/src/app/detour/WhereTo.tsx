import { Car, MapPinned, Plus, Search } from "lucide-react";
import type { LatLng } from "../../lib/api";
import PlaceSearch from "../PlaceSearch";

/** Step 1, the sheet at rest: one "Where to?" search (start = your location), plus ride along and add a place. */
export default function WhereTo({ near, onPick, pickOnMap, addPlace, rideAlong, rideLive, onSearch }: {
  near: LatLng | null; onPick: (point: LatLng, name: string) => void; pickOnMap: () => void; addPlace: () => void;
  rideAlong: () => void; rideLive: number | null;
  onSearch: () => void;   // typing: the sheet grows so the suggestions have room
}) {
  return (
    <div className="where-to" onFocusCapture={(e) => { if ((e.target as HTMLElement).tagName === "INPUT") onSearch(); }}>
      <PlaceSearch label="Where to?" value="" near={near} pin={<Search size={20} aria-hidden className="where-icon" />} onPick={onPick}
        footer={<>
          <li><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={pickOnMap}>
            <span className="result-icon address"><MapPinned size={15} aria-hidden /></span><span className="result-text"><b>Pick on the map</b></span></button></li>
          <li><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={addPlace}>
            <span className="result-icon address"><Plus size={15} aria-hidden /></span><span className="result-text"><b>Can't find it? Add a place</b></span></button></li>
        </>} />
      <div className="quick-rows">
        <button type="button" className={`quick-row${rideLive ? " live" : ""}`} onClick={rideAlong}>
          <span className="result-icon"><Car size={16} aria-hidden /></span>
          <span className="result-text"><b>{rideLive ? `Ride along · ${rideLive} on this trip` : "Ride along"}</b><span className="fine">Travel with friends: +50% XP each, shared album</span></span>
        </button>
        <button type="button" className="quick-row" onClick={addPlace}>
          <span className="result-icon"><Plus size={16} aria-hidden /></span>
          <span className="result-text"><b>Add a missing place</b><span className="fine">A shop or sight that isn't on the map yet</span></span>
        </button>
      </div>
    </div>
  );
}
