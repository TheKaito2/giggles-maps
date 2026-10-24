import { X } from "lucide-react";
import { setDemo } from "../lib/demoGps";

/** Demo mode banner on the map. Moving happens in directions (Navigate): its Demo button drives you to the next stop. */
export default function DemoBar() {
  return (
    <div className="demo-bar" role="status">
      <b>Demo mode</b><span className="fine">Start directions, then use the Demo button to drive to each stop.</span>
      <button type="button" className="icon-btn" aria-label="Turn demo mode off" onClick={() => { setDemo(false); location.reload(); }}><X size={16} /></button>
    </div>
  );
}
