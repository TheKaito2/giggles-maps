import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { Route, Share2, X } from "lucide-react";
import { SITE, type SharedTrip, viewSharedTrip } from "../lib/api";
import { shareOrCopy } from "../lib/native";
import { useDialog } from "../lib/useDialog";
import { nameOf } from "../lib/i18n";
import { SAKON } from "../lib/demoGps";
import Avatar from "./social/Avatar";
import { Spinner } from "./Skeleton";
import { styleUrl } from "./mapLayers";
import { kindOf } from "./kinds";
import { budgetLabel } from "./prefs";

const pin = (cls: string, text: string, label: string) => {
  const el = document.createElement("span");
  el.className = `pin ${cls}`; el.textContent = text; el.setAttribute("aria-label", label);
  return el;
};

/** A shared trip page (/app/?trip=ID): the route, its numbered stops and times, read-only. "Plan this trip" loads it into
 *  the normal detour flow, planned again from your own start time. */
export default function TripView({ id, onClose, onPlan }: { id: string; onClose: () => void; onPlan: (t: SharedTrip) => void }) {
  const dialog = useDialog(onClose);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [trip, setTrip] = useState<SharedTrip | null | undefined>(undefined);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    map.current = new maplibregl.Map({ container: box.current!, style: styleUrl("liberty", false), center: [SAKON.lng, SAKON.lat], zoom: 12,
      attributionControl: { compact: true } });
    viewSharedTrip(id).then(setTrip).catch(() => setTrip(null));
    return () => { map.current?.remove(); };
  }, [id]);
  useEffect(() => {
    const m = map.current;
    if (!m || !trip) return;
    const marks: maplibregl.Marker[] = [];
    const add = (el: HTMLElement, lng: number, lat: number) => marks.push(new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(m));
    if (trip.origin.lat != null && trip.origin.lng != null) add(pin("start", "A", "Start"), trip.origin.lng, trip.origin.lat);
    add(pin("end", "B", "Destination"), trip.dest.lng, trip.dest.lat);
    trip.stops.forEach((s, i) => add(pin("stop", String(i + 1), `Stop ${i + 1}: ${s.name}`), s.lng, s.lat));
    const draw = () => {
      if (m.getSource("shared")) return;
      if (!m.isStyleLoaded()) { m.once("idle", draw); return; }   // "load" may have passed already while tiles still load
      m.addSource("shared", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: trip.geometry } } });
      m.addLayer({ id: "shared-casing", type: "line", source: "shared", paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.9 }, layout: { "line-cap": "round", "line-join": "round" } });
      m.addLayer({ id: "shared", type: "line", source: "shared", paint: { "line-color": "#0864c0", "line-width": 5 }, layout: { "line-cap": "round", "line-join": "round" } });
    };
    draw();
    const b = trip.geometry.reduce((acc, p) => acc.extend(p), new maplibregl.LngLatBounds(trip.geometry[0], trip.geometry[0]));
    // clear of the bottom panel (55vh at most); fitBounds throws when the map is smaller than its padding (a landscape phone)
    if (m.getContainer().clientHeight > 360 && m.getContainer().clientWidth > 200)
      m.fitBounds(b, { padding: { top: 110, bottom: m.getContainer().clientHeight * 0.55 + 20, left: 40, right: 40 }, maxZoom: 15, duration: 600 });
    else m.easeTo({ center: b.getCenter(), zoom: 11 });
    return () => marks.forEach((x) => x.remove());
  }, [trip]);
  const share = async () => {
    if (trip && await shareOrCopy(trip.title, `${SITE}/app/?trip=${trip.id}`) === "copied") setMsg("Link copied.");
  };
  return (
    <div className="nav-mode trip-page" role="dialog" aria-modal="true" aria-label="Shared trip" ref={dialog} tabIndex={-1}>
      <div ref={box} className="nav-map" />
      <div className="nav-top">
        {trip === undefined ? <b><Spinner size={18} /> Loading the trip…</b> : trip === null ? <b>This trip isn't shared any more.</b> : <>
          {trip.who && <Avatar name={trip.who.nickname} colour={trip.who.colour} avatar={trip.who.avatar} size={44} />}
          <span className="nav-turn"><b translate="no">{trip.title}</b>
            <span>{trip.who ? <>Shared by <span translate="no">{trip.who.nickname}</span></> : "A shared trip"}</span></span>
        </>}
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
      </div>
      {trip && <div className="nav-bottom">
        <p className="trip-figures">
          <span><b className="num">{trip.stops.length}</b> <small>{trip.stops.length === 1 ? "stop" : "stops"}</small></span>
          <span><b className="num">+{trip.extra_min}</b> <small>min vs straight</small></span>
          <span><b className="num">{trip.total_min}</b> <small>min trip</small></span></p>
        <ol className="stop-rows">
          {trip.stops.map((s, i) => <li key={s.id} className="stop-row">
            <span className="stop-num" aria-hidden>{i + 1}</span>
            <span className="stop-text"><b>{nameOf(s)}</b>
              <span className="stop-meta"><b className="num">+{budgetLabel(s.arrive_min)}</b><span className="fine">{kindOf(null, s.category).en}</span></span>
              <span className="fine num stop-leg">{`${s.dwell_min} min there`}</span></span>
          </li>)}
          <li className="stop-row dest-row"><span className="stop-num dest" aria-hidden>B</span>
            <span className="stop-text"><b translate="no">{trip.dest.name.split(", ")[0]}</b>
              <span className="stop-meta"><b className="num">+{budgetLabel(trip.total_min)}</b><span className="fine">Arrive</span></span></span></li>
        </ol>
        <p className="fine">Times count from when you leave.</p>
        {msg && <p className="fine" role="status">{msg}</p>}
        <div className="row">
          <button type="button" className="btn big find" onClick={() => onPlan(trip)}><Route size={18} aria-hidden /> Plan this trip</button>
          <button type="button" className="btn soft" onClick={share}><Share2 size={16} aria-hidden /> Share</button>
        </div>
      </div>}
    </div>
  );
}
