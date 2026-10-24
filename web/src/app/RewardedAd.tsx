import { useEffect, useRef, useState } from "react";
import { Ban, Gift } from "lucide-react";
import { type AdReward, claimAdReward, PRICES, startAdReward } from "../lib/api";
import { ApiError } from "../lib/supabase";
import { useDialog } from "../lib/useDialog";

// Rewarded ad: Google Ad Manager's web rewarded format once VITE_GAM_REWARDED_UNIT is set (AdSense has none), else our own
// ad with a countdown. The reward is claimed from here (Google verifies rewards server-side for apps only); the server only
// pays out 15 s or more after the start, 3 times a day.
const UNIT = import.meta.env.VITE_GAM_REWARDED_UNIT as string | undefined;
const AD_SECONDS = 15;
type Gpt = { cmd: (() => void)[]; defineOutOfPageSlot: (u: string, f: unknown) => { addService: (s: unknown) => unknown } | null;
  enums: { OutOfPageFormat: { REWARDED: unknown } }; pubads: () => { addEventListener: (e: string, f: (ev: { makeRewardedVisible?: () => void }) => void) => void };
  enableServices: () => void; display: (s: unknown) => void; destroySlots: (s?: unknown[]) => void };

function loadGpt(): Gpt {
  const w = window as unknown as { googletag?: Gpt };
  if (!w.googletag) {
    w.googletag = { cmd: [] } as unknown as Gpt;
    const s = document.createElement("script");
    s.async = true; s.src = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
    document.head.append(s);
  }
  return w.googletag;
}

const ERR: Record<string, string> = { ad_limit: "That's today's 3 ads.", not_needed: "Members don't need ads: your detours are unlimited.",
  sign_in_required: "Sign in first." };

export default function RewardedAd({ kind, onDone, onClose }: { kind: AdReward; onDone: () => void; onClose: () => void }) {
  const box = useDialog(onClose);
  const [id, setId] = useState<number | null>(null);
  const [left, setLeft] = useState(AD_SECONDS);
  const [house, setHouse] = useState(!UNIT);   // our own ad: no Ad Manager unit, or Google had none to show
  const [msg, setMsg] = useState("");
  const started = useRef(0);

  const claim = (rewardId: number) => {
    const wait = started.current + AD_SECONDS * 1000 + 300 - Date.now();   // the server counts from the start too
    setTimeout(() => claimAdReward(rewardId).then(onDone)
      .catch((e) => setMsg(ERR[e instanceof ApiError ? e.message : ""] ?? "Couldn't add the reward. Try again.")), Math.max(0, wait));
  };

  useEffect(() => {
    startAdReward(kind).then((rid) => { started.current = Date.now(); setId(rid); })
      .catch((e) => setMsg(ERR[e instanceof ApiError ? e.message : ""] ?? "Couldn't load an ad. Try again."));
  }, [kind]);

  // house ad: count down, then the claim button
  useEffect(() => {
    if (!house || id == null) return;
    const t = setInterval(() => setLeft(Math.max(0, AD_SECONDS - Math.floor((Date.now() - started.current) / 1000))), 250);
    return () => clearInterval(t);
  }, [house, id]);

  // Ad Manager rewarded slot
  useEffect(() => {
    if (!UNIT || id == null) return;
    const g = loadGpt();
    let slot: unknown = null, granted = false;
    g.cmd.push(() => {
      slot = g.defineOutOfPageSlot(UNIT, g.enums.OutOfPageFormat.REWARDED);
      if (!slot) { setHouse(true); return; }   // page not supported (e.g. zoomed): our own ad instead
      (slot as { addService: (s: unknown) => unknown }).addService(g.pubads());
      g.pubads().addEventListener("rewardedSlotReady", (ev) => ev.makeRewardedVisible?.());
      g.pubads().addEventListener("rewardedSlotGranted", () => { granted = true; claim(id); });
      g.pubads().addEventListener("rewardedSlotClosed", () => { if (!granted) onClose(); });
      g.pubads().addEventListener("slotRenderEnded", (ev) => { if ((ev as { isEmpty?: boolean }).isEmpty) setHouse(true); });
      g.enableServices();
      g.display(slot);
    });
    return () => { if (slot) g.cmd.push(() => g.destroySlots([slot])); };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Ad" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal rewarded" ref={box} tabIndex={-1}>
        <span className="ad-label">Ad</span>
        {msg ? <p className="fine" role="status">{msg}</p> : house ? <>
          <div className="rewarded-card">
            <span className="ad-icon big"><Ban size={32} aria-hidden /></span>
            <b>Plan without limits</b>
            <span className="fine">Membership: unlimited detours and no ads, forever. ฿{PRICES.membership} once, with 3 months of Plus.</span>
          </div>
          <div className="rewarded-bar" aria-hidden><span style={{ width: `${100 * (AD_SECONDS - left) / AD_SECONDS}%` }} /></div>
          <button type="button" className="btn gold" disabled={left > 0 || id == null} onClick={() => id != null && claim(id)}>
            <Gift size={16} aria-hidden /> {left > 0 ? `Reward in ${left} s` : kind === "detour" ? "Get +1 detour" : "Get +5 changes"}</button>
        </> : <p className="fine">Loading the ad…</p>}
        <button type="button" className="link" onClick={onClose}>{msg ? "Close" : "Skip (no reward)"}</button>
      </div>
    </div>
  );
}
