import { useState } from "react";
import { X } from "lucide-react";

const HIDDEN = "gm-demo-bar-hidden";   // cleared when demo mode is switched off (demoGps.setDemo)
const read = () => { try { return localStorage.getItem(HIDDEN) === "1"; } catch { return false; } };

/** Demo mode banner on the map. Moving happens in directions (Navigate): its Demo button drives you to the next stop.
 * × only hides the banner; demo mode stays on (switch it off in Profile). */
export default function DemoBar() {
  const [hidden, setHidden] = useState(read);
  if (hidden) return null;
  return (
    <div className="demo-bar" role="status">
      <b>Demo mode</b><span className="fine">Start directions, then use the Demo button to drive to each stop. Other travellers, reviews and
        partners you see are pretend.</span>
      <button type="button" className="icon-btn" aria-label="Hide this note (demo mode stays on)" title="Hide (demo mode stays on)"
        onClick={() => { try { localStorage.setItem(HIDDEN, "1"); } catch { /* hidden for now only */ } setHidden(true); }}><X size={16} /></button>
    </div>
  );
}
