import maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, Camera, CornerUpLeft, CornerUpRight, FastForward, Flag, Languages, Share2, SkipForward, Volume2, VolumeX, X } from "lucide-react";
import { demoOn, moveTo } from "../../lib/demoGps";
import { type Avoid, getNavRoute, type LatLng, type NavRoute, shareEta, SITE, stopEta, type TravelMode, tripPing } from "../../lib/api";
import { cumulative, dueCall, type Progress, progress } from "./progress";
import { say } from "./thai";
import { isNight, loadLook, styleUrl } from "../mapLayers";
import { metres } from "../useStops";
import { Spinner } from "../Skeleton";
import { buzz, shareLink } from "../../lib/native";

export interface Waypoint extends LatLng { name: string; id?: number }   // id: a place you can check in at
const ARRIVE_M = 50;   // this close to a stop counts as there: the arrival card comes up
const LEAVE_M = 100;   // this far from it again: you drove on, the card goes away (twice ARRIVE_M so GPS jitter doesn't flicker it)
const OFF_ROUTE_M = 60, OFF_ROUTE_S = 10, REROUTE_GAP_S = 20;
// announce a turn this far ahead, then again closer, then at the turn
const CALLS: Record<TravelMode, number[]> = { auto: [800, 200, 0], bicycle: [300, 80, 0], pedestrian: [150, 40, 0] };
const fmtM = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;
const clock = (min: number) => new Date(Date.now() + min * 60000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function TurnIcon({ type }: { type: number }) {
  if ([10, 11, 18, 20, 23, 37].includes(type)) return <ArrowRight size={34} />;
  if ([15, 14, 19, 21, 24, 38].includes(type)) return <ArrowLeft size={34} />;
  if (type === 9) return <CornerUpRight size={34} />;
  if (type === 16) return <CornerUpLeft size={34} />;
  if ([4, 5, 6].includes(type)) return <Flag size={34} />;
  return <ArrowUp size={34} />;
}

/**
 * On-device turn-by-turn: follows your GPS along the road route, speaks each turn (Thai or English), reroutes when you
 * leave the route, keeps the screen on, and can share a live ETA link. Waypoints = the stops left, then the destination.
 * At each stop an arrival card offers to check in, which leaves directions (`onCheckin` gets the stop and what's left).
 */
export default function Navigate({ waypoints, mode, onClose, onCheckin }: {
  waypoints: Waypoint[]; mode: TravelMode; onClose: () => void; onCheckin: (stop: Waypoint, rest: Waypoint[]) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const me = useRef<maplibregl.Marker | null>(null);
  const [route, setRoute] = useState<NavRoute | null>(null);
  const [left, setLeft] = useState(waypoints);   // waypoints not reached yet
  const [here, setHere] = useState<LatLng | null>(null);
  const [prog, setProg] = useState<Progress | null>(null);
  const [lang, setLang] = useState<"th" | "en">(() => navigator.language.startsWith("th") ? "th" : "en");
  const [muted, setMuted] = useState(false);
  const [avoid, setAvoid] = useState<Avoid>({});
  const [msg, setMsg] = useState("");
  const [share, setShare] = useState<string | null>(null);
  const cum = useMemo(() => route ? cumulative(route.shape) : [], [route]);
  const offSince = useRef<number | null>(null), lastReroute = useRef(0), said = useRef(new Set<string>()), lastIndex = useRef(0);
  const legsDone = useRef(0);   // legs of the current route already finished (each leg ends at a stop)
  const [atStop, setAtStop] = useState<Waypoint | null>(null);   // the stop you just reached: the arrival card
  const greeted = useRef(new Set<Waypoint>());

  const speak = (text: string) => {
    if (muted || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === "th" ? "th-TH" : "en-GB";
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  };
  const busy = useRef(false);   // one route request at a time (GPS fixes keep arriving while it loads)
  const plan = (from: LatLng, to = left) => {
    if (busy.current) return;
    busy.current = true;
    getNavRoute([from, ...to], mode, avoid)
      .then((r) => { setRoute(r); lastIndex.current = 0; legsDone.current = 0; said.current.clear(); setMsg(""); })
      .catch(() => setMsg("Couldn't get directions. Retrying when you move."))
      .finally(() => { busy.current = false; });
  };

  // map, GPS and wake lock for the life of nav mode
  useEffect(() => {
    const m = new maplibregl.Map({ container: box.current!, style: styleUrl("liberty", isNight(loadLook().night)), zoom: 16, pitch: 50,
      center: [waypoints[0].lng, waypoints[0].lat], attributionControl: { compact: true } });
    m.on("load", () => {
      m.addSource("nav", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "nav-casing", type: "line", source: "nav", paint: { "line-color": "#fff", "line-width": 12 }, layout: { "line-cap": "round", "line-join": "round" } });
      m.addLayer({ id: "nav-line", type: "line", source: "nav", paint: { "line-color": "#2f7bf5", "line-width": 7 }, layout: { "line-cap": "round", "line-join": "round" } });
    });
    const el = document.createElement("span"); el.className = "nav-me";
    me.current = new maplibregl.Marker({ element: el, rotationAlignment: "map" }).setLngLat([waypoints[0].lng, waypoints[0].lat]).addTo(m);
    map.current = m;
    const watch = navigator.geolocation.watchPosition((p) => setHere({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setMsg("Location is off: turn it on to navigate."), { enableHighAccuracy: true, maximumAge: 2000 });
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => undefined);
    return () => { navigator.geolocation.clearWatch(watch); lock?.release().catch(() => undefined); speechSynthesis?.cancel(); m.remove(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // first route from the first GPS fix; again when you change what to avoid
  useEffect(() => { if (here && (!route || msg)) plan(here); }, [here]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (here && route) plan(here); }, [avoid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const src = map.current?.getSource("nav") as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: route ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route.shape } }] : [] });
  }, [route]);

  // close to the next stop: say so once and bring up the arrival card
  useEffect(() => {
    const next = left[0];
    if (!here || !next || greeted.current.has(next) || metres(here, next) > ARRIVE_M) return;
    greeted.current.add(next); setAtStop(next);
    buzz("done");
    speak(lang === "th" ? `ถึง ${next.name} แล้ว` : `You've arrived at ${next.name}`);
  }, [here, left]); // eslint-disable-line react-hooks/exhaustive-deps
  // demo mode: drive along the route to the next stop in a few seconds, so the map, the voice and the arrival card all play out
  const [driving, setDriving] = useState(false);
  const drive = useRef<number | null>(null);
  useEffect(() => () => { if (drive.current) clearInterval(drive.current); }, []);
  const fastForward = () => {
    const target = left[0];
    if (!route || !target || driving) return;
    let end = route.shape.length - 1, best = Infinity;   // the route point nearest the stop
    route.shape.forEach(([lng, lat], i) => { const d = metres({ lat, lng }, target); if (i >= lastIndex.current && d < best) { best = d; end = i; } });
    const path = route.shape.slice(lastIndex.current, end + 1);
    const steps = Math.min(40, path.length), at = (k: number) => path[Math.round((k * (path.length - 1)) / Math.max(steps - 1, 1))];
    let k = 0;
    setDriving(true);
    drive.current = window.setInterval(() => {
      if (k < steps) { const [lng, lat] = at(k++); moveTo({ lat, lng }); return; }
      clearInterval(drive.current!); drive.current = null; setDriving(false);
      moveTo({ lat: target.lat, lng: target.lng });
    }, 120);
  };
  // driving on past the stop closes its card by itself (counts as skipping it), so the road gets your attention back
  useEffect(() => { if (atStop && here && metres(here, atStop) > LEAVE_M) keepGoing(); }, [here]); // eslint-disable-line react-hooks/exhaustive-deps
  const keepGoing = () => {   // skip checking in here: on to the next stop
    const rest = left.filter((w) => w !== atStop);
    setAtStop(null);
    if (rest.length && rest.length !== left.length) { setLeft(rest); if (here) plan(here, rest); }
  };

  // every fix and every new route: where am I on the route, what to say, am I off route, did I reach a stop
  useEffect(() => {
    if (!here || !route) return;
    const p = progress(route, cum, here, lastIndex.current);
    const prevPoint = prog?.point;
    lastIndex.current = p.index; setProg(p);
    me.current?.setLngLat(p.offM < OFF_ROUTE_M ? p.point : [here.lng, here.lat]);
    const bearing = prevPoint ? (Math.atan2(p.point[0] - prevPoint[0], p.point[1] - prevPoint[1]) * 180) / Math.PI : map.current?.getBearing();
    map.current?.easeTo({ center: p.point, bearing: bearing ?? 0, duration: 800 });

    if (p.offM > OFF_ROUTE_M) {
      offSince.current ??= Date.now();
      if (Date.now() - offSince.current > OFF_ROUTE_S * 1000 && Date.now() - lastReroute.current > REROUTE_GAP_S * 1000) {
        lastReroute.current = Date.now(); offSince.current = null;
        speak(lang === "th" ? "กำลังหาเส้นทางใหม่" : "Rerouting"); plan(here);
      }
      return;
    }
    offSince.current = null;
    // finished a leg = reached a stop: drop it from what's left (a reroute starts counting again)
    const done = route.legEnds.findIndex((e) => e >= p.index);
    if (done > legsDone.current && left.length > 1) {
      const reached = left[done - legsDone.current - 1] ?? left[0];
      setLeft(left.slice(done - legsDone.current)); legsDone.current = done;
      if (!greeted.current.has(reached) && metres(here, reached) <= LEAVE_M) { greeted.current.add(reached); setAtStop(reached); speak(lang === "th" ? `ถึง ${reached.name} แล้ว` : `You've reached ${reached.name}`); }
    }
    if (p.next != null) {
      const mv = route.maneuvers[p.next];
      const call = dueCall(CALLS[mode], p.toNextM);
      const key = (c: number) => `${route.timeS}:${p.next}:${c}`;
      if (call != null && !said.current.has(key(call))) {
        CALLS[mode].filter((c) => c >= call).forEach((c) => said.current.add(key(c)));   // never repeat an earlier call after a later one
        speak(say(mv, call === 0 ? 0 : p.toNextM, lang));
      }
    }
  }, [here, route]); // eslint-disable-line react-hooks/exhaustive-deps

  // live ETA link: keep the arrival time and your position fresh while sharing
  const remainingMin = route && prog ? (route.timeS / 60) * (prog.remainingM / Math.max(route.distanceM, 1)) : null;
  useEffect(() => {
    if (!share || !here) return;
    const dest = left[left.length - 1];
    const t = setInterval(() => {
      tripPing(here).catch(() => undefined);
      if (remainingMin != null) shareEta(dest, remainingMin, true).then((t) => { if (!t) setShare(null); }).catch(() => undefined);
    }, 30000);
    return () => clearInterval(t);
  }, [share, here, remainingMin]); // eslint-disable-line react-hooks/exhaustive-deps
  const startShare = async () => {
    const dest = left[left.length - 1];
    try {
      const token = await shareEta(dest, remainingMin ?? 30);
      if (!token) throw new Error("no token");
      if (here) await tripPing(here).catch(() => undefined);
      const url = `${SITE}/app/?eta=${token}`;
      setShare(url);
      if (!await shareLink(`My trip to ${dest.name}`, url)) navigator.clipboard?.writeText(url).then(() => setMsg("Link copied: anyone with it can follow your trip until you stop."));
    } catch { setMsg("Couldn't start sharing."); }
  };
  const end = () => { if (share) stopEta().catch(() => undefined); onClose(); };

  const mv = route && prog?.next != null ? route.maneuvers[prog.next] : null;
  const arrived = !!prog && prog.remainingM < 25 && left.length <= 1;
  return (
    <div className="nav-mode" role="dialog" aria-modal="true" aria-label="Navigation">
      <div ref={box} className="nav-map" />
      <div className="nav-top" aria-live="polite">
        {atStop || arrived ? <><Flag size={34} /><b>You've arrived at {(atStop ?? left[0])?.name}</b></>
          : mv && prog ? <><TurnIcon type={mv.type} /><span className="nav-turn"><b className="num">{fmtM(prog.toNextM)}</b>
              <span>{lang === "th" ? say(mv, 0, "th") : mv.instruction}</span></span></>
          : <b>{msg || <><Spinner size={18} /> Finding your route…</>}</b>}
      </div>
      {prog && prog.offM > OFF_ROUTE_M && !atStop && <p className="nav-off">Off route: we'll reroute you in a moment</p>}
      {atStop && (
        <div className="arrive-card nav-arrive" role="alertdialog" aria-labelledby="arrive-title">
          <span className="eyebrow">You've arrived</span>
          <b id="arrive-title">{atStop.name}</b>
          {atStop.id != null
            ? <><p className="fine">Directions pause while you check in.</p>
                <button type="button" className="btn big checkin-go" onClick={() => { if (share) stopEta().catch(() => undefined); onCheckin(atStop, left.filter((w) => w !== atStop)); }}>
                  <Camera size={20} aria-hidden /> Check in here</button></>
            : <p className="fine">That's the end of the route. End directions and, if this place is a stop, its check-in is right there on the map.</p>}
          {left.filter((w) => w !== atStop).length > 0
            ? <button type="button" className="btn soft" onClick={keepGoing}><SkipForward size={16} aria-hidden /> Skip, go to {left.filter((w) => w !== atStop)[0].name}</button>
            : <button type="button" className="btn soft" onClick={end}><X size={16} aria-hidden /> End directions</button>}
          <p className="fine arrive-note">This card closes by itself when you drive on.</p>
        </div>
      )}
      <div className="nav-bottom">
        <div className="nav-eta">
          {remainingMin != null && <><b className="num">{clock(remainingMin)}</b><span className="fine num">{Math.round(remainingMin)} min · {fmtM(prog!.remainingM)}</span></>}
          {left.length > 1 && <span className="fine">Next stop: {left[0].name}</span>}
        </div>
        <div className="row">
          <button type="button" className="icon-btn" onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute voice" : "Mute voice"}>{muted ? <VolumeX /> : <Volume2 />}</button>
          <button type="button" className="icon-btn" onClick={() => setLang(lang === "th" ? "en" : "th")} aria-label="Voice language"><Languages /><span className="fine">{lang.toUpperCase()}</span></button>
          <button type="button" className={`icon-btn${share ? " on" : ""}`} onClick={startShare} aria-label="Share live ETA"><Share2 /></button>
          {demoOn() && left[0] && !atStop && <button type="button" className="btn small demo-ff" onClick={fastForward} disabled={!route || driving}>
            <FastForward size={16} aria-hidden /> {driving ? "Driving…" : `Demo: to ${left[0].name.split(" (")[0].slice(0, 18)}`}</button>}
          <button type="button" className="btn danger-btn small" onClick={end}><X size={16} aria-hidden /> End</button>
        </div>
        {mode === "auto" && <div className="row nav-avoid">
          {(["tolls", "highways", "ferries"] as const).map((k) => <label key={k} className="toggle"><input type="checkbox" checked={!!avoid[k]}
            onChange={(e) => setAvoid({ ...avoid, [k]: e.target.checked })} /><span>Avoid {k}</span></label>)}
        </div>}
        {share && <p className="fine">Sharing your trip live · <button type="button" className="link" onClick={() => { stopEta().catch(() => undefined); setShare(null); }}>Stop sharing</button></p>}
        {msg && <p className="fine" role="status">{msg}</p>}
      </div>
    </div>
  );
}
