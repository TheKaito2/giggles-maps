import { useEffect, useState } from "react";
import { Gift, Sparkles, X } from "lucide-react";
import { getPlanUsage, LIFETIME_YEARS, type PlanUsage, type PlusKind, PRICES } from "../lib/api";
import { isNative, purchase, purchaseErrorText } from "../lib/native";
import { useDialog } from "../lib/useDialog";
import { isGuest, useUser } from "../lib/auth";
import type { Gate } from "./detour/useDetour";
import SignIn from "./SignIn";
import RewardedAd from "./RewardedAd";

type Why = Gate | "ads" | "perk";
const TITLE: Record<Why, string> = {
  ads: "Go ad-free",
  perk: "Plus gets partner perks",
  sign_in_required: "Sign in to plan more detours",
  sign_in_edits: "Sign in to keep changing it",
  detour_limit: "That's today's free detours",
  edit_limit: "That's today's free changes",
  stop_limit_free: "Plus can add more stops",
};

/** What every Plus plan gives (Trip Pass, yearly and Lifetime differ only in how long). */
export const PLUS_PERKS = ["Unlimited detours and changes", "Up to 15 stops a plan (free plans hold 3)", "No ads",
  "Partner and Giggles Choice stops first", "+20 coins every day you open the app", "The Plus shelf and title"];

// prices v6: yearly is the main plan, so it's in the middle and highlighted
const PLANS: { kind: PlusKind; name: string; price: string; note: string }[] = [
  { kind: "trip_pass", name: "Trip Pass", price: `฿${PRICES.tripPass}`, note: "Plus for 7 days, for one trip. Doesn't renew." },
  { kind: "plus_year", name: "Plus yearly", price: `฿${PRICES.plusYear} / year`, note: `About ฿${Math.round(PRICES.plusYear / 12)} a month, billed once a year.` },
  { kind: "lifetime", name: "Lifetime", price: `฿${PRICES.lifetime} once`, note: `Plus forever, for the price of ${LIFETIME_YEARS} years.` },
];

/** The three ways to get Plus, each with its own buy button. */
export function PlusPlans({ buy }: { buy: (kind: PlusKind) => void }) {
  return (
    <div className="plus-plans">
      {PLANS.map((p) => <section key={p.kind} className={p.kind === "plus_year" ? "member-card" : "plus-card"}>
        <div className="row between"><h3>{p.name}</h3><span className="num price-tag">{p.price}</span></div>
        <p className="fine">{p.note}</p>
        <button type="button" className={p.kind === "plus_year" ? "btn gold" : "btn"} onClick={() => buy(p.kind)}>
          {p.kind === "plus_year" && <Sparkles size={16} aria-hidden />} Get {p.name}</button>
      </section>)}
      {!isNative && <p className="fine">Card or PromptPay.</p>}
    </div>
  );
}

/** A guest is asked to sign in; a free account at a limit (detours, changes, 3 stops) or tired of ads is offered Plus. */
export default function Upgrade({ gate, onClose, onRewarded }: { gate: Why; onClose: () => void; onRewarded?: () => void }) {
  const box = useDialog(onClose);
  const user = useUser(), guest = isGuest(user);
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [msg, setMsg] = useState("");
  const [watching, setWatching] = useState(false);
  const adKind = gate === "detour_limit" ? "detour" : gate === "edit_limit" ? "edit" : null;
  useEffect(() => { if (gate === "detour_limit" || gate === "edit_limit") getPlanUsage().then(setUsage).catch(() => undefined); }, [gate]);
  // signed in from this sheet: the detour plans itself now
  const signIn = gate === "sign_in_required" || gate === "sign_in_edits";
  useEffect(() => { if (signIn && !guest) onClose(); }, [guest]); // eslint-disable-line react-hooks/exhaustive-deps
  const buy = async (kind: PlusKind) => {
    setMsg("");
    try { if (await purchase(kind, user?.id)) { setMsg("Thanks! It switches on in a moment."); setTimeout(onClose, 1500); } }
    catch (e) { setMsg(purchaseErrorText(e)); }
  };
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={TITLE[gate]} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal upgrade" ref={box} tabIndex={-1}>
        <header className="modal-head"><h2>{TITLE[gate]}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
        {signIn || ((gate === "ads" || gate === "perk" || gate === "stop_limit_free") && guest) ? <>
          <p className="fine">{gate === "ads" || gate === "perk" || gate === "stop_limit_free" ? "Sign in first, so it stays with your account."
            : gate === "sign_in_edits" ? "Guests get 3 changes a day; a free account makes 10. Your stamps, coins and photos come with you."
            : "Guests try one detour a day; a free account plans 3. Your stamps, coins and photos come with you."}</p>
          <SignIn />
        </> : <>
          {usage && <div className="usage-row">
            <span><b className="num">{usage.detours}/{usage.max_detours}</b><span className="fine">detours</span></span>
            <span><b className="num">{usage.edits}/{usage.max_edits}</b><span className="fine">changes</span></span>
            <span className="fine">Resets at midnight</span>
          </div>}
          {adKind && usage && usage.ads_left > 0 && <button type="button" className="btn watch-ad" onClick={() => setWatching(true)}>
            <Gift size={16} aria-hidden /> Watch an ad · {adKind === "detour" ? "+1 detour" : "+5 changes"}
            <span className="fine num">{usage.ads_left} left today</span></button>}
          <ul className="perks">{PLUS_PERKS.map((p) => <li key={p}>{p}</li>)}</ul>
          <PlusPlans buy={buy} />
          {msg && <p className="fine" role="status">{msg}</p>}
        </>}
      </div>
      {watching && adKind && <RewardedAd kind={adKind} onClose={() => setWatching(false)} onDone={() => { setWatching(false); onClose(); onRewarded?.(); }} />}
    </div>
  );
}
