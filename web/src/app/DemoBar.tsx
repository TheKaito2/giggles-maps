import { X } from "lucide-react";
import { setDemo } from "../lib/demoGps";

/** Demo mode banner on the map: tap the map to move yourself. Fast-forwarding to a stop lives in directions (Navigate). */
export default function DemoBar() {
  return (
    <div className="demo-bar" role="status">
      <b>Demo mode</b><span className="fine">Tap the map to move you. Start directions to fast-forward to each stop.</span>
      <button type="button" className="icon-btn" aria-label="Turn demo mode off" onClick={() => { setDemo(false); location.reload(); }}><X size={16} /></button>
    </div>
  );
}
