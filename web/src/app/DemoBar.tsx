import { FastForward, X } from "lucide-react";
import type { LatLng } from "../lib/api";
import { demoAt, moveTo, setDemo } from "../lib/demoGps";

interface Spot extends LatLng { name: string; stamped?: boolean }
const metres = (a: LatLng, b: LatLng) => {
  const k = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot((a.lng - b.lng) * k, a.lat - b.lat) * 111_320;
};

/**
 * Demo mode banner on the map: tap the map to move yourself, or fast-forward to the next stop. With a plan open that's
 * the plan's next stop (then the destination); otherwise the nearest stop you haven't stamped.
 */
export default function DemoBar({ route, nearby }: { route: Spot[]; nearby: Spot[] }) {
  const next = (): Spot | null => {
    const here = demoAt();
    if (route.length) {
      const at = route.findIndex((s) => metres(here, s) < 40);   // standing at a stop: go to the one after it
      return at >= 0 ? route[at + 1] ?? null : route[0];
    }
    return nearby.filter((s) => !s.stamped && metres(here, s) > 40)
      .sort((a, b) => metres(here, a) - metres(here, b))[0] ?? null;
  };
  const target = next();
  return (
    <div className="demo-bar" role="status">
      <b>Demo mode</b><span className="fine">Tap the map to move you</span>
      <button type="button" className="btn small" disabled={!target} onClick={() => target && moveTo({ lat: target.lat, lng: target.lng })}
        title={target ? `Go to ${target.name}` : "No stop to go to"}>
        <FastForward size={15} aria-hidden /> {target ? `To ${target.name.split(" (")[0].slice(0, 22)}` : "No next stop"}</button>
      <button type="button" className="icon-btn" aria-label="Turn demo mode off" onClick={() => { setDemo(false); location.reload(); }}><X size={16} /></button>
    </div>
  );
}
