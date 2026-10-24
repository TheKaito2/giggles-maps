import { useState } from "react";
import { Sparkles } from "lucide-react";
import { demoOn, setDemo } from "../lib/demoGps";
import { useDialog } from "../lib/useDialog";

const WELCOMED = "gm-demo-welcomed", AT = "gm-demo-at";
const BANGKOK = { lat: 13.7563, lng: 100.5018 };

// private mode or blocked storage: the sheet may show again next visit, which is harmless
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };

/** First visit only: asks whether this is a tester or judge, and if so starts demo mode in Bangkok. */
export default function DemoWelcome() {
  const [open, setOpen] = useState(() => !get(WELCOMED) && !demoOn());
  if (!open) return null;
  return <WelcomeSheet onClose={() => { put(WELCOMED, "1"); setOpen(false); }} />;
}

function WelcomeSheet({ onClose }: { onClose: () => void }) {
  const box = useDialog(onClose);
  const start = () => {
    put(WELCOMED, "1");
    put(AT, JSON.stringify(BANGKOK));
    setDemo(true);
    location.reload();   // demo state is read at start-up
  };
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Welcome to Giggles Maps"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal demo-welcome" ref={box} tabIndex={-1}>
        <div>
          <p className="eyebrow">Welcome to Giggles Maps</p>
          <h2>Here to try it out?</h2>
        </div>
        <p>Demo mode puts you in Bangkok with a busy community, so you can plan a detour, check in and see the leaderboard without going anywhere.</p>
        <div className="demo-welcome-actions">
          <button type="button" className="btn gold" onClick={start}><Sparkles size={16} aria-hidden /> Yes, start the demo</button>
          <button type="button" className="btn ghost" onClick={onClose}>No, I'm exploring for real</button>
        </div>
        <p className="fine">You can switch it any time in Profile → Settings.</p>
      </div>
    </div>
  );
}
